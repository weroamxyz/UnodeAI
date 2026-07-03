import { describe, it, expect } from 'vitest';
import { LivePriceService, convertRows, resolveGroupRatio, resolveVendorDiscounts, PriceFetch } from '../LivePriceService';
import { ModelPricing } from '../ModelPricing';

describe('convertRows (new-api ratios -> USD/1M)', () => {
  it('applies the verified formula (gpt-4o = OpenAI list price)', () => {
    const out = convertRows([{ model_name: 'gpt-4o', model_ratio: 1.25, completion_ratio: 4, quota_type: 0 }]);
    expect(out['gpt-4o']).toEqual({ input: 2.5, output: 10 });
  });

  it('converts deepseek and claude-opus to the gateway price', () => {
    const out = convertRows([
      { model_name: 'deepseek-v4-flash', model_ratio: 0.07, completion_ratio: 2, quota_type: 0 },
      { model_name: 'claude-opus-4-8', model_ratio: 2.5, completion_ratio: 5, quota_type: 0 },
    ]);
    expect(out['deepseek-v4-flash']).toEqual({ input: 0.14, output: 0.28 });
    expect(out['claude-opus-4-8']).toEqual({ input: 5, output: 25 });
  });

  it('skips per-call media pricing (quota_type 1) and zero-ratio rows', () => {
    const out = convertRows([
      { model_name: 'veo-3.0', model_ratio: 0, completion_ratio: 0, quota_type: 1 },
      { model_name: 'embed', model_ratio: 0, completion_ratio: 1, quota_type: 0 },
      { model_name: 'good', model_ratio: 0.5, completion_ratio: 2, quota_type: 0 },
    ]);
    expect(Object.keys(out)).toEqual(['good']);
  });

  it('applies a group discount ratio to both input and output', () => {
    const out = convertRows([{ model_name: 'gpt-4o', model_ratio: 1.25, completion_ratio: 4, quota_type: 0 }], 0.5);
    expect(out['gpt-4o']).toEqual({ input: 1.25, output: 5 }); // half of list (2.5 / 10)
  });

  it('applies vendor discounts from the pricing endpoint', () => {
    const out = convertRows(
      [{ model_name: 'claude-opus-4-8', vendor_id: 3, model_ratio: 2.5, completion_ratio: 5, quota_type: 0 }],
      1,
      { 3: 0.6 }
    );
    expect(out['claude-opus-4-8']).toEqual({ input: 3, output: 15 });
  });

  it('treats a MISSING quota_type as token-priced (gateways that omit the field)', () => {
    // Regression: the old `quota_type !== 0` guard dropped every row without the field, blanking the table.
    const out = convertRows([{ model_name: 'qwen-max', model_ratio: 0.8, completion_ratio: 4 }]);
    expect(out['qwen-max']).toEqual({ input: 1.6, output: 6.4 });
  });

  it('coerces string-encoded ratios', () => {
    const out = convertRows([{ model_name: 'gpt-4o', model_ratio: '1.25', completion_ratio: '4', quota_type: 0 }]);
    expect(out['gpt-4o']).toEqual({ input: 2.5, output: 10 });
  });

  it('accepts `model` as a fallback name key', () => {
    const out = convertRows([{ model: 'glm-5', model_ratio: 0.5, completion_ratio: 2, quota_type: 0 }]);
    expect(out['glm-5']).toEqual({ input: 1, output: 2 });
  });
});

describe('resolveGroupRatio (new-api discount selection)', () => {
  it('returns 1 when only the default group exists (list price)', () => {
    expect(resolveGroupRatio({ group_ratio: { default: 1 }, usable_group: { default: 'x' } })).toBe(1);
  });
  it('auto-applies the single usable group when it differs from default', () => {
    expect(resolveGroupRatio({ group_ratio: { default: 1, vip: 0.7 }, usable_group: { vip: 'VIP' } })).toBe(0.7);
  });
  it('honors an explicit preferredGroup over auto-detection', () => {
    const body = { group_ratio: { default: 1, vip: 0.7, svip: 0.5 }, usable_group: { vip: 'a', svip: 'b' } };
    expect(resolveGroupRatio(body, 'svip')).toBe(0.5);
  });
  it('with several usable groups, applies the BEST (cheapest) one the account may use', () => {
    // The account qualifies for a/b; show the discounted price it is entitled to, not list/default.
    expect(resolveGroupRatio({ group_ratio: { default: 1, a: 0.8, b: 0.9 }, usable_group: { a: '', b: '' } })).toBe(0.8);
    // The reported real-world bug: discounted account was shown list price (1.0) instead of 0.8.
    expect(resolveGroupRatio({ group_ratio: { default: 1, vip: 0.8 }, usable_group: { default: '', vip: '' } })).toBe(0.8);
  });
  it('falls back to default (or 1) when no usable group is given', () => {
    expect(resolveGroupRatio({ group_ratio: { default: 0.9 } })).toBe(0.9);
    expect(resolveGroupRatio({})).toBe(1);
  });
});

describe('resolveVendorDiscounts (new-api vendor discount selection)', () => {
  it('turns percentage discounts into price multipliers', () => {
    expect(resolveVendorDiscounts({ vendors: [{ id: 3, discount: 40 }, { id: 1, discount: 10 }] })).toEqual({
      3: 0.6,
      1: 0.9,
    });
  });
});

describe('LivePriceService.fetchGatewayPrices', () => {
  function fakeFetch(body: unknown, ok = true): { fetchFn: PriceFetch; urls: string[] } {
    const urls: string[] = [];
    const fetchFn: PriceFetch = async (url) => {
      urls.push(url);
      return { ok, status: ok ? 200 : 500, text: async () => JSON.stringify(body) };
    };
    return { fetchFn, urls };
  }

  it('derives /api/pricing from a gateway base URL and parses an array body', async () => {
    const { fetchFn, urls } = fakeFetch([{ model_name: 'qwen-max', model_ratio: 0.8, completion_ratio: 4, quota_type: 0 }]);
    const svc = new LivePriceService(fetchFn);
    const prices = await svc.fetchGatewayPrices('https://computevault.unodetech.xyz/v1');
    expect(urls[0]).toBe('https://computevault.unodetech.xyz/api/pricing');
    expect(prices['qwen-max']).toEqual({ input: 1.6, output: 6.4 });
  });

  it('also accepts a {data:[…]} envelope and a full /api/pricing url', async () => {
    const { fetchFn, urls } = fakeFetch({ data: [{ model_name: 'gpt-5', model_ratio: 0.625, completion_ratio: 8, quota_type: 0 }] });
    const svc = new LivePriceService(fetchFn);
    const prices = await svc.fetchGatewayPrices('https://gw.example/api/pricing');
    expect(urls[0]).toBe('https://gw.example/api/pricing');
    expect(prices['gpt-5']).toEqual({ input: 1.25, output: 10 });
  });

  it('accepts an alternative envelope key (e.g. {models:[…]})', async () => {
    const { fetchFn } = fakeFetch({ models: [{ model_name: 'kimi-k2', model_ratio: 0.25, completion_ratio: 4, quota_type: 0 }] });
    const svc = new LivePriceService(fetchFn);
    const prices = await svc.fetchGatewayPrices('https://gw.example/api/pricing');
    expect(prices['kimi-k2']).toEqual({ input: 0.5, output: 2 }); // 0.25*2 ; 0.25*4*2
  });

  it('combines group ratio and vendor discount from the envelope', async () => {
    const { fetchFn } = fakeFetch({
      data: [{ model_name: 'claude-opus-4-8', vendor_id: 3, model_ratio: 2.5, completion_ratio: 5, quota_type: 0 }],
      group_ratio: { default: 1 },
      usable_group: { default: 'default' },
      vendors: [{ id: 3, discount: 40 }],
    });
    const svc = new LivePriceService(fetchFn);
    const prices = await svc.fetchGatewayPrices('https://gw.example/api/pricing');
    expect(prices['claude-opus-4-8']).toEqual({ input: 3, output: 15 });
  });

  it('throws on HTTP failure so the caller can fall back to the static table', async () => {
    const { fetchFn } = fakeFetch([], false);
    const svc = new LivePriceService(fetchFn);
    await expect(svc.fetchGatewayPrices('https://gw.example/v1')).rejects.toThrow(/HTTP 500/);
  });
});

describe('ModelPricing.merge', () => {
  it('overlays live prices over the defaults without mutating the shared constant', () => {
    const pricing = new ModelPricing({ 'deepseek-v4-flash': { input: 0.14, output: 0.28 } });
    pricing.merge({ 'deepseek-v4-flash': { input: 0.2, output: 0.4 }, 'new-model': { input: 1, output: 2 } });
    expect(pricing.priceFor('deepseek-v4-flash')).toEqual({ input: 0.2, output: 0.4 });
    expect(pricing.priceFor('new-model')).toEqual({ input: 1, output: 2 });
  });
});
