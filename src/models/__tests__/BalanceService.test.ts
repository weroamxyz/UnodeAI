import { describe, it, expect } from 'vitest';
import { BalanceService, BalanceFetch, UNLIMITED_SENTINEL_USD } from '../BalanceService';

/** Route by URL suffix: subscription / usage each return their own body (or a non-OK/HTML failure). */
function routedFetch(opts: {
  sub?: unknown | { status: number } | { html: string };
  usage?: unknown | { status: number };
}): { fetchFn: BalanceFetch; urls: string[] } {
  const urls: string[] = [];
  const resp = (body: unknown, ok = true, status = 200, raw?: string) => ({
    ok,
    status,
    text: async () => (raw !== undefined ? raw : JSON.stringify(body)),
  });
  const fetchFn: BalanceFetch = async (url, init) => {
    urls.push(url);
    // sanity: the key must be sent as a Bearer header
    expect(init?.headers?.Authorization).toMatch(/^Bearer /);
    if (url.endsWith('/subscription')) {
      const s = opts.sub as { status?: number; html?: string } | undefined;
      if (s && typeof s === 'object' && 'status' in s) { return resp(null, false, s.status as number); }
      if (s && typeof s === 'object' && 'html' in s) { return resp(null, true, 200, (s as { html: string }).html); }
      return resp(opts.sub);
    }
    const u = opts.usage as { status?: number } | undefined;
    if (u && typeof u === 'object' && 'status' in u) { return resp(null, false, u.status as number); }
    return resp(opts.usage);
  };
  return { fetchFn, urls };
}

describe('BalanceService.fetchBalance', () => {
  it('returns remaining + used for a funded (finite) account', async () => {
    const { fetchFn, urls } = routedFetch({
      sub: { object: 'billing_subscription', hard_limit_usd: 12.5, system_hard_limit_usd: 100000000 },
      usage: { object: 'list', total_usage: 250 }, // cents → $2.50
    });
    const out = await new BalanceService(fetchFn).fetchBalance('https://ai.weroam.xyz/v1', 'sk-test');
    expect(out).toEqual({ unlimited: false, remainingUsd: 12.5, limitUsd: 12.5, usedUsd: 2.5 });
    expect(urls[0]).toBe('https://ai.weroam.xyz/v1/dashboard/billing/subscription');
    expect(urls[1]).toBe('https://ai.weroam.xyz/v1/dashboard/billing/usage');
  });

  it('flags an uncapped account as unlimited (placeholder hard_limit) and skips usage', async () => {
    const { fetchFn, urls } = routedFetch({ sub: { hard_limit_usd: 100000000 } });
    const out = await new BalanceService(fetchFn).fetchBalance('https://ai.weroam.xyz/v1', 'sk-test');
    expect(out).toEqual({ unlimited: true, limitUsd: 100000000 });
    expect(out!.limitUsd).toBeGreaterThanOrEqual(UNLIMITED_SENTINEL_USD);
    expect(urls).toHaveLength(1); // usage not fetched when unlimited
  });

  it('coerces string-encoded amounts', async () => {
    const { fetchFn } = routedFetch({ sub: { hard_limit_usd: '7.25' }, usage: { total_usage: '100' } });
    const out = await new BalanceService(fetchFn).fetchBalance('https://gw/v1', 'sk-test');
    expect(out).toEqual({ unlimited: false, remainingUsd: 7.25, limitUsd: 7.25, usedUsd: 1 });
  });

  it('still returns the balance when the usage endpoint fails', async () => {
    const { fetchFn } = routedFetch({ sub: { hard_limit_usd: 5 }, usage: { status: 500 } });
    const out = await new BalanceService(fetchFn).fetchBalance('https://gw/v1', 'sk-test');
    expect(out).toEqual({ unlimited: false, remainingUsd: 5, limitUsd: 5, usedUsd: undefined });
  });

  it('degrades to undefined when the subscription endpoint is absent (HTML / non-200 / no field)', async () => {
    const svc = (sub: unknown) => new BalanceService(routedFetch({ sub }).fetchFn).fetchBalance('https://gw/v1', 'sk-test');
    expect(await svc({ status: 404 } as never)).toBeUndefined();
    expect(await svc({ html: '<!doctype html><html></html>' } as never)).toBeUndefined();
    expect(await svc({ object: 'billing_subscription' /* no hard_limit_usd */ })).toBeUndefined();
  });

  it('returns undefined with no base url or no key', async () => {
    const { fetchFn } = routedFetch({ sub: { hard_limit_usd: 5 } });
    expect(await new BalanceService(fetchFn).fetchBalance('', 'sk-test')).toBeUndefined();
    expect(await new BalanceService(fetchFn).fetchBalance('https://gw/v1', '')).toBeUndefined();
  });

  it('tolerates a trailing slash on the base url', async () => {
    const { fetchFn, urls } = routedFetch({ sub: { hard_limit_usd: 3 }, usage: { total_usage: 0 } });
    await new BalanceService(fetchFn).fetchBalance('https://gw/v1/', 'sk-test');
    expect(urls[0]).toBe('https://gw/v1/dashboard/billing/subscription');
  });
});
