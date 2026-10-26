// Flags for the `cart` cookie (security review P-M1). The cookie id is a bearer credential for the cart:
// HttpOnly keeps scripts from reading it, SameSite=Lax stops cross-site POSTs from carrying it (the CSRF
// defence for /cart actions), Secure keeps it off plain http, and a lifetime stops it living forever.
// `secure` follows the host, not the request protocol: behind a TLS-terminating proxy the protocol the app
// sees can be http while the browser used https, and a missing Secure flag there would be silent.

import {
  cartSetIdDefault,
  type CookieOptions,
} from '~/lib/hydrogen/cart-handler';

/** Shopify keeps a cart for ten days after its last update; the cookie matches that. */
export const CART_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 10;

const LOCAL_HOSTS: ReadonlySet<string> = new Set([
  'localhost',
  '127.0.0.1',
  '[::1]',
]);

export function isLocalHost(requestUrl: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(requestUrl).hostname);
  } catch {
    // An unreadable URL is treated as non-local so the cookie is Secure.
    return false;
  }
}

export function cartCookieOptions(requestUrl: string): CookieOptions {
  return {
    httponly: true,
    samesite: 'Lax',
    secure: !isLocalHost(requestUrl),
    maxage: CART_COOKIE_MAX_AGE_SECONDS,
    path: '/',
  };
}

export function cartSetId(requestUrl: string) {
  return cartSetIdDefault(cartCookieOptions(requestUrl));
}
