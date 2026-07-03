/*---------------------------------------------------------------------------------------------
 *  UnodeAi - LivePriceService
 *  Fetches live model prices from a new-api gateway's /api/pricing and converts them to USD,
 *  so the cost table stays current without an extension release.
 *
 *  Conversion (new-api / one-api convention, verified against gpt-4o = OpenAI list price):
 *    input  USD / 1M tokens = model_ratio × 2
 *    output USD / 1M tokens = model_ratio × completion_ratio × 2
 *  (The ×2 is the standard "$1 = 500,000 quota" base. Per-call media pricing — quota_type 1 with a
 *   flat model_price — is skipped here since we only estimate token cost.)
 *
 *  Roam/new-api discounts are applied after conversion: account group_ratio and vendor discount.
 *
 *  Same logic for ANY new-api gateway: ComputeVault/Roam automatically, and "platforms we don't
 *  control" by giving their base/pricing URL via roam.pricingSources. A site that does NOT expose
 *  a new-api-style /api/pricing (e.g. a hand-written HTML pricing page) can't be parsed reliably —
 *  use the roam.modelPrices manual override for those.
 *--------------------------------------------------------------------------------------------*/

import { ModelPrice } from './ModelPricing';

/** Injectable fetch (real one is global fetch) — keeps parsing/conversion unit-testable. */
export type PriceFetch = (
  url: string,
  init?: { headers?: Record<string, string> }
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/** new-api default: a model_ratio of 1 == $2 per 1M input tokens. */
const USD_PER_RATIO_UNIT = 2;

interface NewApiRow {
  model_name?: string;
  /** Some gateways key the model name as `model` instead of `model_name` — accepted as a fallback. */
  model?: string;
  vendor_id?: number;
  // Ratios may arrive as numbers or numeric strings depending on the gateway — coerced via toNum().
  model_ratio?: number | string;
  completion_ratio?: number | string;
  quota_type?: number;
}

/** Coerce a number-or-numeric-string to a number; undefined/NaN/non-finite → undefined. */
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

/**
 * Extract the array of price rows from a new-api body. The rows may be the top-level value or nested
 * under one of several common envelope keys (gateways differ slightly) — the first array found wins.
 */
function extractRows(body: unknown): NewApiRow[] {
  if (Array.isArray(body)) {
    return body as NewApiRow[];
  }
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    for (const key of ['data', 'rows', 'list', 'models', 'prices']) {
      if (Array.isArray(b[key])) {
        return b[key] as NewApiRow[];
      }
    }
  }
  return [];
}

interface NewApiVendor {
  id?: number;
  discount?: number;
}

export class LivePriceService {
  constructor(private fetchFn: PriceFetch) {}

  /**
   * Fetch a new-api gateway's pricing and convert to a USD/1M price table. Accepts either the
   * gateway base URL (…/v1) or a full …/api/pricing URL. Throws on network/HTTP failure so the
   * caller can log-and-fallback to the static table.
   *
   * `preferredGroup` lets the user pin their billing group (roam.priceGroup) when the gateway
   * exposes several; otherwise we auto-pick the single usable group, else "default".
   */
  async fetchGatewayPrices(
    baseOrPricingUrl: string,
    apiKey?: string,
    preferredGroup?: string
  ): Promise<Record<string, ModelPrice>> {
    const url = this.pricingUrl(baseOrPricingUrl);
    const headers: Record<string, string> = {};
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }
    const res = await this.fetchFn(url, { headers });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from ${url}`);
    }
    const body = JSON.parse(await res.text());
    return convertRows(extractRows(body), resolveGroupRatio(body, preferredGroup), resolveVendorDiscounts(body));
  }

  /** Resolve a base URL (…/v1) or a full pricing URL to the /api/pricing endpoint. */
  private pricingUrl(input: string): string {
    if (/\/api\/pricing\/?$/.test(input)) {
      return input;
    }
    return new URL('/api/pricing', input).href; // absolute path -> origin + /api/pricing
  }
}

/**
 * Pick the discount multiplier to apply from a new-api /api/pricing body. new-api returns
 * `group_ratio` (group → multiplier) and `usable_group` (groups this account/key may use). The
 * effective price = base × group_ratio[user's group]; ignoring it shows list price, not the user's
 * discounted price. Selection:
 *   1. explicit `preferredGroup` (roam.priceGroup), when valid; else
 *   2. the BEST (lowest multiplier) group the account is entitled to use — so a discounted account
 *      sees its discounted price instead of list price (the old code fell back to "default" = list
 *      when there were several usable groups, which is the bug this fixes); else
 *   3. "default", else 1 (no discount).
 */
export function resolveGroupRatio(body: unknown, preferredGroup?: string): number {
  const b = (body && typeof body === 'object' ? body : {}) as {
    group_ratio?: Record<string, unknown>;
    usable_group?: Record<string, unknown>;
  };
  const groupRatio = b.group_ratio && typeof b.group_ratio === 'object' ? b.group_ratio : {};
  const usable = b.usable_group && typeof b.usable_group === 'object' ? Object.keys(b.usable_group) : [];
  const ratioOf = (g: string): number | undefined => {
    const r = groupRatio[g];
    return typeof r === 'number' && r > 0 ? r : undefined;
  };

  // 1. Explicit pin.
  const pref = preferredGroup?.trim();
  if (pref) {
    const r = ratioOf(pref);
    if (r !== undefined) {
      return r;
    }
  }

  // 2. Best (cheapest) group the account may use.
  const usableRatios = usable.map(ratioOf).filter((r): r is number => r !== undefined);
  if (usableRatios.length > 0) {
    return Math.min(...usableRatios);
  }

  // 3. Fall back to the default group's ratio, else no discount.
  return ratioOf('default') ?? 1;
}

/**
 * Build per-vendor price multipliers from new-api's `vendors[].discount` field. The public Roam
 * pricing endpoint currently reports account group ratios separately from vendor discounts; both
 * affect the displayed/user-facing price. `discount: 40` means the user pays 60% of the base ratio.
 */
export function resolveVendorDiscounts(body: unknown): Record<number, number> {
  const b = (body && typeof body === 'object' ? body : {}) as { vendors?: unknown };
  const vendors = Array.isArray(b.vendors) ? (b.vendors as NewApiVendor[]) : [];
  const out: Record<number, number> = {};
  for (const vendor of vendors) {
    if (!vendor || typeof vendor.id !== 'number' || typeof vendor.discount !== 'number') {
      continue;
    }
    if (vendor.discount <= 0 || vendor.discount >= 100) {
      continue;
    }
    out[vendor.id] = (100 - vendor.discount) / 100;
  }
  return out;
}

/** Exposed for testing: convert new-api rows to a USD/1M price table (token models only). */
export function convertRows(
  rows: NewApiRow[],
  groupRatio = 1,
  vendorDiscounts: Record<number, number> = {}
): Record<string, ModelPrice> {
  const discount = typeof groupRatio === 'number' && groupRatio > 0 ? groupRatio : 1;
  const out: Record<string, ModelPrice> = {};
  for (const r of rows) {
    if (!r) {
      continue;
    }
    const name = typeof r.model_name === 'string' ? r.model_name : typeof r.model === 'string' ? r.model : undefined;
    if (!name) {
      continue;
    }
    // quota_type 1 = flat per-call (image/video/audio) — not token-priced; skip. A MISSING quota_type is
    // treated as token-priced (0): some gateways omit the field, and dropping those rows blanked the table.
    if (typeof r.quota_type === 'number' && r.quota_type !== 0) {
      continue;
    }
    const ratio = toNum(r.model_ratio) ?? 0;
    if (!(ratio > 0)) {
      continue;
    }
    const completionRatio = toNum(r.completion_ratio);
    const completion = completionRatio && completionRatio > 0 ? completionRatio : 1;
    const vendorMultiplier = typeof r.vendor_id === 'number' ? vendorDiscounts[r.vendor_id] ?? 1 : 1;
    const effectiveMultiplier = discount * vendorMultiplier;
    out[name] = {
      input: ratio * USD_PER_RATIO_UNIT * effectiveMultiplier,
      output: ratio * completion * USD_PER_RATIO_UNIT * effectiveMultiplier,
    };
  }
  return out;
}
