import { describe, it, expect } from 'vitest';
import { TeamMcpBridge, TeamToolset } from '../TeamMcpBridge';
import { ToolSpec } from '../../backend/WorkspaceTools';

function fakeTeam(): TeamToolset & { calls: Array<[string, unknown]> } {
  const specs: ToolSpec[] = [
    { type: 'function', function: { name: 'list_agents', description: 'see the team', parameters: { type: 'object', properties: {} } } },
    { type: 'function', function: { name: 'assign_task', description: 'delegate', parameters: { type: 'object', properties: { agent: { type: 'string' } } } } },
  ];
  const calls: Array<[string, unknown]> = [];
  return {
    calls,
    specs: () => specs,
    has: (n) => n === 'list_agents' || n === 'assign_task',
    run: async (n, a) => { calls.push([n, a]); return `ran ${n}`; },
  };
}

describe('TeamMcpBridge (P2#12 core)', () => {
  it('maps team tool specs to MCP tool defs', async () => {
    const bridge = new TeamMcpBridge(fakeTeam());
    const tools = await bridge.listTools();
    expect(tools.map((t) => t.name)).toEqual(['list_agents', 'assign_task']);
    expect(tools[1]).toMatchObject({ description: 'delegate' });
    expect(tools[1].inputSchema).toMatchObject({ type: 'object' });
  });

  it('routes callTool through TeamTools.run', async () => {
    const team = fakeTeam();
    const bridge = new TeamMcpBridge(team);
    const out = await bridge.callTool('assign_task', { agent: 'dev', instruction: 'go' });
    expect(out).toBe('ran assign_task');
    expect(team.calls).toEqual([['assign_task', { agent: 'dev', instruction: 'go' }]]);
  });

  it('returns an error string for an unknown tool (never throws)', async () => {
    const bridge = new TeamMcpBridge(fakeTeam());
    expect(await bridge.callTool('nope', {})).toContain('unknown team tool');
  });

  it('cancels pending team delegations when closed', async () => {
    let reason = '';
    const bridge = new TeamMcpBridge({
      ...fakeTeam(),
      cancelPending: (r) => {
        reason = r ?? '';
        return 1;
      },
    });

    await bridge.close();

    expect(reason).toMatch(/bridge shutdown/);
  });
});
