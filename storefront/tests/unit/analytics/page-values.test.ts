import {describe, expect, it} from 'vitest';
import {evaluatePage} from '~/lib/analytics/page-context';
import {
  queryValueLooksPersonal,
  sanitizePageLocation,
} from '~/lib/analytics/privacy';

// P7-01 review 2026-10-24, m-1: ordinary values in a page address (dates, campaign names, Shopify variant ids) are
// not personal data; an email and a phone-like number still are.

const ORIGIN = 'https://shop.example';
const decide = (path: string) =>
  evaluatePage({href: `${ORIGIN}${path}`, referrer: '', title: 'Home'});

describe('ordinary values are safe', () => {
  it.each([
    '/products/x?utm_campaign=2026-10-23-newsletter',
    '/products/x?utm_campaign=20261023',
    '/products/x?utm_term=summer 2026 sale 1234567890',
    '/products/x?variant=44123456789012',
    '/products/x?variant=44123456789012&utm_source=news',
    '/products/x?date=2026-10-23',
    '/products/x?date=20261023',
    '/products/x?variant=gid://shopify/ProductVariant/44123456789012',
    '/?mc_eid=1234567890',
    '/?gclid=Cj0KCQiA1234567890abc&_kx=1234567890123',
    '/?utm_content=1234567890123456',
    '/?utm_content=Jane%20Smith',
  ])('%s', (path) => {
    expect(decide(path).safe).toBe(true);
  });

  it('keeps a date-named campaign in the reported address', () => {
    expect(
      sanitizePageLocation(`${ORIGIN}/p?utm_campaign=2026-10-23-newsletter`),
    ).toBe(`${ORIGIN}/p?utm_campaign=2026-10-23-newsletter`);
    expect(sanitizePageLocation(`${ORIGIN}/p?utm_campaign=20261023`)).toBe(
      `${ORIGIN}/p?utm_campaign=20261023`,
    );
  });
});

describe('personal values are still unsafe', () => {
  it.each([
    ['a ten-digit phone number', '/products/x?ref=5551234567'],
    ['a formatted phone number', '/products/x?ref=(555)%20123-4567'],
    ['a dashed phone number', '/products/x?ref=555-123-4567'],
    ['an email in a campaign tag', '/products/x?utm_campaign=a%40b.co'],
    ['an email in another value', '/products/x?contact=jane%40example.com'],
    [
      'an email next to a variant',
      '/products/x?variant=1&e=jane%40example.com',
    ],
    ['an email as the variant', '/products/x?variant=jane@example.com'],
    ['an email as a click id', '/?gclid=a@b.co'],
    ['an email in a click id, encoded', '/?fbclid=a%40b.co'],
    ['an email in a click id, double encoded', '/?fbclid=a%2540b.co'],
    ['a double-encoded email in a campaign tag', '/?utm_content=a%2540b.co'],
    ['a campaign tag that is a whole phone number', '/?utm_content=5551234567'],
    ['a formatted phone number as a tag', '/?utm_source=(555)%20123-4567'],
    ['a plus-one phone number as a tag', '/?utm_term=%2B1-555-123-4567'],
    ['a seven-digit value on an ordinary key', '/products/x?ref=1234567'],
    ['a name-bearing key with a value', '/collections/x?name=Jane'],
    ['a zip key with a value', '/collections/x?zip=90210'],
    ['a phone key with a value', '/collections/x?phone=5551234'],
    ['a variant that is not an id', '/products/x?variant=5551234567x'],
    ['an email in the fragment', '/collections/x#a@b.co'],
    ['an email in the fragment, encoded', '/collections/x#a%40b.co'],
    ['a phone number in the fragment', '/collections/x#5551234567'],
  ])('%s', (_label, path) => {
    expect(decide(path).safe).toBe(false);
  });

  it('gives the reason: a query value, or the fragment', () => {
    expect(decide('/products/x?ref=5551234567')).toEqual({
      safe: false,
      reason: 'personal-query',
    });
    expect(decide('/collections/x#a@b.co')).toEqual({
      safe: false,
      reason: 'personal-fragment',
    });
  });

  it('judges a value by its key', () => {
    expect(queryValueLooksPersonal('utm_campaign', '5551234567')).toBe(true);
    expect(queryValueLooksPersonal('utm_campaign', '1234567890123456')).toBe(
      false,
    );
    expect(queryValueLooksPersonal('utm_campaign', 'a@b.co')).toBe(true);
    expect(queryValueLooksPersonal('variant', 'a@b.co')).toBe(true);
    expect(queryValueLooksPersonal('Variant', '44123456789012')).toBe(false);
    expect(queryValueLooksPersonal('gclid', '12345678901234567890')).toBe(
      false,
    );
    expect(queryValueLooksPersonal('gclid', 'x@y.co')).toBe(true);
    expect(queryValueLooksPersonal('ref', '5551234567')).toBe(true);
    expect(queryValueLooksPersonal('ref', '2026-10-23')).toBe(false);
    expect(queryValueLooksPersonal('ref', '20261023')).toBe(false);
    expect(queryValueLooksPersonal('email', '')).toBe(false);
  });

  it('the fragment is never part of the reported address', () => {
    expect(sanitizePageLocation(`${ORIGIN}/p?utm_source=a#section`)).toBe(
      `${ORIGIN}/p?utm_source=a`,
    );
  });

  it('a title naming an order is reduced to the generic title', () => {
    const decideTitle = (title: string) =>
      evaluatePage({href: `${ORIGIN}/pages/x`, referrer: '', title});
    for (const title of [
      'Order #1001',
      'Order 1001 | Shop',
      'order no. 12',
      'Your Order #98765',
    ]) {
      expect(decideTitle(title)).toMatchObject({
        context: {pageTitle: 'Page'},
      });
    }
    expect(decideTitle('Order your mattress | Shop')).toMatchObject({
      context: {pageTitle: 'Order your mattress | Shop'},
    });
  });

  it('the search term keeps its stricter seven-digit rule', () => {
    expect(decide('/search?q=1234567')).toEqual({
      safe: false,
      reason: 'personal-search',
    });
    expect(decide('/search?q=queen')).toMatchObject({safe: true});
  });
});
