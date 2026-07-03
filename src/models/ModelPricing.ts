/*---------------------------------------------------------------------------------------------
 *  UnodeAi - ModelPricing
 *  Estimates USD cost from token usage for backends that report tokens but not cost.
 *
 *  The Claude headless backend reports real `total_cost_usd`; OpenAI-compatible gateways (Roam /
 *  算力仓 / OpenAI …) report only token counts. Since the whole product narrative is cost
 *  arbitrage, the Dashboard needs a dollar figure — so we estimate it from a per-model price table.
 *
 *  Prices are USD per 1M tokens and are APPROXIMATE; users/Roam can override or extend the table
 *  via the `roam.modelPrices` setting. Matching is exact-id first, then the longest table key that
 *  the model id contains (so `claude-opus-4-5` and `anthropic/claude-opus…` both map to opus).
 *--------------------------------------------------------------------------------------------*/

export interface ModelPrice {
  /** USD per 1,000,000 input tokens. */
  input: number;
  /** USD per 1,000,000 output tokens. */
  output: number;
}

/**
 * Prices in USD / 1M tokens, derived from the Roam ComputeVault gateway's published ratios
 * (https://www.unodetech.xyz/pricing, GET /api/pricing — snapshot 2026-06-02). These are what a
 * Roam user actually pays, so estimates match their bill. Conversion (new-api convention,
 * verified against gpt-4o = OpenAI list): input = model_ratio × 2, output = model_ratio ×
 * completion_ratio × 2, then apply live gateway discounts when available. Override/extend via the
 * `roam.modelPrices` setting.
 *
 * Keys match by substring (longest-first), so `claude-opus` covers claude-opus-4-5/4-6/4-7/4-8.
 */
export const DEFAULT_MODEL_PRICES: Record<string, ModelPrice> = {
  // DeepSeek (cheap "muscle" models — the demo team's default)
  'deepseek-v4-flash': { input: 0.14, output: 0.28 },
  'deepseek-v4-pro': { input: 0.435, output: 0.87 },
  // Qwen
  'qwen-max': { input: 1.6, output: 6.4 },
  'qwen-plus': { input: 0.4, output: 1.2 },
  // OpenAI
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-4.1': { input: 2, output: 8 },
  'gpt-5-mini': { input: 0.25, output: 2 },
  'gpt-5': { input: 1.25, output: 10 },
  // Anthropic (gateway BASE ratios — do NOT bake the vendor discount in here; it varies (and VIP group
  // ratios are coming). LivePriceService applies group_ratio × vendor_discount on top from live data.
  // This static table is only the offline fallback, so it stays at base; live values override it.)
  'claude-haiku': { input: 1, output: 5 },
  'claude-sonnet': { input: 3, output: 15 },
  'claude-opus': { input: 5, output: 25 },
  // Google
  'gemini-2.5-flash': { input: 0.3, output: 2.5 },
  'gemini-2.5-pro': { input: 1.25, output: 10 },
  'gemini-3-flash-preview': { input: 0.5, output: 3 },
  'gemini-3-pro-preview': { input: 2, output: 12 },
  // Others on the gateway
  'glm-5.1': { input: 1.4, output: 4.4 },
  'glm-5': { input: 1, output: 3.2 },
  'kimi-k2.6': { input: 0.95, output: 4 },
  'grok-4': { input: 1.25, output: 2.5 },
};

export class ModelPricing {
  private prices: Record<string, ModelPrice>;
  /** Table keys sorted longest-first so a more specific id wins (claude-opus before claude). */
  private keys: string[];

  constructor(prices: Record<string, ModelPrice> = DEFAULT_MODEL_PRICES) {
    // Clone so live refreshes (merge) never mutate the shared DEFAULT_MODEL_PRICES constant.
    this.prices = { ...prices };
    this.keys = this.sortedKeys();
  }

  /**
   * Merge live prices (e.g. fetched from a gateway's /api/pricing) over the current table. Exact
   * model ids overwrite; the static defaults remain as fallback for ids the source doesn't cover.
   */
  merge(prices: Record<string, ModelPrice>): void {
    Object.assign(this.prices, prices);
    this.keys = this.sortedKeys();
  }

  private sortedKeys(): string[] {
    return Object.keys(this.prices).sort((a, b) => b.length - a.length);
  }

  /** The price entry for a model id, or undefined if unknown. */
  priceFor(model: string): ModelPrice | undefined {
    if (this.prices[model]) {
      return this.prices[model];
    }
    const key = this.keys.find((k) => model.includes(k));
    return key ? this.prices[key] : undefined;
  }

  /** Estimated USD cost for a turn, or undefined when the model isn't in the table. */
  estimate(model: string, inputTokens: number, outputTokens: number): number | undefined {
    const p = this.priceFor(model);
    if (!p) {
      return undefined;
    }
    return (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output;
  }
}
