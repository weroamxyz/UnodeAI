import { describe, it, expect } from 'vitest';
import { defaultBackendKind, isSupportedProviderId, providerUsesCliAuth } from '../backendKind';
import { DEFAULT_PROVIDERS } from '../../roles/RoleConfig';

const forProvider = (providerId: string) => defaultBackendKind({ provider: { providerId, apiKeySecretName: 'X' } });

describe('defaultBackendKind', () => {
  it('routes OpenAI-compatible providers to the in-process backend', () => {
    for (const p of ['roam', 'openai', 'custom', 'openrouter']) {
      expect(forProvider(p), `${p} should be openai-compat`).toBe('openai-compat');
    }
  });

  it('routes everything else to the Claude backend', () => {
    for (const p of ['anthropic', 'google', 'ollama']) {
      expect(forProvider(p)).toBe('claude');
    }
  });

  it('OpenRouter (a built-in OpenAI-compatible provider) is NOT misrouted to Claude (v0.2.29 regression)', () => {
    expect(DEFAULT_PROVIDERS.openrouter).toBeDefined();
    expect(forProvider('openrouter')).toBe('openai-compat');
  });

  it('distinguishes supported providers from catalog-only placeholders', () => {
    expect(isSupportedProviderId('roam')).toBe(true);
    expect(isSupportedProviderId('openrouter')).toBe(true);
    expect(isSupportedProviderId('anthropic')).toBe(true);
    expect(isSupportedProviderId('google')).toBe(false);
    expect(isSupportedProviderId('ollama')).toBe(false);
  });

  it('marks only Claude CLI providers as CLI-auth providers', () => {
    expect(providerUsesCliAuth('anthropic')).toBe(true);
    expect(providerUsesCliAuth('openrouter')).toBe(false);
    expect(providerUsesCliAuth('roam')).toBe(false);
  });
});
