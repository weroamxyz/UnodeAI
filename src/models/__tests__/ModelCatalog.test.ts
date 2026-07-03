import { describe, it, expect, vi } from 'vitest';
import { ModelCatalog, CatalogFetch, ModelInfo } from '../ModelCatalog';

const staticFor = (models: Record<string, ModelInfo[]>) => (pk: string) => models[pk] ?? [];

/** A fetch that maps url substrings to scripted JSON bodies; records calls. */
function routeFetch(routes: Array<{ match: string; status?: number; body: unknown }>): { fetchFn: CatalogFetch; calls: string[] } {
  const calls: string[] = [];
  const fetchFn: CatalogFetch = async (url) => {
    calls.push(url);
    const r = routes.find((x) => url.includes(x.match));
    if (!r) {
      return { ok: false, status: 404, text: async () => 'not found' };
    }
    return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, text: async () => JSON.stringify(r.body) };
  };
  return { fetchFn, calls };
}

describe('ModelCatalog', () => {
  it('parses the gateway /v1/models endpoint (OpenAI shape)', async () => {
    const { fetchFn } = routeFetch([{ match: '/models', body: { data: [{ id: 'deepseek-v4-flash' }, { id: 'qwen-max' }] } }]);
    const cat = new ModelCatalog(staticFor({}), fetchFn);
    const models = await cat.list('roam', 'https://gw.example/v1');
    expect(models.map((m) => m.id)).toEqual(['deepseek-v4-flash', 'qwen-max']);
    expect(models[0].source).toBe('endpoint');
  });

  it('merges curated catalog (rich names win) with the live endpoint and back-fills names', async () => {
    const { fetchFn } = routeFetch([
      { match: 'catalog.json', body: { providers: { roam: { models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', recommendedFor: ['senior-dev'] }] } } } },
      { match: '/v1/models', body: { data: [{ id: 'deepseek-v4-flash' }, { id: 'new-model-x' }] } },
    ]);
    const cat = new ModelCatalog(staticFor({}), fetchFn, { catalogUrl: 'https://roam.example/catalog.json' });
    const models = await cat.list('roam', 'https://gw.example/v1');
    const flash = models.find((m) => m.id === 'deepseek-v4-flash')!;
    expect(flash.name).toBe('DeepSeek V4 Flash');
    expect(flash.source).toBe('catalog');
    expect(flash.recommendedFor).toEqual(['senior-dev']);
    // The endpoint contributed a model the catalog didn't list.
    expect(models.map((m) => m.id)).toContain('new-model-x');
  });

  it('falls back to static models when the endpoint and catalog fail', async () => {
    const { fetchFn } = routeFetch([]); // every fetch 404s
    const cat = new ModelCatalog(
      staticFor({ roam: [{ id: 'deepseek-v4-flash', name: 'Flash', source: 'static' }] }),
      fetchFn,
      { catalogUrl: 'https://roam.example/catalog.json' }
    );
    const models = await cat.list('roam', 'https://gw.example/v1');
    expect(models).toEqual([{ id: 'deepseek-v4-flash', name: 'Flash', source: 'static' }]);
  });

  it('backfills a static name onto an endpoint-discovered id', async () => {
    const { fetchFn } = routeFetch([{ match: '/v1/models', body: { data: [{ id: 'gpt-4o' }] } }]);
    const cat = new ModelCatalog(staticFor({ openai: [{ id: 'gpt-4o', name: 'GPT-4o', vision: true, source: 'static' }] }), fetchFn);
    const models = await cat.list('openai', 'https://api.openai.com/v1');
    expect(models[0]).toMatchObject({ id: 'gpt-4o', name: 'GPT-4o', vision: true, source: 'endpoint' });
  });

  it('works with no baseUrl (static only)', async () => {
    const { fetchFn, calls } = routeFetch([]);
    const cat = new ModelCatalog(staticFor({ anthropic: [{ id: 'claude-sonnet-4', source: 'static' }] }), fetchFn);
    const models = await cat.list('anthropic');
    expect(models.map((m) => m.id)).toEqual(['claude-sonnet-4']);
    expect(calls).toEqual([]); // no catalog url, no baseUrl -> no network
  });

  it('caches results per (provider, baseUrl) within the TTL', async () => {
    const fetchSpy = vi.fn<Parameters<CatalogFetch>, ReturnType<CatalogFetch>>(async () => ({
      ok: true, status: 200, text: async () => JSON.stringify({ data: [{ id: 'm1' }] }),
    }));
    const cat = new ModelCatalog(staticFor({}), fetchSpy, { ttlMs: 10_000 });
    await cat.list('roam', 'https://gw.example/v1');
    await cat.list('roam', 'https://gw.example/v1');
    expect(fetchSpy).toHaveBeenCalledTimes(1); // second call served from cache
  });
});
