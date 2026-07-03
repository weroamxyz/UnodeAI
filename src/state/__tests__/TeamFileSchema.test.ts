import { describe, it, expect } from 'vitest';
import { validateTeamFile } from '../TeamFileSchema';

const member = {
  id: 'pm',
  name: 'PM',
  role: 'pm',
  skill: 'project-management',
  provider: { providerId: 'roam', apiKeySecretName: 'ROAM_API_KEY' },
  model: 'deepseek-v4-flash',
  systemPrompt: 'Coordinate the team.',
  autoApprove: false,
  allowedTools: ['read', 'delegate'],
};

describe('validateTeamFile', () => {
  it('accepts members and MCP servers', () => {
    const doc = validateTeamFile({
      version: '1.0',
      members: [member],
      mcpServers: [{ id: 'github', name: 'GitHub', transport: 'stdio', command: 'npx', args: ['-y', 'x'] }],
    });

    expect(doc.members[0].id).toBe('pm');
    expect(doc.mcpServers[0].id).toBe('github');
  });

  it('reports field-level errors instead of accepting malformed config', () => {
    expect(() =>
      validateTeamFile({
        members: [{ ...member, provider: 'bad' }],
        mcpServers: [{ id: 'remote', name: 'Remote', transport: 'streamable-http' }],
      })
    ).toThrow(/provider must be an object.*url is required/s);
  });

  it('supports legacy agents array', () => {
    expect(validateTeamFile({ agents: [member] }).members).toHaveLength(1);
  });

  it('accepts valid custom workflows', () => {
    const doc = validateTeamFile({
      members: [member],
      workflows: [{
        id: 'custom-flow',
        name: 'Custom Flow',
        description: 'A saved workflow',
        steps: [
          { id: 'plan', from: 'pm', to: 'architect', action: 'Plan', autoTransition: true },
          {
            id: 'review',
            from: 'architect',
            to: 'reviewer',
            action: 'Review',
            autoTransition: true,
            branches: [{ whenResultContains: 'fail', goto: 'plan' }, { goto: 'done' }],
          },
          { id: 'done', from: 'reviewer', to: 'tester', action: 'Done', autoTransition: true },
        ],
      }],
    });

    expect(doc.workflows[0].id).toBe('custom-flow');
    expect(doc.workflows[0].steps[1].branches?.[0].goto).toBe('plan');
  });

  it('reports malformed workflows and drops invalid entries', () => {
    expect(() =>
      validateTeamFile({
        members: [member],
        workflows: [
          { id: 'bad', name: 'Bad', steps: 'nope' },
          {
            id: 'also-bad',
            name: 'Also Bad',
            steps: [{ id: 's1', from: 'pm', to: '', action: 'x', autoTransition: 'yes' }],
          },
        ],
      })
    ).toThrow(/workflows\[0\]\.steps must be an array.*workflows\[1\]\.steps\[0\]\.to/s);
  });

  it('reports non-array workflows', () => {
    expect(() => validateTeamFile({ members: [member], workflows: {} })).toThrow(/workflows must be an array/);
  });
});
