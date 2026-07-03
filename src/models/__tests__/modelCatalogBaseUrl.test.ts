import { describe, expect, it } from 'vitest';
import { resolveModelCatalogBaseUrl } from '../modelCatalogBaseUrl';

describe('resolveModelCatalogBaseUrl', () => {
  it('uses the default Roam gateway when the Roam base URL is blank', () => {
    expect(resolveModelCatalogBaseUrl('roam', '', 'https://www.unodetech.xyz/v1')).toBe(
      'https://www.unodetech.xyz/v1'
    );
    expect(resolveModelCatalogBaseUrl('roam', '   ', 'https://www.unodetech.xyz/v1')).toBe(
      'https://www.unodetech.xyz/v1'
    );
  });

  it('trims an explicit base URL', () => {
    expect(resolveModelCatalogBaseUrl('roam', ' https://gw.example/v1 ', 'https://www.unodetech.xyz/v1')).toBe(
      'https://gw.example/v1'
    );
  });

  it('does not invent a base URL for non-Roam providers', () => {
    expect(resolveModelCatalogBaseUrl('custom', '', 'https://www.unodetech.xyz/v1')).toBeUndefined();
  });
});
