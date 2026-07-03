import { describe, it, expect } from 'vitest';
import { ROLE_TEMPLATES, createTeam } from '../RoleConfig';

describe('solo role template (v0.3.0 Solo/Fast mode)', () => {
  const solo = ROLE_TEMPLATES['solo'];

  it('exists with role "solo"', () => {
    expect(solo).toBeDefined();
    expect(solo.role).toBe('solo');
  });

  it('is a full generalist: read/write/search/execute, but NO delegate (it does not orchestrate)', () => {
    for (const tool of ['read', 'write', 'search', 'execute']) {
      expect(solo.allowedTools).toContain(tool);
    }
    expect(solo.allowedTools).not.toContain('delegate');
  });

  it('builds a single agent via createTeam(["solo"]) with a resolved model', () => {
    const [agent, ...rest] = createTeam(['solo'], 'roam');
    expect(rest).toHaveLength(0);
    expect(agent.role).toBe('solo');
    expect(agent.model).toBeTruthy();
    expect(agent.allowedTools).not.toContain('delegate');
  });
});
