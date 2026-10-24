import {describe, expect, it} from 'vitest';
import {
  REFERRER_POLICY_PRIVATE,
  applySecurityHeaders,
  withSecurityHeaders,
} from '~/lib/security-headers';

// Review A-L2 (T-05): a page that follows a click from the account area or the order lookup must not read a full
// same-origin referrer. The policy of the page being left decides.

const SITE = 'https://shop.example';
const policyFor = (path: string) => {
  const headers = new Headers();
  applySecurityHeaders(headers, {requestUrl: `${SITE}${path}`});
  return headers.get('referrer-policy');
};

describe('Referrer-Policy on private routes', () => {
  it.each([
    '/account',
    '/account/orders/gid%3A%2F%2Fshopify%2FOrder%2F123',
    '/account/orders/123.data',
    '/ACCOUNT/orders',
    '/%61ccount',
    '/track-order',
    '/track-order?order=1001',
    '//track-order',
  ])('%s sends only the origin as referrer', (path) => {
    expect(policyFor(path)).toBe(REFERRER_POLICY_PRIVATE);
    expect(REFERRER_POLICY_PRIVATE).toBe('origin');
  });

  it.each([
    '/',
    '/products/cloud',
    '/cart',
    '/delivery',
    '/checkout-steps',
    '/accounting',
    '/pages/account',
    '/search?q=queen',
  ])('%s keeps the site-wide policy', (path) => {
    expect(policyFor(path)).toBe('strict-origin-when-cross-origin');
  });

  it('goes through withSecurityHeaders too, including a response with immutable headers', () => {
    const response = Response.redirect(`${SITE}/somewhere`, 302);
    const out = withSecurityHeaders(response, {
      requestUrl: `${SITE}/account/addresses`,
    });
    expect(out.headers.get('referrer-policy')).toBe('origin');
    expect(out.status).toBe(302);
  });

  it('a request URL that cannot be parsed leaves the default and does not throw', () => {
    const headers = new Headers();
    expect(() =>
      applySecurityHeaders(headers, {requestUrl: 'not a url'}),
    ).not.toThrow();
    expect(headers.get('referrer-policy')).toBe(
      'strict-origin-when-cross-origin',
    );
  });
});
