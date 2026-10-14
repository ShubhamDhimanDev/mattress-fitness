// Small helpers for the request handler in server.ts, kept here so they are unit-tested (the handler imports a virtual
// build module and cannot be). Security review N-L4, T-04, T-05.

/**
 * Adds a Set-Cookie header WITHOUT replacing the ones already on the response. `headers.set` would drop the cart or ZIP
 * cookie a route just wrote whenever the session cookie is also pending.
 */
export function appendSetCookie(response: Response, cookie: string): void {
  response.headers.append('Set-Cookie', cookie);
}

/**
 * What to log for an unexpected error: its class name only. The message and cause of a failed Storefront call can hold
 * the query, its variables and a cart id (which carries its access key), so they never reach the log.
 */
export function describeError(error: unknown): string {
  return error instanceof Error && error.name !== ''
    ? error.name
    : 'non-error value thrown';
}
