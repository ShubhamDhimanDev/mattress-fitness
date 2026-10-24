import {describe, expect, it} from 'vitest';
import {
  evaluatePage,
  readPageInput,
  type PageDecision,
} from '~/lib/analytics/page-context';
import {
  isPrivatePath,
  privatePathSection,
  sanitizePageLocation,
} from '~/lib/analytics/privacy';

// P7-01 review 2026-10-24, M-1 and L-4 (T-05, T-10): which pages may send anything, and what the providers are
// told about the pages that may.

const ORIGIN = 'https://shop.example';

function page(path: string, extra: {referrer?: string; title?: string} = {}) {
  return evaluatePage({
    href: `${ORIGIN}${path}`,
    referrer: extra.referrer ?? '',
    title: extra.title ?? 'Cloud Mattress | Shop',
  });
}

function unsafeReason(decision: PageDecision): string | null {
  return decision.safe ? null : decision.reason;
}

describe('private pages send nothing (M-1, L-4)', () => {
  it.each([
    '/account',
    '/account/orders',
    '/account/orders/gid%3A%2F%2Fshopify%2FOrder%2F1234567890',
    '/account/addresses',
    '/account/profile',
    '/track-order',
    '/track-order?order=1001',
    '/delivery',
    '/delivery?zip=90210',
    '/checkout-steps',
    '/checkout-steps/protection',
    '/discount/SECRETCODE',
  ])('%s is not safe', (path) => {
    expect(unsafeReason(page(path))).toBe('private-path');
  });

  it.each([
    '/ACCOUNT/orders/1',
    '/Account',
    '//account/orders',
    '/%61ccount/orders/1',
    '/account/../account/orders',
    '/Track-Order',
  ])(
    '%s is not safe either (the router matches case-insensitively and decodes)',
    (path) => {
      expect(unsafeReason(page(path))).toBe('private-path');
    },
  );

  it.each([
    '/',
    '/cart',
    '/products/cloud-mattress',
    '/collections/all',
    '/search',
    '/pages/delivery',
    '/policies/privacy-policy',
    '/accounting',
    '/delivery-info',
    '/track-orders',
    '/quiz',
    '/compare',
  ])('%s is a safe page', (path) => {
    expect(page(path).safe).toBe(true);
  });

  it('knows the private prefixes and their section', () => {
    expect(isPrivatePath('/account/orders/1')).toBe(true);
    expect(isPrivatePath('/accounting')).toBe(false);
    expect(privatePathSection('/Delivery')).toBe('/delivery');
    expect(privatePathSection('/cart')).toBeNull();
  });
});

describe('personal-looking addresses send nothing', () => {
  it.each([
    [
      'an email in a query value',
      '/products/x?contact=jane%40example.com',
      'personal-query',
    ],
    [
      'a long number in a query value',
      '/products/x?ref=5551234567',
      'personal-query',
    ],
    ['an email in the path', '/pages/jane%40example.com', 'personal-path'],
    [
      'an email as the search term',
      '/search?q=jane%40example.com',
      'personal-search',
    ],
    [
      'a phone number as the search term',
      '/search?q=555-123-4567',
      'personal-search',
    ],
    [
      'an order number as the search term',
      '/search?q=1234567',
      'personal-search',
    ],
  ])('%s', (_label, path, reason) => {
    expect(unsafeReason(page(path))).toBe(reason);
  });

  it('opaque click ids are not personal data even when they hold digits', () => {
    expect(
      page('/products/x?gclid=Cj0KCQiA1234567890abc&fbclid=IwAR01234567890')
        .safe,
    ).toBe(true);
  });

  it('a hostile or unreadable address is unsafe, never an exception', () => {
    expect(
      unsafeReason(evaluatePage({href: 'not a url', referrer: '', title: ''})),
    ).toBe('unreadable');
    expect(
      unsafeReason(
        evaluatePage({href: 'javascript:alert(1)', referrer: '', title: ''}),
      ),
    ).toBe('unreadable');
    expect(
      unsafeReason(evaluatePage({href: '', referrer: '', title: ''})),
    ).toBe('unreadable');
  });

  it('readPageInput turns a throwing window into null', () => {
    const win = {
      get location(): {href: string} {
        throw new Error('sandboxed');
      },
      document: {referrer: '', title: ''},
    };
    expect(readPageInput(win)).toBeNull();
  });
});

describe('search pages: no raw term in the address, the title is just "Search"', () => {
  it('reports /search without ?q and with the fixed title', () => {
    const decision = page('/search?q=firm+queen&size=queen', {
      title: 'Search: firm queen | Shop',
    });
    expect(decision).toEqual({
      safe: true,
      context: {
        pageLocation: `${ORIGIN}/search`,
        pageReferrer: '',
        pageTitle: 'Search',
      },
    });
  });

  it('a search page with no term is also titled "Search"', () => {
    expect(page('/search', {title: 'Whatever | Shop'})).toMatchObject({
      context: {pageTitle: 'Search'},
    });
  });

  it('keeps campaign tags and nothing else', () => {
    expect(
      sanitizePageLocation(`${ORIGIN}/search?q=firm&utm_source=news`),
    ).toBe(`${ORIGIN}/search?utm_source=news`);
  });
});

describe('what the providers are told on a safe page', () => {
  it('uses the product page title and the reduced address', () => {
    expect(
      page('/products/cloud-mattress?variant=1&utm_campaign=fall'),
    ).toEqual({
      safe: true,
      context: {
        pageLocation: `${ORIGIN}/products/cloud-mattress?utm_campaign=fall`,
        pageReferrer: '',
        pageTitle: 'Cloud Mattress | Shop',
      },
    });
  });

  it('replaces a title that looks personal and caps a long one', () => {
    expect(page('/pages/x', {title: 'Hello jane@example.com'})).toMatchObject({
      context: {pageTitle: 'Page'},
    });
    expect(page('/pages/x', {title: 'Order 12345678'})).toMatchObject({
      context: {pageTitle: 'Page'},
    });
    const long = page('/pages/x', {title: 'a'.repeat(400)});
    expect(long.safe && long.context?.pageTitle).toHaveLength(150);
    expect(page('/pages/x', {title: '   '})).toMatchObject({
      context: {pageTitle: 'Page'},
    });
  });

  it("reduces another site's referrer to its origin", () => {
    expect(
      page('/', {
        referrer: 'https://www.google.com/search?q=jane%40example.com&x=1',
      }),
    ).toMatchObject({context: {pageReferrer: 'https://www.google.com'}});
  });

  it('reduces an own-site referrer to a safe address: no search words, private pages cut to the section', () => {
    expect(
      page('/', {referrer: `${ORIGIN}/search?q=firm+queen`}),
    ).toMatchObject({
      context: {pageReferrer: `${ORIGIN}/search`},
    });
    expect(
      page('/', {referrer: `${ORIGIN}/account/orders/1234567890`}),
    ).toMatchObject({context: {pageReferrer: `${ORIGIN}/account`}});
    expect(
      page('/', {referrer: `${ORIGIN}/track-order?order=1001`}),
    ).toMatchObject({
      context: {pageReferrer: `${ORIGIN}/track-order`},
    });
  });

  it('drops a referrer that is not an http(s) address', () => {
    expect(
      page('/', {referrer: 'android-app://com.google.android.gm'}),
    ).toMatchObject({
      context: {pageReferrer: ''},
    });
    expect(page('/', {referrer: 'garbage'})).toMatchObject({
      context: {pageReferrer: ''},
    });
  });
});

describe('sanitizePageLocation for the private area', () => {
  it.each([
    ['/account/orders/1234567890', '/account'],
    ['/track-order?order=1001&email=a@b.co', '/track-order'],
    ['/delivery?zip=90210', '/delivery'],
    ['/checkout-steps/x', '/checkout-steps'],
    ['/discount/CODE', '/discount'],
    ['/ACCOUNT/orders', '/account'],
  ])('%s is reported as %s', (path, expected) => {
    expect(sanitizePageLocation(`${ORIGIN}${path}`)).toBe(
      `${ORIGIN}${expected}`,
    );
  });
});
