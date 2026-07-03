import { describe, expect, it } from 'vitest';
import { resolveOpenAICompatBaseUrl, canonicalRoamBaseUrl } from '../openAICompatBaseUrl';

describe('resolveOpenAICompatBaseUrl', () => {
  it('uses the Roam (weroam) gateway for Roam agents with no explicit base URL', () => {
    expect(resolveOpenAICompatBaseUrl('roam')).toBe('https://ai.weroam.xyz/v1');
  });

  it('overrides legacy OpenAI base URLs on Roam agents', () => {
    expect(resolveOpenAICompatBaseUrl('roam', 'https://api.openai.com/v1')).toBe('https://ai.weroam.xyz/v1');
    expect(resolveOpenAICompatBaseUrl('roam', 'https://api.openai.com/v1/')).toBe('https://ai.weroam.xyz/v1');
  });

  it('overrides a legacy unode base URL persisted on a Roam agent (Roam now = weroam)', () => {
    expect(resolveOpenAICompatBaseUrl('roam', 'https://www.unodetech.xyz/v1')).toBe('https://ai.weroam.xyz/v1');
  });

  it('honors an explicit non-OpenAI Roam-compatible base URL', () => {
    expect(resolveOpenAICompatBaseUrl('roam', ' https://gateway.example/v1/ ')).toBe('https://gateway.example/v1');
  });

  // Codex blocking fix: a persisted roam.baseUrl=unode (passed as roamDefault) must NOT leak Roam onto Unode.
  it('never lets a stale unode/OpenAI roamDefault send a Roam agent to Unode', () => {
    expect(resolveOpenAICompatBaseUrl('roam', undefined, undefined, 'https://www.unodetech.xyz/v1')).toBe('https://ai.weroam.xyz/v1');
    expect(resolveOpenAICompatBaseUrl('roam', undefined, undefined, 'https://api.openai.com/v1')).toBe('https://ai.weroam.xyz/v1');
    // an explicitly custom roamDefault is still honored
    expect(resolveOpenAICompatBaseUrl('roam', undefined, undefined, 'https://gw.example/v1')).toBe('https://gw.example/v1');
  });

  it('canonicalRoamBaseUrl collapses blank/unode/OpenAI to weroam but keeps a custom URL', () => {
    expect(canonicalRoamBaseUrl(undefined)).toBe('https://ai.weroam.xyz/v1');
    expect(canonicalRoamBaseUrl('')).toBe('https://ai.weroam.xyz/v1');
    expect(canonicalRoamBaseUrl('https://www.unodetech.xyz/v1')).toBe('https://ai.weroam.xyz/v1');
    expect(canonicalRoamBaseUrl('https://api.openai.com/v1')).toBe('https://ai.weroam.xyz/v1');
    expect(canonicalRoamBaseUrl(' https://gw.example/v1/ ')).toBe('https://gw.example/v1');
  });

  it('uses a provided unodeDefault for Unode agents (roam.unodeBaseUrl wiring)', () => {
    expect(resolveOpenAICompatBaseUrl('unode', undefined, undefined, 'https://ai.weroam.xyz/v1', 'https://gw.unodetech.xyz/v1')).toBe('https://gw.unodetech.xyz/v1');
  });

  it('uses the Unode gateway for Unode agents with no explicit base URL', () => {
    expect(resolveOpenAICompatBaseUrl('unode')).toBe('https://www.unodetech.xyz/v1');
  });

  it('overrides a legacy OpenAI base URL on Unode agents but keeps a custom one', () => {
    expect(resolveOpenAICompatBaseUrl('unode', 'https://api.openai.com/v1')).toBe('https://www.unodetech.xyz/v1');
    expect(resolveOpenAICompatBaseUrl('unode', 'https://gw.unodetech.xyz/v1/')).toBe('https://gw.unodetech.xyz/v1');
  });

  it('keeps OpenAI as the default for non-Roam compatible providers', () => {
    expect(resolveOpenAICompatBaseUrl('openai')).toBe('https://api.openai.com/v1');
    expect(resolveOpenAICompatBaseUrl('custom', undefined, 'https://custom.example/v1/')).toBe('https://custom.example/v1');
  });
});
