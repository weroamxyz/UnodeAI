export const OPENAI_COMPAT_DEFAULT_BASE_URL = 'https://api.openai.com/v1';
/** Roam's own gateway (the default provider) is the weroam endpoint. */
export const ROAM_DEFAULT_BASE_URL = 'https://ai.weroam.xyz/v1';
/** Unode is a separate gateway provider (the previous Roam endpoint), kept for existing users. */
export const UNODE_DEFAULT_BASE_URL = 'https://www.unodetech.xyz/v1';

export function resolveOpenAICompatBaseUrl(
  providerId: string,
  configBaseUrl?: string,
  envBaseUrl?: string,
  roamDefault = ROAM_DEFAULT_BASE_URL,
  unodeDefault = UNODE_DEFAULT_BASE_URL
): string {
  const configured = clean(configBaseUrl);
  if (providerId === 'roam') {
    // Roam agents must use the Roam (weroam) gateway. A persisted OpenAI default would send Roam keys to
    // api.openai.com (401), and a persisted unode URL would send them to Unode — ignore both on a roam agent.
    const candidate = configured && !isOpenAIBaseUrl(configured) && !isUnodeBaseUrl(configured) ? configured : roamDefault;
    // Defense in depth: roamDefault is the roam.baseUrl SETTING, which an existing workspace may have
    // persisted to the OLD unode default. Roam must NEVER resolve to unode/OpenAI — fall back to weroam.
    return stripTrailingSlash(isUnodeBaseUrl(candidate) || isOpenAIBaseUrl(candidate) ? ROAM_DEFAULT_BASE_URL : candidate);
  }
  if (providerId === 'unode') {
    // Unode agents must use the unode gateway; ignore a stray OpenAI default the same way roam does.
    return stripTrailingSlash(configured && !isOpenAIBaseUrl(configured) ? configured : unodeDefault);
  }
  return stripTrailingSlash(configured || clean(envBaseUrl) || OPENAI_COMPAT_DEFAULT_BASE_URL);
}

/** The Roam (weroam) base URL to use given a configured roam.baseUrl — never the unode/OpenAI endpoint.
 *  A blank or stale-unode/OpenAI setting collapses to the canonical weroam gateway. Use this at every site
 *  that reads roam.baseUrl as the Roam endpoint (resolution default + pricing), so the Roam key can't leak. */
export function canonicalRoamBaseUrl(configured?: string): string {
  const c = clean(configured);
  return stripTrailingSlash(c && !isOpenAIBaseUrl(c) && !isUnodeBaseUrl(c) ? c : ROAM_DEFAULT_BASE_URL);
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/$/, '');
}

function isOpenAIBaseUrl(value: string): boolean {
  return /^https:\/\/api\.openai\.com\/v1\/?$/i.test(value);
}

function isUnodeBaseUrl(value: string): boolean {
  return /unodetech\.xyz/i.test(value);
}
