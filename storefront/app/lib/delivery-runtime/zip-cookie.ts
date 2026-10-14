// SERVER ONLY. The shopper's saved delivery ZIP (P3B-11, REQ-NAV-003): a signed, HttpOnly cookie that only
// the server reads and writes, so the cart gate, the checkout step and the product page agree on one value.
//
// What the signature gives: a value we did not write is rejected. It does NOT make the ZIP true: the shopper
// chooses it, so eligibility is only as strong as Shopify Local delivery at checkout (ADR-0006/0007). The
// ZIP is location data, so it stays out of URLs, cache keys, logs and third-party scripts.
//
// Signed with SESSION_SECRET (already required by the request context). The cookie holds a bare 5-digit
// string and is read back through parseZip, so a signed session cookie replayed under this name cannot
// pass for a ZIP.

import {createCookie} from 'react-router';
import {isLocalHost} from '~/lib/cart/cookie';
import {parseZip} from '~/lib/delivery/zip';

export const DELIVERY_ZIP_COOKIE = 'delivery_zip';
/** A saved ZIP is a convenience, not an account: it lapses after 30 days. */
export const DELIVERY_ZIP_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function cookieFor(env: object, requestUrl: string) {
  // Reflect.get: the request-context Env is an interface with no index signature.
  const secret: unknown = Reflect.get(env, 'SESSION_SECRET');
  // Without a secret nothing can be signed or verified: read nothing, write nothing (fail closed).
  if (typeof secret !== 'string' || secret === '') return null;
  return createCookie(DELIVERY_ZIP_COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    // Follows the host, like the cart cookie, not the protocol a TLS-terminating proxy hands the app.
    secure: !isLocalHost(requestUrl),
    maxAge: DELIVERY_ZIP_MAX_AGE_SECONDS,
    path: '/',
    secrets: [secret],
  });
}

/** The saved ZIP, or null when there is none, the signature is wrong or the value is not a ZIP. Never throws. */
export async function readDeliveryZip(
  request: Request,
  env: object,
): Promise<string | null> {
  const cookie = cookieFor(env, request.url);
  if (cookie === null) return null;
  try {
    const value: unknown = await cookie.parse(request.headers.get('Cookie'));
    const parsed = parseZip(value);
    return parsed.ok ? parsed.zip : null;
  } catch {
    return null;
  }
}

/** The Set-Cookie value that saves a ZIP, or null when it cannot be signed. */
export async function saveDeliveryZipHeader(
  zip: string,
  request: Request,
  env: object,
): Promise<string | null> {
  const parsed = parseZip(zip);
  const cookie = cookieFor(env, request.url);
  if (!parsed.ok || cookie === null) return null;
  return cookie.serialize(parsed.zip);
}

/** The Set-Cookie value that removes the saved ZIP, or null when there is no secret to name the cookie with. */
export async function clearDeliveryZipHeader(
  request: Request,
  env: object,
): Promise<string | null> {
  const cookie = cookieFor(env, request.url);
  if (cookie === null) return null;
  return cookie.serialize('', {maxAge: 0, expires: new Date(0)});
}
