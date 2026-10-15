// Shopper-safe results for the customer account routes (P6-07, carry-over P-L8, T-11, T-05).
//
// The scaffold put `error.message` from Shopify and from its own `throw new Error(...)` calls into the action
// response. Those strings can quote Customer Account API errors, a query or an id, so what the browser gets is
// now a code from a closed list with a fixed message written here. The cause is logged by the route, class
// name only, through the redacting logger.

import {PRIVATE_NO_STORE_HEADERS} from '~/lib/pages/private-response';

export const ACCOUNT_ERROR_MESSAGES = {
  'signed-out': 'Your session has ended. Please sign in again to continue.',
  'invalid-request':
    'We could not read that request. Please check the form and try again.',
  rejected: 'We could not save those details. Please check them and try again.',
  failed: 'We could not complete that just now. Please try again in a moment.',
  'method-not-allowed': 'That action is not available here.',
  forbidden: 'We could not complete that request. Please reload the page.',
} as const;

export type AccountErrorCode = keyof typeof ACCOUNT_ERROR_MESSAGES;

/** HTTP status for each code, so a route cannot answer 200 for a failure or leak a cause through the status. */
const STATUS: Readonly<Record<AccountErrorCode, number>> = {
  'signed-out': 401,
  'invalid-request': 400,
  rejected: 400,
  failed: 400,
  'method-not-allowed': 405,
  forbidden: 403,
};

export function accountErrorStatus(code: AccountErrorCode): number {
  return STATUS[code];
}

export type AccountFailure = {
  readonly status: 'error';
  readonly code: AccountErrorCode;
  readonly message: string;
};

export function accountFailure(code: AccountErrorCode): AccountFailure {
  return {status: 'error', code, message: ACCOUNT_ERROR_MESSAGES[code]};
}

/** Headers for every account response: personal data, so no cache of any kind may keep it (T-05, T-11). */
export function accountNoStoreHeaders(base?: HeadersInit | null): Headers {
  const headers = new Headers(base ?? undefined);
  for (const [name, value] of Object.entries(PRIVATE_NO_STORE_HEADERS)) {
    headers.set(name, value);
  }
  return headers;
}

/**
 * The same response with account cache headers. Used for the resource routes whose response comes from
 * Hydrogen's customer account client (login, authorize, logout redirects), which carry session cookies.
 * Existing headers, `Set-Cookie` included, are kept.
 */
export function withAccountNoStore(response: Response): Response {
  const headers = accountNoStoreHeaders(response.headers);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Re-issues a Response thrown by Hydrogen's customer account client (the redirect to the login, which also sets
 * the login state cookie) with the account cache headers. The client builds that Response itself, so the only
 * way to add the headers is to catch it where it is thrown and wrap it: status, `Location` and `Set-Cookie`
 * are kept. Anything else is returned unchanged. The login redirect itself is not a page nobody should cache,
 * but a shared cache keeping it would replay one shopper's login state cookie to another (T-05, T-11).
 */
export function withAccountNoStoreIfResponse(error: unknown): unknown {
  return error instanceof Response ? withAccountNoStore(error) : error;
}

/**
 * The session check every account loader makes. A signed-out visitor gets Hydrogen's login redirect, thrown as
 * a Response; it is thrown again with no-store headers (see `withAccountNoStoreIfResponse`).
 */
export async function requireAccountSession(client: {
  handleAuthStatus: () => Promise<unknown>;
}): Promise<void> {
  try {
    await client.handleAuthStatus();
  } catch (error: unknown) {
    throw withAccountNoStoreIfResponse(error);
  }
}

const ADDRESS_ID_PREFIX = 'gid://shopify/CustomerAddress/';
const MAX_ID_LENGTH = 200;
const ORDER_ID =
  /^gid:\/\/shopify\/Order\/[A-Za-z0-9_-]{1,100}(\?[A-Za-z0-9_=&.-]{1,100})?$/;

/** The id the "new address" form posts: it names the form, not an address. */
export const NEW_ADDRESS_FORM_ID = 'NEW_ADDRESS_ID';

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * A Customer Account address id as the forms post it (the id may arrive percent-encoded). Only the shape is
 * checked here: which addresses belong to the shopper is decided by Shopify, because the mutation is sent with
 * the signed-in customer's own token. Returns the decoded id, or null.
 */
export function parseAddressId(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  if (raw.length > MAX_ID_LENGTH * 3) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (decoded.length > MAX_ID_LENGTH || hasControlCharacter(decoded)) {
    return null;
  }
  return decoded.startsWith(ADDRESS_ID_PREFIX) &&
    decoded.length > ADDRESS_ID_PREFIX.length
    ? decoded
    : null;
}

/**
 * The order id from the URL (`/account/orders/<base64 of the gid>`), or null when it is not one. The
 * customer is never taken from the URL: this only names which of the signed-in customer's orders to read, and
 * Shopify answers "not found" for an order that is not theirs, exactly as for one that does not exist.
 */
export function decodeOrderRouteId(raw: string | undefined): string | null {
  if (raw === undefined || raw.length === 0 || raw.length > MAX_ID_LENGTH * 2) {
    return null;
  }
  // The route segment is standard base64 of the order gid; "url-safe" characters are not produced by btoa.
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) return null;
  let decoded: string;
  try {
    decoded = atob(raw);
  } catch {
    return null;
  }
  return ORDER_ID.test(decoded) ? decoded : null;
}

/** Longest value a single address or profile field may carry; the API validates the rest. */
export const MAX_FIELD_LENGTH = 255;

/** True when a posted text value is present but longer than any field may be. */
export function hasOversizedField(form: FormData, keys: readonly string[]) {
  return keys.some((key) => {
    const value = form.get(key);
    return typeof value === 'string' && value.length > MAX_FIELD_LENGTH;
  });
}

export type AccountErrorView = {
  readonly title: string;
  readonly message: string;
  /** What the shopper can do next: sign in again, go to the account home, or retry the same page. */
  readonly recovery: 'sign-in' | 'account' | 'retry';
};

/**
 * What the account error page says for an HTTP status (null when the error was not a response). Fixed text
 * only: the error's own message is never shown (P-L8, T-05).
 */
export function accountErrorView(status: number | null): AccountErrorView {
  if (status === 401 || status === 403) {
    return {
      title: 'Please sign in again',
      message: ACCOUNT_ERROR_MESSAGES['signed-out'],
      recovery: 'sign-in',
    };
  }
  if (status === 404) {
    return {
      title: 'We could not find that',
      message: 'We could not find that order or account page.',
      recovery: 'account',
    };
  }
  return {
    title: 'We could not load your account',
    message: 'Please try again in a moment.',
    recovery: 'retry',
  };
}
