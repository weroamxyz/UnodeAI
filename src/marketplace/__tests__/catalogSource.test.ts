import { describe, it, expect, vi } from 'vitest';
import { generateKeyPairSync, sign as edSign } from 'crypto';
import { parseCatalogResilient, fetchHostedCatalog, resolveCatalog, verifyCatalogSignature } from '../catalogSource';

const validAgent = {
  id: 'dev', name: 'Developer', role: 'developer', summary: 's',
  skills: ['code-generation'], model: 'claude-sonnet-4-6', tier: 'standard', systemPrompt: 'p',
};
const validMcp = { id: 'fs', name: 'Filesystem', summary: 's', transport: 'stdio', command: 'npx' };

/** Response whose body is delivered via text() (what the source reads) and json() (belt-and-suspenders). */
function textResponse(body: unknown, ok = true): Response {
  const s = typeof body === 'string' ? body : JSON.stringify(body);
  return { ok, text: async () => s, json: async () => JSON.parse(s) } as unknown as Response;
}

/** Fetch fake that routes by exact URL: missing entries resolve to a non-OK response. */
function routedFetch(map: Record<string, Response>) {
  return vi.fn(async (url: string) => map[url] ?? ({ ok: false } as unknown as Response));
}

describe('parseCatalogResilient', () => {
  it('parses all three sections', () => {
    const cat = parseCatalogResilient({ agents: [validAgent], mcp: [validMcp], skills: [] });
    expect(cat.agents).toHaveLength(1);
    expect(cat.mcp).toHaveLength(1);
  });
  it('one bad section becomes [] without throwing or blanking the others', () => {
    const warn = vi.fn();
    const cat = parseCatalogResilient({ agents: [{ id: 'x' }], mcp: [validMcp], skills: [] }, warn);
    expect(cat.agents).toEqual([]); // invalid agent → dropped
    expect(cat.mcp).toHaveLength(1); // mcp survives
    expect(warn).toHaveBeenCalled();
  });
  it('treats missing sections as empty', () => {
    expect(parseCatalogResilient({})).toEqual({ agents: [], mcp: [], skills: [] });
  });
});

describe('fetchHostedCatalog (no signature verification)', () => {
  it('returns the parsed body on success', async () => {
    const fetchImpl = vi.fn(async () => textResponse({ agents: [validAgent] }));
    const out = await fetchHostedCatalog({ url: 'https://x/catalog.json', fetchImpl: fetchImpl as never });
    expect(out).toEqual({ agents: [validAgent] });
  });
  it('returns undefined with no url', async () => {
    expect(await fetchHostedCatalog({ url: '' })).toBeUndefined();
  });
  it('returns undefined on non-OK status', async () => {
    const fetchImpl = vi.fn(async () => textResponse({}, false));
    expect(await fetchHostedCatalog({ url: 'https://x', fetchImpl: fetchImpl as never })).toBeUndefined();
  });
  it('returns undefined when fetch throws (offline)', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('ENOTFOUND'); });
    expect(await fetchHostedCatalog({ url: 'https://x', fetchImpl: fetchImpl as never })).toBeUndefined();
  });
  it('returns undefined on unparseable body', async () => {
    const fetchImpl = vi.fn(async () => textResponse('not json{', true));
    expect(await fetchHostedCatalog({ url: 'https://x', fetchImpl: fetchImpl as never })).toBeUndefined();
  });
});

describe('verifyCatalogSignature (Ed25519)', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pubPem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
  const bytes = '{"agents":[]}';
  const sig = edSign(null, Buffer.from(bytes, 'utf8'), privateKey).toString('base64');

  it('verifies a correct detached signature over the exact bytes', () => {
    expect(verifyCatalogSignature(bytes, sig, pubPem)).toBe(true);
  });
  it('rejects when the bytes were tampered with', () => {
    expect(verifyCatalogSignature(bytes + ' ', sig, pubPem)).toBe(false);
  });
  it('rejects a blank key or blank signature (returns false, never throws)', () => {
    expect(verifyCatalogSignature(bytes, sig, '')).toBe(false);
    expect(verifyCatalogSignature(bytes, '', pubPem)).toBe(false);
  });
  it('rejects a signature from a different key', () => {
    const other = generateKeyPairSync('ed25519');
    const otherSig = edSign(null, Buffer.from(bytes, 'utf8'), other.privateKey).toString('base64');
    expect(verifyCatalogSignature(bytes, otherSig, pubPem)).toBe(false);
  });
});

describe('fetchHostedCatalog (signature verification)', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pubPem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
  const url = 'https://x/catalog.json';
  const sigUrl = `${url}.sig`;
  const body = JSON.stringify({ agents: [validAgent] });
  const goodSig = edSign(null, Buffer.from(body, 'utf8'), privateKey).toString('base64');

  it('merges when the signature is valid', async () => {
    const fetchImpl = routedFetch({ [url]: textResponse(body), [sigUrl]: textResponse(goodSig) });
    const out = await fetchHostedCatalog({ url, fetchImpl: fetchImpl as never, verify: { publicKeyPem: pubPem } });
    expect(out).toEqual({ agents: [validAgent] });
  });

  it('rejects (undefined) and warns when a present signature does NOT verify', async () => {
    const warn = vi.fn();
    const fetchImpl = routedFetch({ [url]: textResponse(body), [sigUrl]: textResponse('AAAA') });
    const out = await fetchHostedCatalog({ url, fetchImpl: fetchImpl as never, verify: { publicKeyPem: pubPem }, warn });
    expect(out).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('did NOT verify'));
  });

  it('merges with an unsigned warning when no signature is published (transition window)', async () => {
    const warn = vi.fn();
    const fetchImpl = routedFetch({ [url]: textResponse(body) }); // no .sig route → non-OK
    const out = await fetchHostedCatalog({ url, fetchImpl: fetchImpl as never, verify: { publicKeyPem: pubPem }, warn });
    expect(out).toEqual({ agents: [validAgent] });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unsigned'));
  });
});

describe('resolveCatalog', () => {
  it('returns bundled only when no hosted source', async () => {
    const cat = await resolveCatalog({ bundled: { agents: [validAgent], mcp: [validMcp], skills: [] } });
    expect(cat.agents).toHaveLength(1);
    expect(cat.mcp).toHaveLength(1);
  });

  it('merges hosted over bundled (hosted wins on id collision)', async () => {
    const hostedAgent = { ...validAgent, name: 'Hosted Dev' };
    const fetchImpl = vi.fn(async () => textResponse({ agents: [hostedAgent] }));
    const cat = await resolveCatalog({
      bundled: { agents: [validAgent], mcp: [validMcp], skills: [] },
      hosted: { url: 'https://x', fetchImpl: fetchImpl as never },
    });
    expect(cat.agents).toHaveLength(1);
    expect(cat.agents[0].name).toBe('Hosted Dev'); // override wins
    expect(cat.mcp).toHaveLength(1); // bundled mcp preserved
  });

  it('falls back to bundled when the hosted fetch fails', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('offline'); });
    const cat = await resolveCatalog({
      bundled: { agents: [validAgent], mcp: [], skills: [] },
      hosted: { url: 'https://x', fetchImpl: fetchImpl as never },
    });
    expect(cat.agents).toHaveLength(1);
  });

  it('falls back to bundled when a present hosted signature does not verify', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const pubPem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
    const url = 'https://x/catalog.json';
    const body = JSON.stringify({ agents: [{ ...validAgent, name: 'Hosted Dev' }] });
    // sign DIFFERENT bytes so the signature is present but invalid for `body`
    const badSig = edSign(null, Buffer.from('tampered', 'utf8'), privateKey).toString('base64');
    const fetchImpl = routedFetch({ [url]: textResponse(body), [`${url}.sig`]: textResponse(badSig) });
    const cat = await resolveCatalog({
      bundled: { agents: [validAgent], mcp: [], skills: [] },
      hosted: { url, fetchImpl: fetchImpl as never, verify: { publicKeyPem: pubPem } },
    });
    expect(cat.agents).toHaveLength(1);
    expect(cat.agents[0].name).toBe('Developer'); // bundled, not the unverified hosted override
  });
});
