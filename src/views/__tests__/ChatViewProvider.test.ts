import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({}));

import { ChatAgent, ChatViewDeps, ChatViewProvider } from '../ChatViewProvider';

const agent: ChatAgent = {
  id: 'agent-1',
  name: 'Dev',
  role: 'Developer',
  backend: 'openai',
};

function depsFor(agents: ChatAgent[] = [agent]): ChatViewDeps {
  const store = new Map<string, unknown>();
  return {
    listAgents: () => agents,
    send: vi.fn(),
    interject: vi.fn(),
    interrupt: vi.fn(),
    onReply: () => vi.fn(),
    state: {
      get: <T>(key: string) => store.get(key) as T | undefined,
      update: (key: string, value: unknown) => {
        store.set(key, value);
        return Promise.resolve();
      },
    },
    getApprovals: () => ({ command: 'ask', write: 'none' }),
    setApproval: vi.fn(),
  } as ChatViewDeps;
}

function providerWith(deps = depsFor()): ChatViewProvider {
  const provider = new ChatViewProvider({} as never, deps);
  provider.selectAgent(agent.id);
  return provider;
}

describe('ChatViewProvider interject UI', () => {
  it('routes busy Send to interject', () => {
    const deps = depsFor();
    const provider = providerWith(deps);

    provider.appendDelta(agent.id, 'working');
    (provider as any).onMessage({ command: 'send', agentId: agent.id, text: ' use read_file ', mode: 'act' });

    expect(deps.interject).toHaveBeenCalledWith(agent.id, 'use read_file');
    expect(deps.send).not.toHaveBeenCalled();
  });

  it('routes idle Send to send', () => {
    const deps = depsFor();
    const provider = providerWith(deps);

    (provider as any).onMessage({ command: 'send', agentId: agent.id, text: 'start task', mode: 'plan' });

    expect(deps.send).toHaveBeenCalledWith(agent.id, 'start task', 'plan');
    expect(deps.interject).not.toHaveBeenCalled();
  });

  it('flips the composer label and hint from running state', () => {
    const html = (providerWith() as any).getHtml({ cspSource: 'test:' });
    const match = html.match(/function updateComposer\(\) \{[\s\S]*?\r?\n    \}\r?\n\r?\n    function selectedIsRunning/);
    expect(match).toBeTruthy();
    const updateComposer = match![0].replace(/\r?\n\r?\n    function selectedIsRunning$/, '');
    const run = (runningAgentIds: string[]) => {
      const input: any = {};
      const sendButton: any = {};
      const stopButton: any = {};
      const steerHint: any = {};
      const state = { selectedAgentId: agent.id, runningAgentIds, mode: 'act', agents: [agent] };
      const fn = new Function('state', 'input', 'sendButton', 'stopButton', 'steerHint', 'planMode', 'actMode', 'agentSelect', `${updateComposer}\nupdateComposer();`);
      fn(state, input, sendButton, stopButton, steerHint, {}, {}, {});
      return { input, sendButton, stopButton, steerHint };
    };

    expect(run([]).sendButton.textContent).toBe('Send');
    expect(run([]).steerHint.hidden).toBe(true);
    expect(run([]).stopButton.hidden).toBe(true);
    const running = run([agent.id]);
    expect(running.sendButton.textContent).toBe('Steer ⚡');
    expect(running.stopButton.hidden).toBe(false);
    expect(running.stopButton.disabled).toBe(false);
    expect(running.steerHint.hidden).toBe(false);
  });

  it('persists a finalized tool card so its diff survives a reload (0.6.13)', () => {
    const deps = depsFor();
    const provider = providerWith(deps);

    // A write tool runs and finishes with a diff.
    provider.appendToolActivity(agent.id, { phase: 'use', name: 'write_file', input: { path: 'a.txt' } });
    provider.appendToolActivity(agent.id, { phase: 'result', name: 'write_file', ok: true, summary: 'Wrote 3 bytes', diff: '--- a.txt\n+++ a.txt\n+x' });

    // Simulate a window reload: a brand-new provider over the SAME persisted store.
    const reloaded = new ChatViewProvider({} as never, deps);
    const items = (reloaded as any).transcriptItems(agent.id) as Array<{ kind: string; name?: string; diff?: string; phase?: string }>;
    const card = items.find((i) => i.kind === 'tool' && i.name === 'write_file');
    expect(card).toBeTruthy();
    expect(card!.diff).toContain('+x');
    expect(card!.phase).toBe('result'); // never a phantom "Running" after reload
  });

  it('does not persist a tool card that never finished', () => {
    const deps = depsFor();
    const provider = providerWith(deps);
    provider.appendToolActivity(agent.id, { phase: 'use', name: 'run_command', input: { command: 'npm test' } });

    const reloaded = new ChatViewProvider({} as never, deps);
    const items = (reloaded as any).transcriptItems(agent.id) as Array<{ kind: string }>;
    expect(items.some((i) => i.kind === 'tool')).toBe(false);
  });

  it('clearing the selected agent also wipes its persisted tool cards', () => {
    const deps = depsFor();
    const provider = providerWith(deps);
    provider.appendToolActivity(agent.id, { phase: 'result', name: 'write_file', ok: true, summary: 'Wrote', diff: '+x' });
    provider.clearSelectedAgent();

    const reloaded = new ChatViewProvider({} as never, deps);
    const items = (reloaded as any).transcriptItems(agent.id) as Array<{ kind: string }>;
    expect(items.some((i) => i.kind === 'tool')).toBe(false);
  });

  it('posts steer from Send and interrupt from Stop while running', () => {
    const html = (providerWith() as any).getHtml({ cspSource: 'test:' });
    const match = html.match(/function selectedIsRunning\(\) \{[\s\S]*?\r?\n    \}\r?\n\r?\n    function setMode/);
    expect(match).toBeTruthy();
    const sendAndStop = match![0].replace(/\r?\n\r?\n    function setMode$/, '');
    const posts: unknown[] = [];
    const state = { selectedAgentId: agent.id, runningAgentIds: [agent.id], mode: 'act' };
    const input = { value: ' steer this turn ' };
    const agentSelect = { value: agent.id };
    const vscode = { postMessage: (msg: unknown) => posts.push(msg) };

    const fn = new Function('state', 'input', 'agentSelect', 'vscode', `${sendAndStop}\nsend();\nstop();`);
    fn(state, input, agentSelect, vscode);

    expect(posts).toEqual([
      { command: 'send', agentId: agent.id, text: 'steer this turn', mode: 'act' },
      { command: 'interrupt', agentId: agent.id },
    ]);
    expect(input.value).toBe('');
  });
});

describe('ChatViewProvider archive', () => {
  const seed = (provider: ChatViewProvider, text: string) =>
    (provider as any).append(agent.id, { role: 'user', text, ts: new Date().toISOString() });

  it('archives the selected transcript (saved) then wipes the live view', () => {
    const deps = depsFor();
    const provider = providerWith(deps);
    seed(provider, 'remember this');

    const count = provider.archiveSelectedAgent();
    expect(count).toBe(1);

    // Saved: one archive entry holding the message.
    const archives = provider.listArchivedChats();
    expect(archives).toHaveLength(1);
    expect(archives[0].agentId).toBe(agent.id);
    expect(archives[0].messages[0].text).toBe('remember this');

    // Hidden: a reloaded provider over the same store shows no live transcript for the agent.
    const reloaded = new ChatViewProvider({} as never, deps);
    const items = (reloaded as any).transcriptItems(agent.id) as Array<{ kind: string }>;
    expect(items.some((i) => i.kind === 'message')).toBe(false);
  });

  it('archiving an empty chat is a no-op (nothing saved)', () => {
    const provider = providerWith();
    expect(provider.archiveSelectedAgent()).toBe(0);
    expect(provider.listArchivedChats()).toHaveLength(0);
  });

  it('restores an archived chat back into its agent and drops it from the archive', () => {
    const deps = depsFor();
    const provider = providerWith(deps);
    seed(provider, 'bring me back');
    provider.archiveSelectedAgent();

    const archiveId = provider.listArchivedChats()[0].id;
    const result = provider.restoreArchive(archiveId);
    expect(result.ok).toBe(true);
    expect(provider.getMessageCount(agent.id)).toBe(1);
    expect(provider.listArchivedChats()).toHaveLength(0); // it's live again, no longer archived
  });

  it("refuses to restore into an agent that's no longer on the team", () => {
    const deps = depsFor();
    const provider = providerWith(deps);
    seed(provider, 'orphan me');
    provider.archiveSelectedAgent();
    const archiveId = provider.listArchivedChats()[0].id;

    // A new provider whose roster no longer contains the agent, sharing the same store.
    const goneDeps = { ...deps, listAgents: () => [] as ChatAgent[] } as ChatViewDeps;
    const goneProvider = new ChatViewProvider({} as never, goneDeps);
    const result = goneProvider.restoreArchive(archiveId);
    expect(result).toEqual({ ok: false, reason: 'agent-gone' });
    expect(goneProvider.listArchivedChats()).toHaveLength(1); // not consumed on failure
  });
});
