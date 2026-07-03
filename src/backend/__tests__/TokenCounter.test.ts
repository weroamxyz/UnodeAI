import { describe, it, expect } from 'vitest';
import { TokenCounter, estimateTokens } from '../TokenCounter';

describe('TokenCounter (P2 context gates)', () => {
  it('estimates tokens at ~4 chars/token', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });

  it('sums message content, ignoring null content', () => {
    const tc = new TokenCounter();
    const tokens = tc.estimateMessages([{ content: 'abcd' }, { content: null }, { content: 'abcdabcd' }]);
    expect(tokens).toBe(1 + 0 + 2);
  });

  it('flags soft at 70% and hard at 80% of the window', () => {
    const tc = new TokenCounter(1000, 0.7, 0.8);
    expect(tc.assess(600)).toMatchObject({ soft: false, hard: false });
    expect(tc.assess(700)).toMatchObject({ soft: true, hard: false });
    expect(tc.assess(800)).toMatchObject({ soft: true, hard: true });
  });

  it('reports the occupancy ratio', () => {
    const tc = new TokenCounter(1000);
    expect(tc.assess(450).ratio).toBeCloseTo(0.45, 5);
  });

  it('plans soft-limit compaction by dropping the middle while keeping system, anchor, and recent turns', () => {
    const tc = new TokenCounter(1000, 0.7, 0.8);
    const big = 'x'.repeat(1200);
    const messages = [
      { role: 'system', content: 'rules' },
      { role: 'user', content: 'anchor decision' },
      { role: 'assistant', content: `old answer ${big}` },
      { role: 'user', content: `old task ${big}` },
      { role: 'assistant', content: `old result ${big}` },
      { role: 'user', content: 'recent task' },
      { role: 'assistant', content: 'recent result' },
    ];

    const plan = tc.softLimit(messages);

    expect(plan.triggered).toBe(true);
    expect(plan.keep[0].role).toBe('system');
    expect(plan.keep[1].content).toBe('anchor decision');
    expect(JSON.stringify(plan.keep)).toContain('recent task');
    expect(JSON.stringify(plan.toDrop)).toContain('old answer');
  });

  it('returns an untriggered plan below the soft limit', () => {
    const tc = new TokenCounter(1000, 0.7, 0.8);
    const messages = [{ role: 'system', content: 'small' }, { role: 'user', content: 'short' }];

    expect(tc.softLimit(messages)).toMatchObject({ triggered: false, toDrop: [], keep: messages });
  });
});
