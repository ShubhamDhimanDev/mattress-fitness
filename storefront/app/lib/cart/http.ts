// HTTP details shared by the cart routes (security review P-L3, P-L4).

/**
 * Cart responses read or set the cart cookie and carry cart contents, so no shared cache may keep them.
 * Existing headers (the Set-Cookie from the cart handler) are kept.
 */
export function noStoreHeaders(base?: HeadersInit | null): Headers {
  const headers = new Headers(base ?? undefined);
  headers.set('Cache-Control', 'private, no-store');
  return headers;
}

type HeaderSource = {get(name: string): string | null};

/**
 * Whether a request may create a cart from a permalink. A permalink is a top-level navigation; a browser
 * that loads it as an image, script, frame or prefetch (a page embedding `/cart/123:1` to make visitors'
 * browsers create carts) is refused. Browsers that send no Fetch Metadata are allowed: this is a basic
 * guard, not rate limiting, which needs the host decision (Q-003).
 */
export function mayCreateCartFromLink(headers: HeaderSource): boolean {
  const destination = headers.get('Sec-Fetch-Dest');
  if (destination !== null && destination !== 'document') return false;
  const purpose = `${headers.get('Sec-Purpose') ?? ''} ${headers.get('Purpose') ?? ''}`;
  return !/prefetch|prerender/i.test(purpose);
}

/**
 * Same-site check for cart and checkout-step POSTs (phase 4 security considerations, T-01). The cookie is
 * SameSite=Lax, which already stops cross-site POSTs; this refuses a request whose Origin names another host.
 * Hosts are compared, not protocols: behind a TLS-terminating proxy the app can see http while the browser
 * sent https. A request without an Origin header (older clients, curl) is allowed; Lax still covers it.
 */
export function isSameOriginRequest(request: {
  readonly url: string;
  readonly headers: HeaderSource;
}): boolean {
  const origin = request.headers.get('Origin');
  if (origin === null || origin === 'null') return origin === null;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}
