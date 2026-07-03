/*---------------------------------------------------------------------------------------------
 *  UnodeAi - Marketplace catalog source (v0.6.1a)
 *  Resolves the effective catalog = the bundled in-repo catalog, optionally merged with a
 *  Roam-hosted catalog fetched at runtime (hosted wins on id collisions). This is the vehicle that
 *  lets the catalog grow WITHOUT shipping a new VSIX each time. Offline-safe: any fetch/parse
 *  failure falls back to the bundled set; one bad section never blanks the rest. No vscode coupling
 *  here (the reader/config/fetch are injected) so it's unit-testable.
 *--------------------------------------------------------------------------------------------*/

import { createPublicKey, verify as cryptoVerify } from 'crypto';
import {
  CatalogSourceName,
  MarketplaceCatalog,
  mergeCatalogs,
  parseAgentCatalog,
  parseMcpCatalog,
  parseSkillCatalog,
} from './catalog';

/**
 * Ed25519 PUBLIC key (SPKI PEM) that signs the hosted catalog in weroamxyz/roam-skills. Bundled in the
 * VSIX so a tampered hosted push can't change what installs fetch. The matching PRIVATE key lives only in
 * the publish secret store and never enters this repo.
 *
 * ⚠️ PLACEHOLDER — replace with the real public key before turning protection on:
 *   1. `node scripts/sign-catalog.mjs --genkey` → keep the private PEM secret, copy the public PEM here.
 *   2. Sign on publish: `node scripts/sign-catalog.mjs catalog.json <private-key.pem>` → commit
 *      `catalog.json` + `catalog.json.sig` to roam-skills.
 * While this is blank/invalid the catalog runs in the warn-only transition (see fetchHostedCatalog): an
 * unsigned hosted catalog still merges (with a warning); a present-but-unverifiable `.sig` is rejected.
 */
export const ROAM_CATALOG_PUBLIC_KEY_PEM = '';

/**
 * Verify a detached Ed25519 signature (base64) over the exact catalog bytes against an SPKI-PEM public key.
 * Never throws: a blank/invalid key, malformed signature, or any crypto error → false (treated as a failed
 * verification by the caller). Verifying the raw fetched bytes (not a re-serialized object) is essential.
 */
export function verifyCatalogSignature(bytes: string, signatureB64: string, publicKeyPem: string): boolean {
  if (!publicKeyPem.trim() || !signatureB64.trim()) {
    return false;
  }
  try {
    const key = createPublicKey(publicKeyPem);
    return cryptoVerify(null, Buffer.from(bytes, 'utf8'), key, Buffer.from(signatureB64.trim(), 'base64'));
  } catch {
    return false;
  }
}

/** Untrusted, unparsed catalog payload (from a bundled file or a hosted endpoint). */
export interface RawCatalog {
  agents?: unknown;
  mcp?: unknown;
  skills?: unknown;
}

/**
 * Parse a raw {agents,mcp,skills} payload section by section. A missing/invalid section becomes []
 * (reported via `warn`) instead of throwing — so one broken section can't blank the others.
 */
export function parseCatalogResilient(raw: RawCatalog, warn: (msg: string) => void = () => {}): MarketplaceCatalog {
  const section = <T>(name: CatalogSourceName, value: unknown, parse: (r: unknown) => T[]): T[] => {
    try {
      return parse(value ?? []);
    } catch (err) {
      warn(`${name} catalog skipped: ${String(err)}`);
      return [];
    }
  };
  return {
    agents: section('agents', raw.agents, parseAgentCatalog),
    mcp: section('mcp', raw.mcp, parseMcpCatalog),
    skills: section('skills', raw.skills, parseSkillCatalog),
  };
}

export interface HostedCatalogOptions {
  url: string;
  timeoutMs?: number;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /**
   * When set, the hosted catalog is integrity-checked against a detached Ed25519 signature. The signature
   * is fetched from `sigUrl` (default `${url}.sig`). Behavior (warn-only transition):
   *  - signature present & valid  → merge;
   *  - signature present & invalid → reject (return undefined) + warn (tamper / wrong key);
   *  - signature absent           → merge anyway + warn it was unsigned (until roam-skills publishes one).
   * Omit `verify` entirely to skip integrity checking (used by unit tests that don't exercise signing).
   */
  verify?: { publicKeyPem: string; sigUrl?: string };
  /** Optional diagnostics sink (threaded from resolveCatalog). */
  warn?: (msg: string) => void;
}

/**
 * Fetch a hosted catalog JSON ({agents,mcp,skills}). Offline-safe: a missing url, non-OK status,
 * timeout, network error, or non-object/unparseable body all resolve to `undefined` (caller falls back).
 * When `verify` is set, the raw bytes are checked against a detached Ed25519 signature first.
 */
export async function fetchHostedCatalog(o: HostedCatalogOptions): Promise<RawCatalog | undefined> {
  const doFetch = o.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : undefined);
  if (!doFetch || !o.url) {
    return undefined;
  }
  const warn = o.warn ?? (() => {});
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), o.timeoutMs ?? 5000);
  try {
    const res = await doFetch(o.url, { signal: controller.signal });
    if (!res.ok) {
      return undefined;
    }
    const text = await res.text(); // raw bytes — signature must be verified over exactly what we parse

    if (o.verify) {
      const sigUrl = o.verify.sigUrl ?? `${o.url}.sig`;
      let sig: string | undefined;
      try {
        const sigRes = await doFetch(sigUrl, { signal: controller.signal });
        if (sigRes.ok) {
          sig = await sigRes.text();
        }
      } catch {
        // no signature available — handled as the unsigned (transition) case below
      }
      if (sig && sig.trim()) {
        if (!verifyCatalogSignature(text, sig, o.verify.publicKeyPem)) {
          warn(`hosted catalog signature did NOT verify (${sigUrl}) — ignoring the hosted catalog (using bundled only)`);
          return undefined;
        }
      } else {
        warn(`hosted catalog is unsigned (no signature at ${sigUrl}) — merging anyway during the signing transition`);
      }
    }

    const json = JSON.parse(text) as unknown;
    return json && typeof json === 'object' ? (json as RawCatalog) : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve the effective catalog: the bundled payload, optionally merged with a fetched hosted one
 * (hosted wins on id collisions, via mergeCatalogs). Hosted failure → bundled only. Never throws.
 */
export async function resolveCatalog(args: {
  bundled: RawCatalog;
  hosted?: HostedCatalogOptions;
  warn?: (msg: string) => void;
}): Promise<MarketplaceCatalog> {
  const base = parseCatalogResilient(args.bundled, args.warn);
  const fetched = args.hosted
    ? await fetchHostedCatalog({ ...args.hosted, warn: args.hosted.warn ?? args.warn })
    : undefined;
  if (!fetched) {
    return base;
  }
  return mergeCatalogs(base, parseCatalogResilient(fetched, args.warn));
}
