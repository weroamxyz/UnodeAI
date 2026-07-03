import { describe, expect, it } from 'vitest';
import { resolveOpenAICompatBaseUrl } from '../../backend/openAICompatBaseUrl';
import { DEFAULT_PROVIDER_CONFIGS, DEFAULT_PROVIDERS } from '../RoleConfig';

describe('OpenRouter provider defaults', () => {
  it('registers OpenRouter with its own API key secret', () => {
    expect(DEFAULT_PROVIDERS.openrouter).toMatchObject({
      providerId: 'openrouter',
      apiKeySecretName: 'OPENROUTER_API_KEY',
    });
  });

  it('configures OpenRouter as an OpenAI-compatible gateway with default models', () => {
    const config = DEFAULT_PROVIDER_CONFIGS.openrouter;

    expect(config).toMatchObject({
      id: 'openrouter',
      type: 'custom',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKeySecretName: 'OPENROUTER_API_KEY',
    });
    expect(config.models.length).toBeGreaterThanOrEqual(3);
    expect(config.models.map((m) => m.id)).toEqual(expect.arrayContaining([
      'anthropic/claude-sonnet-4',
      'openai/gpt-4o',
      'google/gemini-2.5-flash',
      'meta-llama/llama-3.1-70b-instruct',
    ]));
  });

  it('resolves OpenRouter through the OpenAI-compatible base URL helper', () => {
    expect(
      resolveOpenAICompatBaseUrl('openrouter', DEFAULT_PROVIDER_CONFIGS.openrouter.baseUrl)
    ).toBe('https://openrouter.ai/api/v1');
  });
});
