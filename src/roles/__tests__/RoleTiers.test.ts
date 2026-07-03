import { describe, it, expect } from 'vitest';
import { ROLE_TEMPLATES, DEFAULT_MODEL_TIERS, modelForRole, AgentConfigBuilder, createTeam } from '../RoleConfig';

describe('model tiers', () => {
  it('maps tiers to the expected Roam models (premium = latest opus)', () => {
    expect(DEFAULT_MODEL_TIERS.premium.roam).toBe('claude-opus-4-8');
    expect(DEFAULT_MODEL_TIERS.standard.roam).toBe('deepseek-v4-pro');
    expect(DEFAULT_MODEL_TIERS.economy.roam).toBe('deepseek-v4-flash');
    expect(DEFAULT_MODEL_TIERS.standard.openrouter).toBe('openai/gpt-4o');
  });

  it('leads (PM, Architect) are premium; workers (QA/DevOps/Data) are economy', () => {
    expect(ROLE_TEMPLATES.pm.tier).toBe('premium');
    expect(ROLE_TEMPLATES.architect.tier).toBe('premium');
    for (const role of ['tester', 'devops', 'data-engineer']) {
      expect(ROLE_TEMPLATES[role].tier).toBe('economy');
    }
    // contributors that need quality sit in the middle.
    expect(ROLE_TEMPLATES['senior-dev'].tier).toBe('standard');
    expect(ROLE_TEMPLATES.security.tier).toBe('standard');
  });

  it('modelForRole resolves the tier model per provider', () => {
    expect(modelForRole(ROLE_TEMPLATES.pm, 'roam')).toBe('claude-opus-4-8');
    expect(modelForRole(ROLE_TEMPLATES.tester, 'roam')).toBe('deepseek-v4-flash');
    expect(modelForRole(ROLE_TEMPLATES.tester, 'openai')).toBe('gpt-4o-mini');
    expect(modelForRole(ROLE_TEMPLATES.tester, 'openrouter')).toBe('google/gemini-2.5-flash');
  });

  it('a per-role modelOverride wins over the tier (tech-writer keeps qwen-max on Roam)', () => {
    expect(ROLE_TEMPLATES['tech-writer'].tier).toBe('standard');
    expect(modelForRole(ROLE_TEMPLATES['tech-writer'], 'roam')).toBe('qwen-max');
    // …but on a provider without an override it falls back to the tier model.
    expect(modelForRole(ROLE_TEMPLATES['tech-writer'], 'openai')).toBe(DEFAULT_MODEL_TIERS.standard.openai);
  });

  it('falls back to the Claude `model` when neither override nor tier knows the provider', () => {
    expect(modelForRole(ROLE_TEMPLATES.pm, 'some-unknown-provider')).toBe('claude-opus-4-8'); // tier.roam fallback
    expect(
      modelForRole({ tier: 'standard', model: 'claude-x' } as any, 'nope', {
        premium: {}, standard: {}, economy: {},
      } as any)
    ).toBe('claude-x'); // no tier entries at all -> the role's model
  });
});

describe('role-tuned model params (defaults from experience)', () => {
  it('ships deterministic temperatures for code/review/security and higher for writing/architecture', () => {
    expect(ROLE_TEMPLATES.reviewer.modelParams?.temperature).toBe(0.1);
    expect(ROLE_TEMPLATES.security.modelParams?.temperature).toBe(0.1);
    expect(ROLE_TEMPLATES['senior-dev'].modelParams?.temperature).toBe(0.2);
    expect(ROLE_TEMPLATES.pm.modelParams?.temperature).toBe(0.3);
    expect(ROLE_TEMPLATES.architect.modelParams?.temperature).toBe(0.5);
    expect(ROLE_TEMPLATES['tech-writer'].modelParams?.temperature).toBe(0.6);
  });

  it('does not force reasoning_effort by default (opt-in only — some gateways reject it)', () => {
    // reasoning_effort is settable per-agent (Model Tuning) and per-tier (Smart Mode), but not
    // forced as a role default, to avoid 400s on models/gateways that don't support it.
    for (const role of ['architect', 'pm', 'reviewer', 'security', 'tech-writer']) {
      expect(ROLE_TEMPLATES[role].modelParams?.reasoning_effort).toBeUndefined();
    }
  });

  it('builds an agent carrying the role default, as its own (non-aliased) object', () => {
    const a1 = new AgentConfigBuilder().fromTemplate('reviewer').build();
    const a2 = new AgentConfigBuilder().fromTemplate('reviewer').build();
    expect(a1.modelParams?.temperature).toBe(0.1);
    expect(a1.modelParams).not.toBe(a2.modelParams); // cloned, not shared
  });

  it('createTeam agents each get their role-tuned defaults', () => {
    const team = createTeam(['pm', 'senior-dev', 'reviewer'], 'roam');
    const byRole = Object.fromEntries(team.map((a) => [a.role, a.modelParams?.temperature]));
    expect(byRole.pm).toBe(0.3);
    expect(byRole['senior-dev']).toBe(0.2);
    expect(byRole.reviewer).toBe(0.1);

    const openrouterTeam = createTeam(['pm', 'tester'], 'openrouter');
    expect(openrouterTeam.map((agent) => agent.model)).toEqual([
      DEFAULT_MODEL_TIERS.premium.openrouter,
      DEFAULT_MODEL_TIERS.economy.openrouter,
    ]);
  });
});

describe('independent Reviewer role', () => {
  it('exists and is read-only (an independent validator never edits code)', () => {
    const reviewer = ROLE_TEMPLATES.reviewer;
    expect(reviewer).toBeDefined();
    expect(reviewer.role).toBe('reviewer');
    expect([...reviewer.allowedTools].sort()).toEqual(['message', 'read', 'search']);
    expect(reviewer.allowedTools).not.toContain('write');
    expect(reviewer.allowedTools).not.toContain('execute');
    expect(reviewer.tier).toBe('standard');
  });
});
