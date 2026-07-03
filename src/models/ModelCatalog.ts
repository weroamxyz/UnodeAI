/*---------------------------------------------------------------------------------------------
 *  UnodeAi - ModelCatalog (remotely-configurable model list service)
 *
 *  The add-agent picker needs "which models can this provider serve right now?". Hardcoding that
 *  in the extension means a release every time a gateway adds a model. Instead this service layers
 *  three sources (later ones only fill gaps, names are back-filled):
 *    1. A Roam-hosted curated catalog JSON (unode.modelCatalogUrl) — rich names + per-role hints,
 *       fully remote-controllable.
 *    2. The gateway's own GET {baseUrl}/v1/models (OpenAI-compatible) — live availability. Since
 *       Roam runs ComputeVault, editing the gateway IS remote configuration, no extension update.
 *    3. The static DEFAULT_PROVIDER_CONFIGS list — offline fallback / friendly names.
 *
 *  fetch is injected so the merge/parse/cache logic is unit-testable without network. Results are
 *  cached per (provider, baseUrl) with a TTL. Every failure degrades gracefully to the next source;
 *  the caller always also allows a free-typed model id, so an empty catalog never blocks the user.
 *--------------------------------------------------------------------------------------------*/

export interface ModelInfo {
  id: string;
  name?: string;
  vision?: boolean;
  /** Roles this model is recommended for (from the curated catalog), if any. */
  recommendedFor?: string[];
  source: 'catalog' | 'endpoint' | 'static';
}

/** Minimal fetch shape (injectable; the real one is the global fetch). */
export type CatalogFetch = (
  url: string,
  init?: { headers?: Record<string, string> }
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/** Shape of the curated catalog document at unode.modelCatalogUrl. */
interface CatalogDoc {
  providers?: Record<string, { models?: Array<{ id: string; name?: string; vision?: boolean; recommendedFor?: string[] }> }>;
}

const DEFAULT_TTL_MS = 5 * 60_000;

export class ModelCatalog {
  private cache = new Map<string, { models: ModelInfo[]; ts: number }>();
  /** Caches the curated catalog doc across providers within a session. */
  private catalogDoc: { doc: CatalogDoc | undefined; ts: number } | undefined;

  constructor(
    private staticModels: (providerKey: string) => ModelInfo[],
    private fetchFn: CatalogFetch,
    private opts: { catalogUrl?: string; ttlMs?: number; timeoutMs?: number } = {}
  ) {}

  /**
   * Models available for a provider, merged from curated catalog + live endpoint + static, with
   * names back-filled and ids de-duplicated. Cached per (provider, baseUrl).
   */
  async list(providerKey: string, baseUrl?: string, apiKey?: string): Promise<ModelInfo[]> {
    const cacheKey = `${providerKey}|${baseUrl ?? ''}`;
    const cached = this.cache.get(cacheKey);
    const ttl = this.opts.ttlMs ?? DEFAULT_TTL_MS;
    if (cached && Date.now() - cached.ts < ttl) {
      return cached.models;
    }

    const merged = new Map<string, ModelInfo>();
    const add = (m: ModelInfo): void => {
      const existing = merged.get(m.id);
      if (!existing) {
        merged.set(m.id, m);
      } else {
        // keep the higher-priority source's identity, back-fill missing display fields.
        merged.set(m.id, {
          ...existing,
          name: existing.name ?? m.name,
          vision: existing.vision ?? m.vision,
          recommendedFor: existing.recommendedFor ?? m.recommendedFor,
        });
      }
    };

    for (const m of await this.fromCatalog(providerKey)) {
      add(m);
    }
    if (baseUrl) {
      for (const m of await this.fromEndpoint(baseUrl, apiKey)) {
        add(m);
      }
    }
    for (const m of this.staticModels(providerKey)) {
      add(m);
    }

    const models = [...merged.values()];
    this.cache.set(cacheKey, { models, ts: Date.now() });
    return models;
  }

  /** Drop cached results (e.g. after the user changes the catalog URL). */
  clearCache(): void {
    this.cache.clear();
    this.catalogDoc = undefined;
  }

  // ─── Sources ──────────────────────────────────────────────────────────

  private async fromCatalog(providerKey: string): Promise<ModelInfo[]> {
    const url = this.opts.catalogUrl;
    if (!url) {
      return [];
    }
    const doc = await this.loadCatalogDoc(url);
    const entries = doc?.providers?.[providerKey]?.models ?? [];
    return entries
      .filter((m) => typeof m?.id === 'string' && m.id)
      .map((m) => ({ id: m.id, name: m.name, vision: m.vision, recommendedFor: m.recommendedFor, source: 'catalog' as const }));
  }

  private async loadCatalogDoc(url: string): Promise<CatalogDoc | undefined> {
    const ttl = this.opts.ttlMs ?? DEFAULT_TTL_MS;
    if (this.catalogDoc && Date.now() - this.catalogDoc.ts < ttl) {
      return this.catalogDoc.doc;
    }
    let doc: CatalogDoc | undefined;
    try {
      const res = await this.fetchFn(url);
      if (res.ok) {
        doc = JSON.parse(await res.text()) as CatalogDoc;
      }
    } catch {
      doc = undefined;
    }
    this.catalogDoc = { doc, ts: Date.now() };
    return doc;
  }

  private async fromEndpoint(baseUrl: string, apiKey?: string): Promise<ModelInfo[]> {
    try {
      const url = `${baseUrl.replace(/\/$/, '')}/models`;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
      }
      const res = await this.fetchFn(url, { headers });
      if (!res.ok) {
        return [];
      }
      const body = JSON.parse(await res.text());
      const data: unknown = body?.data ?? body?.models ?? body;
      if (!Array.isArray(data)) {
        return [];
      }
      return data
        .map((m: any) => (typeof m === 'string' ? m : m?.id))
        .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
        .map((id: string) => ({ id, source: 'endpoint' as const }));
    } catch {
      return [];
    }
  }
}
