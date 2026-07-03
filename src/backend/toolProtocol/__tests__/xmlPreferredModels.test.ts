import { describe, it, expect } from 'vitest';
import { prefersXmlByDefault } from '../xmlPreferredModels';

describe('prefersXmlByDefault', () => {
  it('defaults known always-leakers to XML (incl. version suffixes)', () => {
    for (const m of ['kimi-k2.7-code', 'moonshot-v1-128k', 'glm-4.6', 'minimax-m1', 'K2']) {
      expect(prefersXmlByDefault(m)).toBe(true);
    }
  });

  it('leaves frontier / native-clean models — and DeepSeek (the default) — on native', () => {
    for (const m of ['claude-opus-4-8', 'gpt-4o', 'gemini-2.5-pro', 'qwen-max', 'deepseek-v4-pro', 'deepseek-chat', '']) {
      expect(prefersXmlByDefault(m)).toBe(false);
    }
    expect(prefersXmlByDefault(undefined)).toBe(false);
  });
});
