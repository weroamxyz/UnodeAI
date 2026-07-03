import { describe, it, expect } from 'vitest';
import { ROLE_TEMPLATES, TEAM_PRESETS, createTeam } from '../RoleConfig';

describe('team presets', () => {
  it('every preset starts with the PM and only references real role templates', () => {
    for (const [key, preset] of Object.entries(TEAM_PRESETS)) {
      expect(preset.roles[0], `${key} must start with pm`).toBe('pm');
      for (const role of preset.roles) {
        expect(ROLE_TEMPLATES[role], `${role} must exist`).toBeDefined();
      }
    }
  });

  it('builds each preset team with the right number of agents, all message-capable', () => {
    for (const preset of Object.values(TEAM_PRESETS)) {
      const team = createTeam(preset.roles, 'roam');
      expect(team).toHaveLength(preset.roles.length);
      for (const agent of team) {
        expect(agent.allowedTools.length).toBeGreaterThan(0);
        expect(agent.allowedTools).toContain('message');
      }
    }
  });

  it('defines the five task packs with verify commands', () => {
    const packs = Object.values(TEAM_PRESETS).filter((p) => p.kind === 'pack');
    expect(packs.map((p) => p.label)).toEqual([
      'Bugfix Crew',
      'Refactor Crew',
      'Test Writer Crew',
      'Release Crew',
      'Security Review Crew',
    ]);
    for (const pack of packs) {
      expect(pack.description).toBeTruthy();
      expect(pack.verifyCommand).toBeTruthy();
    }
  });

  it('new specialist templates derive their tools from skills and never get delegate', () => {
    for (const key of ['business-analyst', 'market-researcher', 'financial-analyst', 'strategy-lead']) {
      const t = ROLE_TEMPLATES[key];
      expect(t).toBeDefined();
      expect(t.systemPrompt.length).toBeGreaterThan(0);
      expect(t.allowedTools).not.toContain('delegate');
    }
  });
});
