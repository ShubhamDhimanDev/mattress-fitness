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
    '/products/x?ref=1234567',
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
  ])('%s', (_label, path) => {
    expect(decide(path)).toEqual({
      safe: false,
      reason: 'personal-query',
    });
  });

  it('a phone-like utm value is a campaign tag, not an address: only an email blocks it', () => {
    expect(queryValueLooksPersonal('utm_campaign', '5551234567')).toBe(false);
    expect(queryValueLooksPersonal('utm_campaign', 'a@b.co')).toBe(true);
    expect(queryValueLooksPersonal('variant', 'a@b.co')).toBe(false);
    expect(queryValueLooksPersonal('Variant', '44123456789012')).toBe(false);
    expect(queryValueLooksPersonal('ref', '5551234567')).toBe(true);
  });

  it('the search term keeps its stricter seven-digit rule', () => {
    expect(decide('/search?q=1234567')).toEqual({
      safe: false,
      reason: 'personal-search',
    });
    expect(decide('/search?q=queen')).toMatchObject({safe: true});
  });
});
