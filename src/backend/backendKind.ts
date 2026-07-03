import { AgentConfig, AgentBackendKind } from '../types';

/**
 * Providers that speak the OpenAI-compatible HTTP API run in-process (openai-compat backend);
 * everything else goes through the Claude headless CLI. **Add every new OpenAI-compatible provider
 * here** — otherwise Add Agent silently routes it to the Claude backend and skips the endpoint/model
 * picker (this is exactly how OpenRouter regressed in v0.2.29).
 */
export const OPENAI_COMPAT_PROVIDERS = new Set(['roam', 'unode', 'openai', 'custom', 'openrouter']);
export const CLI_BACKEND_PROVIDERS = new Set(['anthropic']);

export function isSupportedProviderId(providerId: string): boolean {
  return OPENAI_COMPAT_PROVIDERS.has(providerId) || CLI_BACKEND_PROVIDERS.has(providerId);
}

export function providerUsesCliAuth(providerId: string): boolean {
  return CLI_BACKEND_PROVIDERS.has(providerId);
}

/** Default runtime for an agent when config.backend is unset. */
export function defaultBackendKind(config: Pick<AgentConfig, 'provider'>): AgentBackendKind {
  return OPENAI_COMPAT_PROVIDERS.has(config.provider.providerId) ? 'openai-compat' : 'claude';
}
