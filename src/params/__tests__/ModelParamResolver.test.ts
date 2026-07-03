import { describe, it, expect } from 'vitest';
import { ModelParamResolver, HARD_DEFAULTS } from '../ModelParamResolver';
import { ConfigStore } from '../../settings/SettingsBridge';
import { AgentConfig } from '../../types';

function fakeConfig(initial: Record<string, unknown> = {}): ConfigStore {
  const values = new Map(Object.entries(initial));
  return {
    get: <T>(k: string, fb: T) => (values.has(k) ? (values.get(k) as T) : fb),
    update: async (k, v) => { values.set(k, v); },
  };
}

function agent(over: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 'a1',
    name: 'Dev',
    role: 'developer',
    skill: 'code-generation',
    provider: { providerId: 'roam', apiKeySecretName: 'ROAM_API_KEY' },
    model: 'deepseek-v4-pro',
    systemPrompt: '',
    autoApprove: false,
    allowedTools: [],
    ...over,
  };
}

describe('ModelParamResolver (F2)', () => {
  it('falls back to hard defaults when nothing is configured', () => {
    const r = new ModelParamResolver(fakeConfig());
    const out = r.resolve(agent());
    expect(out.temperature).toBe(HARD_DEFAULTS.temperature);
    expect(out.max_tokens).toBe(HARD_DEFAULTS.max_tokens);
    expect(out.stream).toBe(HARD_DEFAULTS.stream);
  });

  it('global settings override hard defaults', () => {
    const r = new ModelParamResolver(
      fakeConfig({ 'modelDefaults.temperature': 1.2, 'modelDefaults.maxTokens': 8000 })
    );
    const out = r.resolve(agent());
    expect(out.temperature).toBe(1.2);
    expect(out.max_tokens).toBe(8000);
  });

  it('agent.modelParams wins over global and hard defaults', () => {
    const r = new ModelParamResolver(fakeConfig({ 'modelDefaults.temperature': 1.2 }));
    const out = r.resolve(agent({ modelParams: { temperature: 0.3 } }));
    expect(out.temperature).toBe(0.3);
  });

  it('smart-tier params win over global but lose to explicit agent params', () => {
    const r = new ModelParamResolver(fakeConfig({ 'modelDefaults.temperature': 1.2 }));
    // tier sets 0.9, no explicit agent value -> tier wins over global
    expect(r.resolve(agent(), { temperature: 0.9 }).temperature).toBe(0.9);
    // explicit agent value beats the tier
    expect(r.resolve(agent({ modelParams: { temperature: 0.3 } }), { temperature: 0.9 }).temperature).toBe(0.3);
  });

  it('legacy agent.temperature/maxTokens are honored below modelParams but above globals', () => {
    const r = new ModelParamResolver(fakeConfig({ 'modelDefaults.temperature': 1.2, 'modelDefaults.maxTokens': 9000 }));
    const out = r.resolve(agent({ temperature: 0.5, maxTokens: 2000 }));
    expect(out.temperature).toBe(0.5); // legacy beats global
    expect(out.max_tokens).toBe(2000);
  });

  it('maps reasoningEffort and responseFormat globals into the resolved shape', () => {
    const r = new ModelParamResolver(
      fakeConfig({ 'modelDefaults.reasoningEffort': 'high', 'modelDefaults.responseFormat': 'json_object' })
    );
    const out = r.resolve(agent());
    expect(out.reasoning_effort).toBe('high');
    expect(out.response_format).toEqual({ type: 'json_object' });
  });

  it('omits fields that resolve to undefined (no spurious keys)', () => {
    const r = new ModelParamResolver(fakeConfig());
    const out = r.resolve(agent());
    // top_p has no hard default and nothing set it -> must be absent, not undefined
    expect('top_p' in out).toBe(false);
    expect('presence_penalty' in out).toBe(false);
  });
});
