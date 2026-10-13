import {describe, expect, it} from 'vitest';
import {
  CART_COOKIE_MAX_AGE_SECONDS,
  cartCookieOptions,
  cartSetId,
  isLocalHost,
} from '~/lib/cart/cookie';

// Security review P-M1: the cart cookie carries HttpOnly, SameSite, Secure (off only for local hosts) and an expiry.
const CART_ID = 'gid://shopify/Cart/c1-abc123';

function setCookie(url: string): string {
  return cartSetId(url)(CART_ID).get('Set-Cookie') ?? '';
}

describe('cart cookie flags (T-04, P-M1)', () => {
  it('sets HttpOnly, SameSite=Lax, Secure and Max-Age on a public host', () => {
    const header = setCookie('https://shop.example.com/cart');
    expect(header).toMatch(/^cart=/i);
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/SameSite=Lax/i);
    expect(header).toMatch(/Secure/i);
    expect(header).toContain(`Max-Age=${CART_COOKIE_MAX_AGE_SECONDS}`);
    expect(header).toMatch(/Path=\//i);
  });

  it('stays Secure on a public host even when the app sees plain http (TLS proxy)', () => {
    expect(setCookie('http://shop.example.com/cart')).toMatch(/Secure/i);
  });

  it.each(['http://localhost:3000/cart', 'http://127.0.0.1:3100/cart'])(
    'omits Secure only for local development: %s',
    (url) => {
      const header = setCookie(url);
      expect(header).not.toMatch(/Secure/i);
      expect(header).toMatch(/HttpOnly/i);
      expect(header).toMatch(/SameSite=Lax/i);
    },
  );

  it('treats an unreadable URL and look-alike hosts as non-local', () => {
    expect(isLocalHost('not a url')).toBe(false);
    expect(isLocalHost('https://localhost.evil.example/')).toBe(false);
    expect(cartCookieOptions('not a url').secure).toBe(true);
  });
});
