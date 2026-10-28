// Response headers for pages whose output depends on a cookie (the cart cookie).
// Without them a shared cache could serve one shopper's store, or their Set-Cookie, to another (P-L3, T-05).

export const PRIVATE_NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie',
} as const;

/**
 * For page documents whose content depends on a cookie but that set none themselves (the root layout: the
 * cart, the signed-in state, the chosen store, the saved delivery ZIP). `private` keeps every shared cache
 * from storing it and `Vary: Cookie` keys the browser's own copy to the cookies, exactly like no-store; the
 * difference is that `no-cache` lets the browser keep the page for revalidation and for the back/forward
 * cache, which `no-store` switches off. Use PRIVATE_NO_STORE_HEADERS where the response sets a cookie or is a
 * per-shopper answer nobody should keep (the delivery resource, cart actions, the discount redirect).
 */
export const PRIVATE_REVALIDATE_HEADERS = {
  'Cache-Control': 'private, no-cache',
  Vary: 'Cookie',
} as const;

/**
 * Route `headers` export: sends the headers the loader set. React Router applies a route's `headers`
 * to the document request and to the data request alike.
 */
export function forwardLoaderHeaders({
  loaderHeaders,
}: {
  loaderHeaders: Headers;
}): Headers {
  return loaderHeaders;
}
