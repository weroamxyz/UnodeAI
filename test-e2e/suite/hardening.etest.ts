import * as assert from 'assert';
import * as vscode from 'vscode';

const EXT_ID = 'roamai.roam-crew';

interface AgentLike {
  id: string;
  role: string;
  name: string;
  status?: string;
  pendingStart?: boolean;
}

interface MessageLike {
  from: string;
  to: string;
  type: string;
  payload?: { instruction?: string };
}

describe('UnodeAi routing and concurrency', () => {
  before(async () => {
    await vscode.extensions.getExtension(EXT_ID)?.activate();
  });

  it('routes a user task to QA without targeting Dev', async () => {
    const team = await createDefaultTeam();
    const dev = requireAgent(team, (a) => a.role === 'senior-dev' || a.role === 'developer', 'Dev');
    const qa = requireAgent(team, (a) => a.role === 'reviewer' || a.role === 'tester' || a.role === 'qa', 'QA');

    const sent = await vscode.commands.executeCommand<MessageLike>('roam.sendMessage', {
      targetId: qa.id,
      instruction: 'E5e routing probe for QA only',
    });

    assert.ok(sent, 'sendMessage should return the sent bus message');
    assert.strictEqual(sent.from, 'user');
    assert.strictEqual(sent.to, qa.id);
    assert.notStrictEqual(sent.to, dev.id);
    assert.strictEqual(sent.type, 'task.assign');
    assert.strictEqual(sent.payload?.instruction, 'E5e routing probe for QA only');
  });

  it('queues the third agent at max concurrency 2 and auto-starts it when a slot frees', async () => {
    const cfg = vscode.workspace.getConfiguration('roam');
    const originalLimit = cfg.get<number>('maxConcurrentAgents', 4);
    await cfg.update('maxConcurrentAgents', 2, vscode.ConfigurationTarget.Global);
    try {
      await setRoamApiKey();
      const team = await createDefaultTeam();
      assert.ok(team.length >= 3, 'default team should provide at least three agents');

      const [first, second, third] = team;
      await vscode.commands.executeCommand<AgentLike>('roam.agentStart', first.id);
      await vscode.commands.executeCommand<AgentLike>('roam.agentStart', second.id);
      const queued = await vscode.commands.executeCommand<AgentLike>('roam.agentStart', third.id);

      assert.strictEqual(queued?.id, third.id);
      assert.strictEqual(queued?.pendingStart, true, 'third start should be pending behind the cap');
      assert.strictEqual(queued?.status, 'stopped');

      const afterStop = await vscode.commands.executeCommand<AgentLike[]>('roam.agentStop', first.id);
      const resumed = await poll(
        () => afterStop?.find((agent) => agent.id === third.id),
        (agent): agent is AgentLike => !!agent && !agent.pendingStart && (agent.status === 'starting' || agent.status === 'idle'),
        5000
      );

      assert.ok(resumed, 'queued third agent should auto-start after a slot frees');
    } finally {
      await vscode.commands.executeCommand('roam.stopAllAgents');
      await cfg.update('maxConcurrentAgents', originalLimit, vscode.ConfigurationTarget.Global);
    }
  });
});

async function createDefaultTeam(): Promise<AgentLike[]> {
  const originalInfo = vscode.window.showInformationMessage;
  const originalWarning = vscode.window.showWarningMessage;
  try {
    (vscode.window as any).showInformationMessage = async () => undefined;
    (vscode.window as any).showWarningMessage = async (_message: string, ...args: unknown[]) => {
      const items = args.filter((item): item is string => typeof item === 'string');
      return items.includes('Add') ? 'Add' : undefined;
    };

    const created = await vscode.commands.executeCommand<AgentLike[]>('roam.createDefaultTeam');
    assert.ok(Array.isArray(created), 'createDefaultTeam should return created agents');
    return created;
  } finally {
    (vscode.window as any).showInformationMessage = originalInfo;
    (vscode.window as any).showWarningMessage = originalWarning;
  }
}

async function setRoamApiKey(): Promise<void> {
  const originalQuickPick = vscode.window.showQuickPick;
  const originalInputBox = vscode.window.showInputBox;
  try {
    (vscode.window as any).showQuickPick = async () => ({ label: 'ROAM_API_KEY', secretName: 'ROAM_API_KEY' });
    (vscode.window as any).showInputBox = async () => 'sk-e2e-offline';
    await vscode.commands.executeCommand('roam.setApiKey');
  } finally {
    (vscode.window as any).showQuickPick = originalQuickPick;
    (vscode.window as any).showInputBox = originalInputBox;
  }
}

function requireAgent(agents: AgentLike[], predicate: (agent: AgentLike) => boolean, label: string): AgentLike {
  const agent = agents.find(predicate);
  assert.ok(agent, `${label} agent should exist`);
  return agent;
}

async function poll<T>(
  read: () => T,
  done: (value: T) => boolean,
  timeoutMs: number
): Promise<T | undefined> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = read();
    if (done(value)) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return undefined;
}
