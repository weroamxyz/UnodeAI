/*---------------------------------------------------------------------------------------------
 *  UnodeAi - BalanceService (0.9.7)
 *  Fetches a new-api gateway account's remaining balance via the OpenAI-compatible billing endpoints,
 *  so the Providers tab can show live credits + a low-balance warning.
 *
 *  Endpoints (authenticated with the SAME chat API key — verified against ai.weroam.xyz):
 *    GET {base}/dashboard/billing/subscription  → { hard_limit_usd, soft_limit_usd, system_hard_limit_usd }
 *    GET {base}/dashboard/billing/usage         → { total_usage }  (US cents)
 *  new-api reports the account's REMAINING quota (in USD) as `hard_limit_usd`; `total_usage` is the
 *  historical spend in cents. The native `/api/user/self` needs a login session (not the API key), so
 *  it is intentionally NOT used.
 *
 *  Degrades silently: a missing endpoint, non-200, non-JSON body, or absent numeric field → undefined,
 *  so the caller simply shows nothing. Injectable fetch keeps parsing unit-testable without network.
 *--------------------------------------------------------------------------------------------*/

/** Injectable fetch (real one is global fetch) — same shape as LivePriceService.PriceFetch. */
export type BalanceFetch = (
  url: string,
  init?: { headers?: Record<string, string> }
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/**
 * A `hard_limit_usd` at or above this is treated as "unlimited" (a new-api placeholder for uncapped
 * tokens — e.g. weroam returns 100,000,000). No real funded account holds a million dollars of credit.
 */
export const UNLIMITED_SENTINEL_USD = 1_000_000;

export interface BalanceInfo {
  /** Remaining credit in USD (new-api: `hard_limit_usd`). Absent if unlimited or unparseable. */
  remainingUsd?: number;
  /** Historical spend in USD (`total_usage` cents / 100). Absent if the usage endpoint failed. */
  usedUsd?: number;
  /** The raw `hard_limit_usd` (USD). Same as remainingUsd for finite accounts; large when unlimited. */
  limitUsd?: number;
  /** True when the account is uncapped (placeholder limit) — show "Unlimited", never warn. */
  unlimited: boolean;
}

/** Coerce a number-or-numeric-string to a finite number; otherwise undefined. */
function toNum(v: unknown): number | undefined {
  if (typeof v === 'number') {
    return Number.isFinite(v) ? v : undefined;
  }
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

export class BalanceService {
  constructor(private fetchFn: BalanceFetch) {}

  /**
   * Fetch the account balance for a new-api gateway. `baseOrV1Url` is the gateway base (…/v1). Returns
   * undefined (never throws) on any failure so the caller degrades silently.
   */
  async fetchBalance(baseOrV1Url: string, apiKey?: string): Promise<BalanceInfo | undefined> {
    const base = stripTrailingSlash((baseOrV1Url || '').trim());
    if (!base || !apiKey) {
      return undefined;
    }
    const headers = { Authorization: `Bearer ${apiKey}` };

    // Subscription is the source of truth for the balance — if it fails, there's nothing to show.
    const sub = await this.getJson(`${base}/dashboard/billing/subscription`, headers);
    const hard = toNum((sub as { hard_limit_usd?: unknown })?.hard_limit_usd);
    if (hard === undefined) {
      return undefined; // endpoint absent / not JSON / unexpected shape → degrade silently
    }

    if (hard >= UNLIMITED_SENTINEL_USD) {
      return { unlimited: true, limitUsd: hard };
    }

    // Usage is best-effort — a failure here still leaves a usable balance.
    const usage = await this.getJson(`${base}/dashboard/billing/usage`, headers);
    const usedCents = toNum((usage as { total_usage?: unknown })?.total_usage);

    return {
      unlimited: false,
      remainingUsd: hard,
      limitUsd: hard,
      usedUsd: usedCents === undefined ? undefined : usedCents / 100,
    };
  }

  /** GET + JSON.parse, returning undefined on any non-200 / network / parse error (never throws). */
  private async getJson(url: string, headers: Record<string, string>): Promise<unknown> {
    try {
      const res = await this.fetchFn(url, { headers });
      if (!res.ok) {
        return undefined;
      }
      return JSON.parse(await res.text());
    } catch {
      return undefined;
    }
  }
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/$/, '');
}
