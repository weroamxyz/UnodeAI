import { describe, expect, it } from 'vitest';
import { sanitizeHref } from '../webviewSecurity';

describe('sanitizeHref', () => {
  it('allows http and https URLs', () => {
    expect(sanitizeHref('https://www.unodetech.xyz/pricing?lang=en')).toBe('https://www.unodetech.xyz/pricing?lang=en');
    expect(sanitizeHref('http://localhost:3000/docs')).toBe('http://localhost:3000/docs');
  });

  it('rejects non-web and malformed URLs', () => {
    expect(sanitizeHref('javascript:alert(1)')).toBeUndefined();
    expect(sanitizeHref('not a url')).toBeUndefined();
  });
});
