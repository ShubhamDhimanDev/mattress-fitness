import {expect, test} from '@playwright/test';
import {isBlockedTelemetryRefusal} from './helpers/a11y';

// P7-07 (P-L6) and P7-04: security headers on documents and resource routes, the report-only policy staying
// silent in a real browser, robots.txt and the canonical policy. REQ-SEO-001, NFR-010.
// Development has no PUBLIC_SITE_URL, so the origin is the dev server's own; HSTS must NOT appear on localhost.

test.describe('response headers and SEO files', () => {
  test('a document carries the host-independent headers, both CSPs and a canonical Link', async ({
    request,
  }) => {
    const response = await request.get('/');
    expect(response.status()).toBe(200);
    const headers = response.headers();
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['permissions-policy']).toContain('camera=()');
    expect(headers['cross-origin-opener-policy']).toBe(
      'same-origin-allow-popups',
    );
    expect(headers['content-type']).toBe('text/html; charset=utf-8');
    // The root document behaviour is unchanged (DEC-036).
    expect(headers['cache-control']).toBe('private, no-cache');
    expect(headers['content-security-policy']).toContain(
      "frame-ancestors 'none'",
    );
    expect(headers['content-security-policy-report-only']).toContain(
      "object-src 'none'",
    );
    expect(headers['strict-transport-security']).toBeUndefined();
    expect(headers.link).toMatch(
      /^<http:\/\/localhost:\d+\/>; rel="canonical"$/,
    );
  });

  test('private pages have no canonical; the nonce matches between the policies', async ({
    request,
  }) => {
    const cart = await request.get('/cart');
    expect(cart.headers().link).toBeUndefined();
    const home = await request.get('/');
    const nonce = /'nonce-([^']+)'/.exec(
      home.headers()['content-security-policy'] ?? '',
    )?.[1];
    expect(nonce).toBeTruthy();
    expect(home.headers()['content-security-policy-report-only']).toContain(
      `'nonce-${nonce}'`,
    );
  });

  test('a filtered collection view points its canonical at the plain URL', async ({
    request,
  }) => {
    const response = await request.get(
      '/collections/all?sort=price-asc&size=queen',
    );
    expect(response.headers().link).toMatch(
      /^<http:\/\/localhost:\d+\/collections\/all>; rel="canonical"$/,
    );
  });

  test('robots.txt blocks private pages and facets and names the sitemap', async ({
    request,
  }) => {
    const response = await request.get('/robots.txt');
    expect(response.headers()['content-type']).toBe(
      'text/plain; charset=utf-8',
    );
    expect(response.headers()['x-content-type-options']).toBe('nosniff');
    const body = await response.text();
    for (const rule of [
      'Disallow: /cart$',
      'Disallow: /cart/',
      'Disallow: /account/',
      'Disallow: /api/',
      'Disallow: /*?sort=',
      'Disallow: /*&sort=',
      'Disallow: /checkout-steps$',
      'Disallow: /*?size=',
    ]) {
      expect(body).toContain(rule);
    }
    expect(body).toMatch(/Sitemap: http:\/\/localhost:\d+\/sitemap\.xml/);
  });

  test('the extras sitemap lists the home page and collection index, no cart or account', async ({
    request,
  }) => {
    const response = await request.get('/sitemap/extras.xml');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/xml');
    const xml = await response.text();
    expect(xml).toMatch(/<loc>http:\/\/localhost:\d+\/<\/loc>/);
    expect(xml).toContain('/collections</loc>');
    expect(xml).not.toMatch(/\/(cart|account|checkout|search|quiz|compare)/);
  });

  test('an unknown sitemap type is a 404', async ({request}) => {
    expect((await request.get('/sitemap/constructor/1.xml')).status()).toBe(
      404,
    );
  });

  test('the report-only policy stays silent on the home page in a real browser', async ({
    page,
  }) => {
    // A raw collector, not the shared one: the shared filters hide Shopify's blocked telemetry, and this spec must see
    // every other policy line. The one refusal that is expected (DEC-045) is dropped only when its blocked URL has exactly that host.
    const lines: string[] = [];
    page.on('console', (message) => lines.push(message.text()));
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const violations = lines.filter(
      (text) =>
        /content security policy|report only/i.test(text) &&
        !isBlockedTelemetryRefusal(text),
    );
    expect(violations).toEqual([]);
  });
});
