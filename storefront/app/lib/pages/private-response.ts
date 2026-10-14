// Response headers for pages whose output depends on a cookie (the "my store" cookie, the cart cookie).
// Without them a shared cache could serve one shopper's store, or their Set-Cookie, to another (P-L3, T-05).

export const PRIVATE_NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store',
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
