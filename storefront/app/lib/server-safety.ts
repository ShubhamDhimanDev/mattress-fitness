// Small helpers for the request handler in server.ts, kept here so they are unit-tested (the handler imports a virtual
// build module and cannot be). Security review N-L4, T-04, T-05.

import {
  withSecurityHeaders,
  type SecurityHeaderInput,
} from '~/lib/security-headers';

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

/** The part of Hydrogen's session the response step needs; a plain object in tests. */
export type PendingSession = {
  readonly isPending: boolean;
  commit(): Promise<string>;
};

/**
 * The last step for a response a route handler produced: security headers, then the session cookie.
 * The order matters. A response from `Response.redirect()` or `fetch()` has immutable headers, so the headers go on
 * first through `withSecurityHeaders`, which returns a mutable copy when it must; appending the session cookie to the
 * original would throw and turn a pending session into a 500 (security review K-L6 follow-up). The cookie is appended,
 * never set, so cookies a route already wrote survive (N-L4). Rejects only if `commit()` does; the caller's catch turns
 * that into the one error response.
 */
export async function finishResponse(
  response: Response,
  session: PendingSession,
  headerInput: SecurityHeaderInput,
): Promise<Response> {
  const secured = withSecurityHeaders(response, headerInput);
  if (session.isPending) appendSetCookie(secured, await session.commit());
  return secured;
}
