// SERVER ONLY. The request flow behind POST /visit-request, the home page's "plan your visit" form (CR-33, DEC-144, T-05, T-13).
//
// In order: POST only and same origin; not configured means "not available" (503) with no call and nothing faked; the
// body is read with a size cap; the rate-limit gate runs before any Shopify call and fails closed; a filled honeypot gets
// the normal "thank you" and nothing else; invalid input gets field messages; then ONE save to Shopify. Logs carry event
// names and reason codes only, never a name, phone number, ZIP or token.

import {isSameOriginRequest} from '~/lib/cart/http';
import {readSmallForm} from '~/lib/delivery-runtime/form';
import {readEnvString} from '~/lib/extend/env';
import type {FetchLike} from '~/lib/extend/types';
import {
  createVisitCustomerClient,
  type VisitCustomerClient,
} from '~/lib/leads/customer-client';
import {
  parseVisitForm,
  VISIT_MESSAGES,
  type VisitRequestResponse,
} from '~/lib/leads/visit-request';
import {logInfo, logWarn} from '~/lib/logging/logger';
import {resolveClientAddress} from '~/lib/orders/guest-lookup-address';
import {
  createInMemoryRateLimitStore,
  createKeyHasher,
} from '~/lib/orders/guest-lookup-limiter';
import {PRIVATE_NO_STORE_HEADERS} from '~/lib/pages/private-response';
import {createSignupGate, type SignupGate} from '~/lib/signup/limiter';

export type VisitHttpResult = {
  readonly response: VisitRequestResponse;
  readonly status: number;
  readonly headers: Headers;
};

export type VisitDeps = {
  /** Null when the customer token or the shop domain is not configured. */
  readonly client: VisitCustomerClient | null;
  readonly gate: SignupGate;
  /** The deployment's trusted address header (TRUSTED_CLIENT_IP_HEADER), if any. */
  readonly addressHeader: string | null;
};

function result(
  response: VisitRequestResponse,
  status: number,
  extra: Readonly<Record<string, string>> = {},
): VisitHttpResult {
  const headers = new Headers(PRIVATE_NO_STORE_HEADERS);
  headers.set('X-Robots-Tag', 'noindex, nofollow');
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  return {response, status, headers};
}

const thankYou = (): VisitHttpResult =>
  result({status: 'ok', message: VISIT_MESSAGES.ok}, 200);

const unavailable = (status = 503): VisitHttpResult =>
  result({status: 'unavailable', message: VISIT_MESSAGES.unavailable}, status);

export async function handleVisitRequest(
  request: Request,
  deps: VisitDeps,
): Promise<VisitHttpResult> {
  if (request.method !== 'POST') {
    logWarn('visit_request.rejected', {reason: 'method'});
    return result(
      {status: 'unavailable', message: VISIT_MESSAGES.unavailable},
      405,
      {Allow: 'POST'},
    );
  }
  if (!isSameOriginRequest(request)) {
    logWarn('visit_request.rejected', {reason: 'cross_origin'});
    return unavailable(403);
  }
  if (deps.client === null) {
    logWarn('visit_request.unavailable', {reason: 'not_configured'});
    return unavailable();
  }

  const read = await readSmallForm(request);
  const parsed = parseVisitForm(
    read.status === 'ok' ? read.form : new FormData(),
  );

  const caller = resolveClientAddress(request.headers, deps.addressHeader);
  const gate = await deps.gate.check({
    address: caller.address,
    addressKnown: caller.source === 'header',
    email: null,
    // Counted only for a number that would really be saved.
    phone: parsed.status === 'ok' ? parsed.request.phone : null,
  });
  if (!gate.allowed) {
    if (gate.reason === 'limiter_failed') {
      logWarn('visit_request.limiter_failed', {clientSource: caller.source});
      return unavailable();
    }
    logWarn('visit_request.rate_limited', {
      limitedBy: gate.limitedBy,
      retryAfterSeconds: gate.retryAfterSeconds,
      clientSource: caller.source,
    });
    return result(
      {status: 'rate_limited', message: VISIT_MESSAGES.rateLimited},
      429,
      {'Retry-After': String(Math.max(1, Math.ceil(gate.retryAfterSeconds)))},
    );
  }

  if (parsed.status === 'honeypot') {
    logInfo('visit_request.honeypot', {outcome: 'dropped'});
    return thankYou();
  }
  if (parsed.status === 'invalid') {
    logInfo('visit_request.completed', {
      outcome: 'invalid',
      fieldCount: Object.keys(parsed.errors).length,
    });
    return result(
      {
        status: 'invalid',
        message: VISIT_MESSAGES.invalid,
        errors: parsed.errors,
      },
      422,
    );
  }

  const saved = await saveSafely(deps.client, parsed.request);
  if (saved.status === 'failed') {
    // `auth` is ours to fix (token or scope): alert on it.
    logWarn('visit_request.upstream_failed', {reason: saved.reason});
    return unavailable();
  }
  logInfo('visit_request.completed', {outcome: 'saved'});
  return thankYou();
}

/** The client does not throw by contract; if a future one does, the shopper still gets "try again later". */
async function saveSafely(
  client: VisitCustomerClient,
  request: Parameters<VisitCustomerClient['save']>[0],
): ReturnType<VisitCustomerClient['save']> {
  try {
    return await client.save(request);
  } catch {
    return {status: 'failed', reason: 'network'};
  }
}

// --- Wiring from the request context ---

let sharedGate: SignupGate | null = null;

/** Its own counters, so visit requests never use up the signup or order-tracking limits. Made on first use. */
function gateForInstance(): SignupGate {
  sharedGate ??= createSignupGate({
    store: createInMemoryRateLimitStore({now: () => Date.now()}),
    hash: createKeyHasher(),
  });
  return sharedGate;
}

/** Test-only reset of the per-instance counters. Not used by the app. */
export function resetVisitStateForTests(): void {
  sharedGate = null;
}

export function visitDepsFromEnv(
  env: object,
  fetchFn: FetchLike = (url, init) => fetch(url, init),
): VisitDeps {
  return {
    client: createVisitCustomerClient({env, fetch: fetchFn}),
    gate: gateForInstance(),
    addressHeader: readEnvString(env, 'TRUSTED_CLIENT_IP_HEADER'),
  };
}
