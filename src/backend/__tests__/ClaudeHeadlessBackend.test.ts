import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { ClaudeHeadlessBackend } from '../ClaudeHeadlessBackend';
import { AgentConfig } from '../../types';
import { LocalMcpServer, LocalMcpTool } from '../../mcp/LocalMcpServer';
import { TeamMcpBridge } from '../../mcp/TeamMcpBridge';
import { CommandPolicy } from '../CommandPolicy';

function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 'claude-1',
    name: 'Claude Dev',
    role: 'developer',
    skill: '',
    provider: { providerId: 'anthropic', apiKeySecretName: 'ANTHROPIC_API_KEY' },
    model: 'claude-sonnet-4-5',
    systemPrompt: 'Follow the role.\n\n<project_context>\nold rules\n</project_context>',
    autoApprove: true,
    allowedTools: [],
    backend: 'claude',
    ...overrides,
  };
}

describe('ClaudeHeadlessBackend project context (F4)', () => {
  it('uses the latest project context in the first role prompt', () => {
    const backend = new ClaudeHeadlessBackend(makeConfig());
    const text = (backend as any).composeTurnText('do work', { projectContext: 'new rules' });

    expect(text).toContain('# Your Role: Claude Dev');
    expect(text).toContain('<project_context>\nnew rules\n</project_context>');
    expect(text).not.toContain('old rules');
    expect(text).toContain('do work');
  });

  it('injects latest project context on later turns', () => {
    const backend = new ClaudeHeadlessBackend(makeConfig({ systemPrompt: 'Follow the role.' }));
    (backend as any).composeTurnText('first', { projectContext: 'v1' });

    const second = (backend as any).composeTurnText('second', { projectContext: 'v2' });

    expect(second).toContain('<project_context>\nv2\n</project_context>');
    expect(second).not.toContain('# Your Role');
    expect(second).toContain('second');
  });

  it('adds a Plan mode note while leaving Claude permissions as spawn-time best-effort', () => {
    const backend = new ClaudeHeadlessBackend(makeConfig());
    const text = (backend as any).composeTurnText('sketch options', { mode: 'plan' });

    expect(text).toContain('[PLAN MODE] Discuss, analyze, and plan only.');
    expect(text).toContain('sketch options');
  });
});

describe('ClaudeHeadlessBackend team bridge MCP wiring', () => {
  it('starts a LocalMcpServer for PM agents and passes --mcp-config', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'roam-claude-'));
    const local = fakeLocalServer();
    const spawn = fakeSpawn();
    const backend = new ClaudeHeadlessBackend(
      makeConfig({ role: 'pm', workingDirectory: dir }),
      { mcpServers: { github: { command: 'npx' } } },
      undefined,
      {
        localMcpServerFactory: () => local,
        teamMcpBridge: fakeBridge(),
        spawn: spawn.fn as any,
      }
    );

    await backend.start({} as NodeJS.ProcessEnv);

    expect(local.starts).toBe(1);
    expect(spawn.calls[0].args).toContain('--mcp-config');
    expect(spawn.calls[0].args).toContain('.roam/mcp.json');

    const written = JSON.parse(await fs.readFile(path.join(dir, '.roam', 'mcp.json'), 'utf8'));
    expect(written.mcpServers.github).toEqual({ command: 'npx' });
    expect(written.mcpServers.roam_team_bridge).toEqual({
      type: 'http',
      url: 'http://127.0.0.1:48123/mcp',
      headers: { Authorization: 'Bearer test-token' },
    });

    await fs.rm(dir, { recursive: true, force: true });
  });

  it('does not start LocalMcpServer for non-PM agents', async () => {
    const local = fakeLocalServer();
    const spawn = fakeSpawn();
    const backend = new ClaudeHeadlessBackend(
      makeConfig({ role: 'developer' }),
      undefined,
      undefined,
      {
        localMcpServerFactory: () => local,
        teamMcpBridge: fakeBridge(),
        spawn: spawn.fn as any,
      }
    );

    await backend.start({} as NodeJS.ProcessEnv);

    expect(local.starts).toBe(0);
    expect(spawn.calls[0].args).not.toContain('--mcp-config');
  });

  it('stops LocalMcpServer when a PM backend stops', async () => {
    const local = fakeLocalServer();
    const spawn = fakeSpawn();
    const backend = new ClaudeHeadlessBackend(
      makeConfig({ role: 'pm' }),
      undefined,
      undefined,
      {
        localMcpServerFactory: () => local,
        teamMcpBridge: fakeBridge(),
        spawn: spawn.fn as any,
      }
    );
    await backend.start({} as NodeJS.ProcessEnv);

    await backend.stop(50);

    expect(local.stops).toBe(1);
  });
});

describe('ClaudeHeadlessBackend command-permission gate (unify with roam.commandApproval)', () => {
  it('mounts a per-agent permission server + --permission-prompt-tool (acceptEdits)', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'roam-claude-perm-'));
    const perm = fakeLocalServer();
    const spawn = fakeSpawn();
    const approvals: string[] = [];
    const backend = new ClaudeHeadlessBackend(
      makeConfig({ role: 'developer', name: 'Senior Developer', workingDirectory: dir, autoApprove: false }),
      undefined,
      undefined,
      {
        spawn: spawn.fn as any,
        commandPermission: {
          policy: new CommandPolicy('ask', ['npm test']),
          requestApproval: async (c) => { approvals.push(c); return { allow: true }; },
          createServer: () => perm,
        },
      }
    );

    await backend.start({} as NodeJS.ProcessEnv);

    const args = spawn.calls[0].args;
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('acceptEdits');
    expect(args).toContain('--permission-prompt-tool');
    expect(args).toContain('mcp__roam_permission__permission_prompt');

    expect(perm.starts).toBe(1);
    expect(perm.localTools.map((t) => t.name)).toEqual(['permission_prompt']);
    const written = JSON.parse(await fs.readFile(path.join(dir, '.roam', 'mcp.json'), 'utf8'));
    expect(written.mcpServers.roam_permission).toEqual({
      type: 'http',
      url: 'http://127.0.0.1:48123/mcp',
      headers: { Authorization: 'Bearer test-token' },
    });

    // The registered handler routes to the decider: allowlisted → allow silently; else → prompt.
    const handler = perm.localTools[0].handler;
    expect(JSON.parse(await handler({ tool_name: 'Bash', input: { command: 'npm test' } })).behavior).toBe('allow');
    expect(approvals).toEqual([]); // npm test is allowlisted → not prompted
    expect(JSON.parse(await handler({ tool_name: 'Bash', input: { command: 'npm install x' } })).behavior).toBe('allow');
    expect(approvals).toEqual(['npm install x']); // non-allowlisted → prompted (and approved here)

    await fs.rm(dir, { recursive: true, force: true });
  });

  it('omits the gate entirely for an autoApprove (bypassPermissions) agent', async () => {
    const perm = fakeLocalServer();
    const spawn = fakeSpawn();
    const backend = new ClaudeHeadlessBackend(
      makeConfig({ role: 'developer', autoApprove: true }),
      undefined,
      undefined,
      {
        spawn: spawn.fn as any,
        commandPermission: { policy: new CommandPolicy('ask', []), requestApproval: async () => ({ allow: true }), createServer: () => perm },
      }
    );

    await backend.start({} as NodeJS.ProcessEnv);

    const args = spawn.calls[0].args;
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('bypassPermissions');
    expect(args).not.toContain('--permission-prompt-tool');
    expect(perm.starts).toBe(0); // never mounted — claude wouldn't call it in bypass mode
  });

  it('does not reference the permission server when the MCP config cannot be written', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'roam-claude-nowrite-'));
    const filePath = path.join(dir, 'cwd-is-a-file');
    await fs.writeFile(filePath, 'x'); // workingDirectory is a FILE → .roam/mcp.json write fails
    const perm = fakeLocalServer();
    const spawn = fakeSpawn();
    const backend = new ClaudeHeadlessBackend(
      makeConfig({ role: 'developer', workingDirectory: filePath, autoApprove: false }),
      undefined,
      undefined,
      {
        spawn: spawn.fn as any,
        commandPermission: { policy: new CommandPolicy('ask', []), requestApproval: async () => ({ allow: true }), createServer: () => perm },
      }
    );

    await backend.start({} as NodeJS.ProcessEnv);

    const args = spawn.calls[0].args;
    expect(args).not.toContain('--permission-prompt-tool'); // no dangling tool name for an unknown server
    expect(args).not.toContain('--mcp-config');
    expect(perm.starts).toBe(1); // started during prepareMcpConfig…
    expect(perm.stops).toBe(1);  // …then stopped because the config couldn't be written (no leak)

    await fs.rm(dir, { recursive: true, force: true });
  });

  it('cleans up the permission server + config file when claude fails to spawn', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'roam-claude-spawnerr-'));
    const perm = fakeLocalServer();
    const spawn = fakeSpawnError();
    const backend = new ClaudeHeadlessBackend(
      makeConfig({ role: 'developer', workingDirectory: dir, autoApprove: false }),
      undefined,
      undefined,
      {
        spawn: spawn.fn as any,
        commandPermission: { policy: new CommandPolicy('ask', []), requestApproval: async () => ({ allow: true }), createServer: () => perm },
      }
    );

    await expect(backend.start({} as NodeJS.ProcessEnv)).rejects.toThrow(/ENOENT/);

    expect(perm.starts).toBe(1);
    expect(perm.stops).toBe(1); // exit handler never fires on spawn error → explicit cleanup must run
    await expect(fs.access(path.join(dir, '.roam', 'mcp.json'))).rejects.toBeTruthy(); // config removed

    await fs.rm(dir, { recursive: true, force: true });
  });

  it('stops the permission server when the backend stops', async () => {
    const perm = fakeLocalServer();
    const spawn = fakeSpawn();
    const backend = new ClaudeHeadlessBackend(
      makeConfig({ role: 'developer', autoApprove: false }),
      undefined,
      undefined,
      {
        spawn: spawn.fn as any,
        commandPermission: { policy: new CommandPolicy('ask', []), requestApproval: async () => ({ allow: true }), createServer: () => perm },
      }
    );
    await backend.start({} as NodeJS.ProcessEnv);

    await backend.stop(50);

    expect(perm.stops).toBe(1);
  });
});

function fakeBridge(): TeamMcpBridge {
  return {} as TeamMcpBridge;
}

function fakeLocalServer(): LocalMcpServer & { starts: number; stops: number; localTools: LocalMcpTool[] } {
  return {
    port: 48123,
    token: 'test-token',
    starts: 0,
    stops: 0,
    localTools: [],
    addLocalTool(tool) {
      this.localTools.push(tool);
    },
    async start() {
      this.starts++;
    },
    async stop() {
      this.stops++;
    },
  };
}

function fakeSpawnError() {
  const calls: Array<{ cmd: string; args: string[] }> = [];
  const fn = (cmd: string, args: string[]) => {
    calls.push({ cmd, args });
    const proc = new EventEmitter() as any;
    proc.exitCode = null;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.stdout.setEncoding = () => undefined;
    proc.stderr.setEncoding = () => undefined;
    proc.stdin = { write: () => true, end: () => undefined };
    proc.kill = () => true;
    setTimeout(() => proc.emit('error', new Error('spawn claude ENOENT')), 0);
    return proc;
  };
  return { fn, calls };
}

function fakeSpawn() {
  const calls: Array<{ cmd: string; args: string[] }> = [];
  const fn = (cmd: string, args: string[]) => {
    calls.push({ cmd, args });
    const proc = new EventEmitter() as any;
    proc.pid = 1234;
    proc.exitCode = null;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.stdout.setEncoding = () => undefined;
    proc.stderr.setEncoding = () => undefined;
    proc.stdin = { write: () => true, end: () => undefined };
    proc.kill = () => {
      proc.exitCode = 0;
      proc.emit('exit', 0);
      return true;
    };
    setTimeout(() => proc.emit('spawn'), 0);
    return proc;
  };
  return { fn, calls };
}
