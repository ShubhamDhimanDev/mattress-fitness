import {describe, expect, it} from 'vitest';
import {
  parseCartPermalink,
  parseDiscountCode,
  safeRedirectPath,
} from '~/lib/cart/input';
import {getCheckoutHref} from '~/lib/cart/checkout';

// M-1 (T-08): the discount redirect target. M-2 (T-01): the cart permalink.
describe('safeRedirectPath (T-08)', () => {
  it.each([
    '/',
    '/collections/mattresses',
    '/collections/mattresses?size=queen&sort=price-asc',
    '/pages/about#hours',
  ])('keeps the site path %s', (path) => {
    expect(safeRedirectPath(path)).toBe(path);
  });

  it.each([
    ['protocol-relative', '//evil.com'],
    ['backslash after slash', '/\\evil.com'],
    ['backslash anywhere', '/a\\b'],
    ['absolute https', 'https://evil.com'],
    ['absolute http', 'http://evil.com/x'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['data scheme', 'data:text/html,x'],
    ['tab between slashes', '/\t/evil.com'],
    ['newline between slashes', '/\n/evil.com'],
    ['leading space', ' /collections'],
    ['encoded control', '/\u0000/evil.com'],
    ['bare host', 'evil.com'],
    ['empty', ''],
  ])('falls back for %s', (_name, value) => {
    expect(safeRedirectPath(value)).toBe('/');
  });

  it('falls back for null, undefined and over-long values', () => {
    expect(safeRedirectPath(null)).toBe('/');
    expect(safeRedirectPath(undefined)).toBe('/');
    expect(safeRedirectPath(`/${'a'.repeat(3000)}`)).toBe('/');
  });

  it('uses the given fallback', () => {
    expect(safeRedirectPath('//evil.com', '/cart')).toBe('/cart');
  });
});

describe('parseDiscountCode (T-01)', () => {
  it('accepts plain codes and rejects anything else', () => {
    expect(parseDiscountCode('SAVE-10_ok')).toBe('SAVE-10_ok');
    expect(parseDiscountCode(' SAVE10 ')).toBe('SAVE10');
    expect(parseDiscountCode('a b')).toBeNull();
    expect(parseDiscountCode('<script>')).toBeNull();
    expect(parseDiscountCode('x'.repeat(65))).toBeNull();
    expect(parseDiscountCode('')).toBeNull();
    expect(parseDiscountCode(null)).toBeNull();
  });
});

describe('parseCartPermalink (T-01)', () => {
  it('builds lines from variant numbers and quantities', () => {
    expect(parseCartPermalink('123:2,456:1')).toEqual({
      status: 'ok',
      lines: [
        {merchandiseId: 'gid://shopify/ProductVariant/123', quantity: 2},
        {merchandiseId: 'gid://shopify/ProductVariant/456', quantity: 1},
      ],
    });
  });

  it('adds repeated variants and caps the total at 99', () => {
    expect(parseCartPermalink('7:60,7:60')).toEqual({
      status: 'ok',
      lines: [{merchandiseId: 'gid://shopify/ProductVariant/7', quantity: 99}],
    });
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['no quantity', '123'],
    ['zero quantity', '123:0'],
    ['over the limit', '123:100'],
    ['negative', '123:-1'],
    ['fraction', '123:1.5'],
    ['exponent', '123:1e2'],
    ['hex', '123:0x10'],
    ['text id', 'abc:1'],
    ['gid in the id', 'gid://shopify/ProductVariant/1:1'],
    ['leading zero id', '0123:1'],
    ['injected price', '123:1:price=1'],
    ['one bad entry rejects all', '123:1,abc:1'],
    [
      'too many lines',
      Array.from({length: 21}, (_, i) => `${i + 1}:1`).join(','),
    ],
  ])('rejects %s', (_name, value) => {
    expect(parseCartPermalink(value)).toEqual({status: 'invalid'});
  });
});

describe('getCheckoutHref', () => {
  it('returns https checkout URLs only', () => {
    expect(getCheckoutHref({checkoutUrl: 'https://shop.example/c/abc'})).toBe(
      'https://shop.example/c/abc',
    );
    expect(
      getCheckoutHref({checkoutUrl: 'http://shop.example/c/abc'}),
    ).toBeNull();
    expect(getCheckoutHref({checkoutUrl: 'javascript:alert(1)'})).toBeNull();
    expect(getCheckoutHref({checkoutUrl: 'not a url'})).toBeNull();
    expect(getCheckoutHref({checkoutUrl: null})).toBeNull();
    expect(getCheckoutHref(null)).toBeNull();
  });
});
