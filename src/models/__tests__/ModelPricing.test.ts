import { describe, it, expect } from 'vitest';
import { ModelPricing, DEFAULT_MODEL_PRICES } from '../ModelPricing';

describe('ModelPricing', () => {
  const pricing = new ModelPricing();

  it('estimates cost from input/output tokens at the table rate', () => {
    // deepseek-v4-flash (gateway) = $0.14/1M in, $0.28/1M out
    const cost = pricing.estimate('deepseek-v4-flash', 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(0.42, 6);
  });

  it('matches by substring and prefers the longest (most specific) key', () => {
    // 'claude-opus-4-5' contains both 'claude-opus' and (hypothetically) shorter keys; opus wins.
    const opus = pricing.priceFor('claude-opus-4-5');
    expect(opus).toEqual(DEFAULT_MODEL_PRICES['claude-opus']);
    // gateway-prefixed id still resolves.
    expect(pricing.priceFor('anthropic/claude-sonnet-4')).toEqual(DEFAULT_MODEL_PRICES['claude-sonnet']);
  });

  it('returns undefined for an unknown model (caller treats cost as 0)', () => {
    expect(pricing.estimate('some-unlisted-model', 1000, 1000)).toBeUndefined();
    expect(pricing.priceFor('some-unlisted-model')).toBeUndefined();
  });

  it('honors a custom/override price table', () => {
    const custom = new ModelPricing({ 'my-model': { input: 1, output: 2 } });
    expect(custom.estimate('my-model', 2_000_000, 1_000_000)).toBeCloseTo(2 * 1 + 1 * 2, 6);
  });
});
