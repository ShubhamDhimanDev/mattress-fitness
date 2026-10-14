import {describe, expect, it} from 'vitest';
import {parseSiteOrigin, resolveSiteOrigin} from '~/lib/site-origin';

// P-L2 (security review 2026-10-13): canonical URLs and JSON-LD never take their origin from the Host header.

describe('parseSiteOrigin', () => {
  it.each([
    ['https://www.example.com', 'https://www.example.com'],
    ['  https://www.example.com/some/path?x=1#y ', 'https://www.example.com'],
    ['https://shop.example.com:8443/', 'https://shop.example.com:8443'],
    ['http://localhost:3000', 'http://localhost:3000'],
    ['http://127.0.0.1:3100/x', 'http://127.0.0.1:3100'],
  ])('accepts %s', (raw, expected) => {
    expect(parseSiteOrigin(raw)).toBe(expected);
  });

  it.each([
    undefined,
    null,
    '',
    '   ',
    42,
    'not a url',
    'http://www.example.com',
    'javascript:alert(1)',
    'ftp://www.example.com',
    'https://user:pass@www.example.com',
  ])('rejects %j', (raw) => {
    expect(parseSiteOrigin(raw)).toBeNull();
  });
});

describe('resolveSiteOrigin', () => {
  const hostile = 'https://evil.example/products/slides';

  it('uses the configured origin and ignores a hostile request Host', () => {
    expect(
      resolveSiteOrigin({
        env: {PUBLIC_SITE_URL: 'https://www.mattress.test'},
        requestUrl: hostile,
        isDev: false,
      }),
    ).toBe('https://www.mattress.test');
    expect(
      resolveSiteOrigin({
        env: {PUBLIC_SITE_URL: 'https://www.mattress.test'},
        requestUrl: hostile,
        isDev: true,
      }),
    ).toBe('https://www.mattress.test');
  });

  it('never reflects the request outside development', () => {
    expect(
      resolveSiteOrigin({env: {}, requestUrl: hostile, isDev: false}),
    ).toBeNull();
    expect(
      resolveSiteOrigin({
        env: {PUBLIC_SITE_URL: 'http://evil.example'},
        requestUrl: hostile,
        isDev: false,
      }),
    ).toBeNull();
  });

  it('falls back to the request origin in development only', () => {
    expect(
      resolveSiteOrigin({
        env: {},
        requestUrl: 'http://localhost:3000/products/x',
        isDev: true,
      }),
    ).toBe('http://localhost:3000');
  });
});
