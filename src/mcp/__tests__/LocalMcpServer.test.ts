import { afterEach, describe, expect, it } from 'vitest';
import * as http from 'http';
import { createLocalMcpServer, LocalMcpServer } from '../LocalMcpServer';
import { TeamMcpBridge, TeamToolset } from '../TeamMcpBridge';
import { ToolSpec } from '../../backend/WorkspaceTools';

let servers: LocalMcpServer[] = [];

afterEach(async () => {
  await Promise.all(servers.map((s) => s.stop()));
  servers = [];
});

function fakeTeam(): TeamToolset {
  const specs: ToolSpec[] = [
    { type: 'function', function: { name: 'list_agents', description: 'List agents', parameters: { type: 'object', properties: {} } } },
    { type: 'function', function: { name: 'assign_task', description: 'Assign task', parameters: { type: 'object', properties: { agent: { type: 'string' } } } } },
    { type: 'function', function: { name: 'broadcast', description: 'Broadcast', parameters: { type: 'object', properties: {} } } },
    { type: 'function', function: { name: 'run_checks', description: 'Run checks', parameters: { type: 'object', properties: {} } } },
  ];
  return {
    specs: () => specs,
    has: (name) => specs.some((s) => s.function.name === name),
    run: async (name, args) => `${name}:${JSON.stringify(args)}`,
  };
}

async function start(): Promise<LocalMcpServer> {
  const server = createLocalMcpServer();
  await server.start(new TeamMcpBridge(fakeTeam()));
  servers.push(server);
  return server;
}

describe('LocalMcpServer', () => {
  it('starts on a loopback random port', async () => {
    const server = await start();
    expect(server.port).toBeGreaterThan(0);
    expect(server.token).toMatch(/^[a-f0-9]{32}$/);
  });

  it('tools/list returns team bridge tool definitions', async () => {
    const server = await start();
    const res = await rpc(server, { jsonrpc: '2.0', id: 1, method: 'tools/list' });

    expect(res.status).toBe(200);
    expect(res.body.result.tools.map((t: any) => t.name)).toEqual([
      'list_agents',
      'assign_task',
      'broadcast',
      'run_checks',
    ]);
  });

  it('tools/call routes through the team bridge', async () => {
    const server = await start();
    const res = await rpc(server, {
      jsonrpc: '2.0',
      id: 'call-1',
      method: 'tools/call',
      params: { name: 'list_agents', arguments: { verbose: true } },
    });

    expect(res.status).toBe(200);
    expect(res.body.result.content[0]).toEqual({ type: 'text', text: 'list_agents:{"verbose":true}' });
  });

  it('rejects requests without the bearer token', async () => {
    const server = await start();
    const res = await post(server.port, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, undefined);

    expect(res.status).toBe(401);
  });

  it('releases the port on stop', async () => {
    const server = await start();
    const port = server.port;
    await server.stop();

    await expect(canListen(port)).resolves.toBe(true);
  });

  it('closes the team bridge on stop', async () => {
    const server = createLocalMcpServer();
    let cancelReason = '';
    await server.start(new TeamMcpBridge({
      ...fakeTeam(),
      cancelPending: (reason) => {
        cancelReason = reason ?? '';
        return 1;
      },
    }));
    servers.push(server);

    await server.stop();

    expect(cancelReason).toMatch(/bridge shutdown/);
  });

  // Permission-only server: a teammate (no team bridge) still hosts the claude permission-prompt tool.
  it('serves a local tool with no bridge (permission-prompt server)', async () => {
    const server = createLocalMcpServer();
    let received: Record<string, unknown> | undefined;
    server.addLocalTool({
      name: 'permission_prompt',
      description: 'gate',
      inputSchema: { type: 'object' },
      handler: async (args) => { received = args; return JSON.stringify({ behavior: 'allow', updatedInput: args.input }); },
    });
    await server.start(); // NB: no bridge
    servers.push(server);

    const list = await rpc(server, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(list.body.result.tools.map((t: any) => t.name)).toEqual(['permission_prompt']);

    const call = await rpc(server, {
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'permission_prompt', arguments: { tool_name: 'Bash', input: { command: 'npm test' } } },
    });
    expect(received).toEqual({ tool_name: 'Bash', input: { command: 'npm test' } });
    expect(JSON.parse(call.body.result.content[0].text)).toEqual({ behavior: 'allow', updatedInput: { command: 'npm test' } });
  });

  it('lists local tools before bridge tools and routes calls to the right one', async () => {
    const server = createLocalMcpServer();
    server.addLocalTool({ name: 'permission_prompt', description: 'gate', inputSchema: { type: 'object' }, handler: async () => 'LOCAL' });
    await server.start(new TeamMcpBridge(fakeTeam()));
    servers.push(server);

    const list = await rpc(server, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(list.body.result.tools.map((t: any) => t.name)).toEqual(['permission_prompt', 'list_agents', 'assign_task', 'broadcast', 'run_checks']);

    const local = await rpc(server, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'permission_prompt', arguments: {} } });
    expect(local.body.result.content[0].text).toBe('LOCAL');
    const bridged = await rpc(server, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_agents', arguments: {} } });
    expect(bridged.body.result.content[0].text).toBe('list_agents:{}');
  });
});

function rpc(server: LocalMcpServer, body: unknown): Promise<{ status: number; body: any }> {
  return post(server.port, body, server.token);
}

function post(port: number, body: unknown, token: string | undefined): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const text = JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/mcp',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(text),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
      (res) => {
        let out = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (out += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: out ? JSON.parse(out) : undefined }));
      }
    );
    req.on('error', reject);
    req.end(text);
  });
}

function canListen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = http.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}
