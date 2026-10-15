import {describe, expect, it} from 'vitest';
import {
  BASE_SECURITY_HEADERS,
  HSTS_VALUE,
  applySecurityHeaders,
  buildReportOnlyCsp,
  isHttpsRequest,
  isPublicHostname,
  shouldSendHsts,
  withSecurityHeaders,
} from '~/lib/security-headers';

// P7-07 (P-L6, T-07, T-10): host-independent response headers and the report-only CSP.

const NONCE = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const PROD = {
  nonce: NONCE,
  storeDomain: 'shop.example.com',
  checkoutDomain: 'checkout.example.com',
  development: false,
} as const;

function directive(policy: string, name: string): string[] {
  const found = policy
    .split('; ')
    .map((part) => part.split(' '))
    .find(([directiveName]) => directiveName === name);
  return found ? found.slice(1) : [];
}

describe('applySecurityHeaders', () => {
  it('sets the host-independent headers and keeps the ones already there', () => {
    const headers = new Headers({'Cache-Control': 'private, no-cache'});
    applySecurityHeaders(headers, {requestUrl: 'http://localhost:3000/'});
    expect(headers.get('x-content-type-options')).toBe('nosniff');
    expect(headers.get('referrer-policy')).toBe(
      'strict-origin-when-cross-origin',
    );
    expect(headers.get('x-frame-options')).toBe('DENY');
    expect(headers.get('cross-origin-opener-policy')).toBe(
      'same-origin-allow-popups',
    );
    expect(headers.get('permissions-policy')).toBe(
      'camera=(), microphone=(), geolocation=(), payment=()',
    );
    // The root loader's caching header is not touched (DEC-036).
    expect(headers.get('cache-control')).toBe('private, no-cache');
  });

  it('replaces a weaker value a route may have set', () => {
    const headers = new Headers({'X-Frame-Options': 'SAMEORIGIN'});
    applySecurityHeaders(headers, {requestUrl: 'https://www.example.com/'});
    expect(headers.get('x-frame-options')).toBe('DENY');
  });

  it('never sends a preload or includeSubDomains directive (needs the final host, Q-003)', () => {
    expect(HSTS_VALUE).not.toMatch(/preload|includeSubDomains/i);
    expect(Object.values(BASE_SECURITY_HEADERS).join(' ')).not.toMatch(
      /preload/i,
    );
  });
});

describe('HSTS', () => {
  it.each([
    ['https://www.example.com/', null, true],
    ['https://www.example.com/cart', 'http', true],
    // TLS ends at a proxy: the URL says http, the proxy says https (P-L5).
    ['http://www.example.com/', 'https', true],
    ['http://www.example.com/', 'https, http', true],
    ['http://www.example.com/', 'http', false],
    ['http://www.example.com/', null, false],
    ['https://localhost:3000/', null, false],
    ['https://foo.localhost/', null, false],
    ['https://127.0.0.1/', null, false],
    ['https://[::1]/', null, false],
    ['https://intranet/', null, false],
    ['not a url', 'https', false],
  ])('%s with forwarded proto %s gives %s', (url, proto, expected) => {
    expect(shouldSendHsts({requestUrl: url, forwardedProto: proto})).toBe(
      expected,
    );
  });

  it('is added only when it applies', () => {
    const secure = new Headers();
    applySecurityHeaders(secure, {requestUrl: 'https://www.example.com/'});
    expect(secure.get('strict-transport-security')).toBe(HSTS_VALUE);

    const local = new Headers();
    applySecurityHeaders(local, {requestUrl: 'https://localhost:3000/'});
    expect(local.has('strict-transport-security')).toBe(false);
  });

  it('reads the first forwarded protocol only, and tolerates junk', () => {
    expect(isHttpsRequest('http://a.example.com/', ' HTTPS ,http')).toBe(true);
    expect(isHttpsRequest('http://a.example.com/', 'http,https')).toBe(false);
    expect(isHttpsRequest('http://a.example.com/', '')).toBe(false);
    expect(isPublicHostname(null)).toBe(false);
  });
});

describe('buildReportOnlyCsp', () => {
  const policy = buildReportOnlyCsp(PROD) ?? '';

  it('is a tightened policy that names every resource type', () => {
    expect(directive(policy, 'default-src')).toEqual(["'self'"]);
    expect(directive(policy, 'object-src')).toEqual(["'none'"]);
    expect(directive(policy, 'frame-src')).toEqual(["'none'"]);
    expect(directive(policy, 'script-src-attr')).toEqual(["'none'"]);
    expect(directive(policy, 'base-uri')).toEqual(["'self'"]);
    for (const name of [
      'script-src',
      'style-src',
      'img-src',
      'font-src',
      'media-src',
      'connect-src',
      'form-action',
    ]) {
      expect(directive(policy, name).length, name).toBeGreaterThan(0);
    }
  });

  it('carries the nonce on scripts and nowhere else', () => {
    expect(directive(policy, 'script-src')).toContain(`'nonce-${NONCE}'`);
    expect(policy.split(`'nonce-${NONCE}'`)).toHaveLength(2);
  });

  it('allows Shopify origins and only the configured shop hosts', () => {
    expect(directive(policy, 'img-src')).toContain('https://cdn.shopify.com');
    expect(directive(policy, 'connect-src')).toEqual(
      expect.arrayContaining([
        'https://checkout.example.com',
        'https://shop.example.com',
      ]),
    );
    expect(directive(policy, 'form-action')).toContain('https://shopify.com');
  });

  it('allows no third-party origin yet (T-10) and no unsafe script source', () => {
    const origins = policy.match(/https?:\/\/[^\s;]+/g) ?? [];
    expect(new Set(origins)).toEqual(
      new Set([
        'https://cdn.shopify.com',
        'https://monorail-edge.shopifysvc.com',
        'https://checkout.example.com',
        'https://shop.example.com',
        'https://shopify.com',
      ]),
    );
    expect(directive(policy, 'script-src')).not.toContain("'unsafe-inline'");
    expect(directive(policy, 'script-src')).not.toContain("'unsafe-eval'");
    expect(directive(policy, 'style-src')).not.toContain("'unsafe-inline'");
    // Inline style attributes are the one inline allowance.
    expect(directive(policy, 'style-src-attr')).toEqual(["'unsafe-inline'"]);
  });

  it('leaves out frame-ancestors, which browsers ignore in a report-only policy', () => {
    expect(policy).not.toContain('frame-ancestors');
  });

  it('lists localhost and websockets only in development', () => {
    expect(policy).not.toMatch(/localhost|127\.0\.0\.1|ws:/);
    const dev = buildReportOnlyCsp({...PROD, development: true}) ?? '';
    expect(directive(dev, 'connect-src')).toEqual(
      expect.arrayContaining(['ws://localhost:*', 'http://localhost:*']),
    );
    expect(directive(dev, 'style-src')).toContain("'unsafe-inline'");
  });

  it.each([
    ['a value with a semicolon', 'evil.com; script-src *'],
    ['a value with a space', 'a.com b.com'],
    ['a comma list', 'a.com,b.com'],
    ['a scheme', 'https://a.com'],
    ['a wildcard', '*.a.com'],
    ['a path', 'a.com/x'],
    ['nothing', undefined],
    ['an empty string', ''],
  ])('drops a shop domain that is %s', (_label, value) => {
    const result =
      buildReportOnlyCsp({
        ...PROD,
        storeDomain: value,
        checkoutDomain: value,
      }) ?? '';
    expect(result).not.toContain('evil.com');
    expect(directive(result, 'script-src')).not.toContain('*');
    expect(result.match(/;/g)?.length).toBe(policy.match(/;/g)?.length);
    expect(directive(result, 'connect-src')).not.toContain('https://');
  });

  it.each([
    ['empty', ''],
    ['with a quote', "abc'def12345"],
    ['with a semicolon', 'abcdefgh; script-src *'],
    ['too short', 'abc'],
  ])('refuses a nonce that is %s', (_label, nonce) => {
    expect(buildReportOnlyCsp({...PROD, nonce})).toBeNull();
  });
});

describe('withSecurityHeaders (every response leaves server.ts through it)', () => {
  const input = {requestUrl: 'https://www.example.com/x'};

  it('adds the headers in place to an ordinary response', () => {
    const response = new Response('ok', {status: 201});
    const result = withSecurityHeaders(response, input);
    expect(result).toBe(response);
    expect(result.headers.get('x-content-type-options')).toBe('nosniff');
    expect(result.headers.get('strict-transport-security')).toBe(HSTS_VALUE);
  });

  it('copies a response whose headers are immutable and keeps status, location and body', async () => {
    const redirect = Response.redirect('https://www.example.com/y', 301);
    expect(() => redirect.headers.set('x', '1')).toThrow();
    const result = withSecurityHeaders(redirect, input);
    expect(result).not.toBe(redirect);
    expect(result.status).toBe(301);
    expect(result.headers.get('location')).toBe('https://www.example.com/y');
    expect(result.headers.get('x-frame-options')).toBe('DENY');
  });

  it('keeps several Set-Cookie headers and the body when it has to copy', async () => {
    const source = new Response('{"a":1}', {
      status: 200,
      headers: [
        ['Set-Cookie', 'cart=1; Path=/'],
        ['Set-Cookie', 'zip=2; Path=/'],
      ],
    });
    // A guard that throws on write stands in for an immutable header list.
    Object.defineProperty(source, 'headers', {
      value: new Proxy(source.headers, {
        get(target, key) {
          if (key === 'set') {
            return () => {
              throw new TypeError('immutable');
            };
          }
          const value = Reflect.get(target, key, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      }),
    });
    const result = withSecurityHeaders(source, input);
    expect(result.headers.getSetCookie()).toEqual([
      'cart=1; Path=/',
      'zip=2; Path=/',
    ]);
    expect(await result.text()).toBe('{"a":1}');
    expect(result.headers.get('referrer-policy')).toBe(
      'strict-origin-when-cross-origin',
    );
  });

  it('gives an error response the headers too (the catch path of server.ts)', () => {
    const result = withSecurityHeaders(
      new Response('An unexpected error occurred', {status: 500}),
      input,
    );
    expect(result.status).toBe(500);
    expect(result.headers.get('x-content-type-options')).toBe('nosniff');
  });
});
