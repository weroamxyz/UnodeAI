import { describe, it, expect, vi, beforeEach } from 'vitest';
import { lookup } from 'dns/promises';
import { webFetch, WEB_FETCH_MAX_OUTPUT, numericV4ToDotted } from '../webFetch.js';

// Mock DNS so tests never hit the network; default resolves public so example.com is allowed.
vi.mock('dns/promises', () => ({ lookup: vi.fn() }));

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as any);
});

function mockResponse(body: string, contentType: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    headers: new Headers({ 'content-type': contentType }),
  } as Response;
}

describe('webFetch', () => {
  it('strips HTML from text/html content', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse('<html><body><p>Hello</p></body></html>', 'text/html')
    );
    const result = await webFetch('http://example.com/');
    expect(result).toBe('Hello');
  });

  it('returns JSON as-is for application/json content', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse('{"a":1}', 'application/json')
    );
    const result = await webFetch('https://example.com/api');
    expect(result).toBe('{"a":1}');
  });

  it('also returns JSON as-is when content-type includes "json"', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse('{"b":2}', 'application/vnd.api+json')
    );
    const result = await webFetch('https://example.com/api');
    expect(result).toBe('{"b":2}');
  });

  describe('SSRF / private network blocking', () => {
    const blocked = [
      'http://localhost:8080/',
      'http://127.0.0.1/',
      'http://192.168.1.1/',
      'http://10.0.0.1/',
      'http://169.254.169.254/',
      'http://[::1]/',
      'http://0.0.0.0/',
      'http://172.16.0.1/',
      'http://172.31.255.255/',
      'http://127.0.0.2/',            // whole 127/8 loopback, not just 127.0.0.1
      'http://[fc00::1]/',            // IPv6 ULA
      'http://[fe80::1]/',            // IPv6 link-local
      'http://[::ffff:127.0.0.1]/',   // IPv4-mapped loopback
    ];

    for (const url of blocked) {
      it(`blocks ${url}`, async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(mockResponse('ok', 'text/plain'));
        const result = await webFetch(url);
        expect(result).toMatch(/^Error:/);
        expect(globalThis.fetch).not.toHaveBeenCalled();
      });
    }
  });

  // DeepSeek follow-up (Codex review): numeric IPv4 encodings of 127.0.0.1 must be blocked by the
  // literal, not left to platform DNS normalization. Regression guard against future runtime changes.
  describe('SSRF: numeric IPv4 encodings of loopback', () => {
    const encoded = [
      'http://2130706433/',        // decimal
      'http://0x7f000001/',        // hex
      'http://0177.0.0.1/',        // octal first octet
      'http://127.1/',             // short form (a.d)
      'http://127.0.1/',           // short form (a.b.d)
    ];
    for (const url of encoded) {
      it(`blocks ${url} before any DNS/fetch`, async () => {
        // Resolver returns PUBLIC so only the literal decode can be what blocks it.
        vi.mocked(lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as any);
        globalThis.fetch = vi.fn().mockResolvedValue(mockResponse('ok', 'text/plain'));
        const result = await webFetch(url);
        expect(result).toMatch(/^Error:/);
        expect(globalThis.fetch).not.toHaveBeenCalled();
      });
    }

    it('decodes encodings but leaves public numeric IPs allowed', () => {
      expect(numericV4ToDotted('2130706433')).toBe('127.0.0.1');
      expect(numericV4ToDotted('0x7f000001')).toBe('127.0.0.1');
      expect(numericV4ToDotted('0177.0.0.1')).toBe('127.0.0.1');
      expect(numericV4ToDotted('127.1')).toBe('127.0.0.1');
      expect(numericV4ToDotted('8.8.8.8')).toBe('8.8.8.8'); // public — decoded but not private
      expect(numericV4ToDotted('example.com')).toBeUndefined(); // real hostname
      expect(numericV4ToDotted('999.1')).toBeUndefined(); // out of range
    });
  });

  it('blocks file:// URLs', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse('ok', 'text/plain'));
    const result = await webFetch('file:///etc/passwd');
    expect(result).toMatch(/^Error:/);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('returns error for invalid URL', async () => {
    globalThis.fetch = vi.fn();
    const result = await webFetch('not a url');
    expect(result).toBe('Error: Invalid URL');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('truncates output exceeding WEB_FETCH_MAX_OUTPUT', async () => {
    const longBody = 'x'.repeat(WEB_FETCH_MAX_OUTPUT + 10_000);
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse(longBody, 'text/plain')
    );
    const result = await webFetch('http://example.com/big');
    expect(result.length).toBeLessThanOrEqual(WEB_FETCH_MAX_OUTPUT);
    expect(result.length).toBe(WEB_FETCH_MAX_OUTPUT);
  });

  it('does not truncate output at exactly the limit', async () => {
    const exactBody = 'y'.repeat(WEB_FETCH_MAX_OUTPUT);
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse(exactBody, 'text/plain')
    );
    const result = await webFetch('http://example.com/exact');
    expect(result).toBe(exactBody);
  });

  it('returns HTTP error for non-2xx status', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse('Not Found', 'text/html', 404)
    );
    const result = await webFetch('http://example.com/missing');
    expect(result).toBe('Error: HTTP 404');
  });

  it('returns HTTP error for 500 status', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse('Server Error', 'text/html', 500)
    );
    const result = await webFetch('http://example.com/broken');
    expect(result).toBe('Error: HTTP 500');
  });

  it('handles fetch rejection (network error)', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network down'));
    const result = await webFetch('http://example.com/');
    expect(result).toBe('Error: Network down');
  });

  it('returns timeout error when request exceeds 10 seconds', async () => {
    vi.useFakeTimers();

    globalThis.fetch = vi.fn().mockImplementation(
      (_url: string, init?: RequestInit): Promise<Response> => {
        const signal = init?.signal;
        return new Promise((_resolve, reject) => {
          if (signal?.aborted) {
            reject(new DOMException('The operation was aborted', 'AbortError'));
            return;
          }
          const onAbort = () => {
            reject(new DOMException('The operation was aborted', 'AbortError'));
          };
          signal?.addEventListener('abort', onAbort, { once: true });
        });
      }
    );

    const promise = webFetch('http://example.com/slow');
    // async advance flushes the DNS-resolution microtask first, so the abort timer is in place
    // before we push past the timeout (the literal/DNS SSRF check now runs before fetch).
    await vi.advanceTimersByTimeAsync(10_001);
    const result = await promise;
    expect(result).toBe('Error: Request timed out');

    vi.useRealTimers();
  });

  it('returns success for valid https URL', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse('Hello World', 'text/plain')
    );
    const result = await webFetch('https://example.com/');
    expect(result).toBe('Hello World');
  });

  it('handles missing content-type header gracefully', async () => {
    const res = {
      ok: true,
      status: 200,
      text: async () => 'some content',
      headers: new Headers(),
    } as Response;
    globalThis.fetch = vi.fn().mockResolvedValue(res);
    const result = await webFetch('http://example.com/');
    expect(result).toBe('some content');
  });

  it('collapses whitespace when stripping HTML', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse('<html>\n<body>\n<p>Hello   World</p>\n</body>\n</html>', 'text/html')
    );
    const result = await webFetch('http://example.com/');
    expect(result).toBe('Hello World');
  });

  // P1 SSRF hardening (Codex review): DNS resolution + manual redirect re-validation.
  describe('SSRF: DNS resolution and redirects', () => {
    function redirect(location: string, status = 302): Response {
      return { ok: false, status, text: async () => '', headers: new Headers({ location }) } as Response;
    }

    it('blocks when the hostname resolves to a private IP (DNS rebinding)', async () => {
      vi.mocked(lookup).mockResolvedValue([{ address: '10.0.0.5', family: 4 }] as any);
      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse('secret', 'text/plain'));
      const result = await webFetch('http://internal.evil.example/');
      expect(result).toMatch(/resolves to a private network/);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('blocks a redirect that points at a private address', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(redirect('http://10.0.0.1/'));
      const result = await webFetch('http://example.com/redir');
      expect(result).toMatch(/private network/);
    });

    it('follows a redirect to another public URL and returns its body', async () => {
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(redirect('https://example.org/final'))
        .mockResolvedValueOnce(mockResponse('final body', 'text/plain'));
      const result = await webFetch('http://example.com/start');
      expect(result).toBe('final body');
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });

    it('errors after too many redirects', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(redirect('https://example.com/loop'));
      const result = await webFetch('http://example.com/loop');
      expect(result).toBe('Error: Too many redirects');
    });
  });
});
