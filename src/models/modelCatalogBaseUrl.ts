import { UNODE_DEFAULT_BASE_URL } from '../backend/openAICompatBaseUrl';

export function resolveModelCatalogBaseUrl(
  providerKey: string,
  baseUrl: string | undefined,
  defaultRoamBaseUrl: string
): string | undefined {
  const trimmed = baseUrl?.trim();
  if (trimmed) {
    return trimmed;
  }
  if (providerKey === 'roam') {
    return defaultRoamBaseUrl;
  }
  if (providerKey === 'unode') {
    return UNODE_DEFAULT_BASE_URL;
  }
  return undefined;
}
