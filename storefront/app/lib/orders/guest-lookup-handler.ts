// SERVER ONLY. The request flow behind POST /track-order (REQ-ACC-003, P6-08, threat T-09, T-05, T-13).
//
// What it guarantees, in order:
//   1. POST only, same origin; no lookup ever happens on a GET (the route loader never reads the query string).
//   2. No Admin token configured: "Order lookup is not available right now" (503). Nothing is faked.
//   3. The rate-limit gate runs BEFORE any lookup and fails closed (limiter error -> unavailable, not "allowed").
//   4. Every other outcome that depends on the order or the form (malformed input, no such order, wrong email, order
//      older than 60 days, Admin API down, timeout, bad answer) produces the SAME response: same status (200), same
//      shape, same message, same headers, and the same minimum duration. The shopper, and anyone probing, learns
//      only "found" or "not found". Which of the reasons it was goes to the log as a code, never to the browser.
//   5. The matched order's email is compared in constant time (guest-lookup.ts); only a minimal view leaves.
//   6. Logs carry event names, codes and counts. Never an order number, email, address or the client's address.
//
// Timing. A response is held back until at least `minDurationMs` has passed since the request started, so a lookup
// that never reached the Admin API (bad format) takes about as long as one that did. This hides the upstream
// round trip, not every microsecond difference; a lookup slower than the floor is not padded. It is a mitigation,
// not a guarantee, and the numbers are UNVERIFIED against real Admin API latency (V-20).

import {isSameOriginRequest} from '~/lib/cart/http';
import {readSmallForm} from '~/lib/delivery-runtime/form';
import {adminConfigFromEnv} from '~/lib/extend/admin-client';
import {readEnvString} from '~/lib/extend/env';
import type {FetchLike, SleepFn} from '~/lib/extend/types';
import {logInfo, logWarn} from '~/lib/logging/logger';
import {PRIVATE_NO_STORE_HEADERS} from '~/lib/pages/private-response';
import {
  buildGuestOrderLookupRequest,
  GUEST_LOOKUP_FAILURE_MESSAGE,
  matchGuestOrderFromList,
  parseTrackingLinkHosts,
  validateGuestLookupInput,
  type GuestOrderView,
} from '~/lib/orders/guest-lookup';
import {resolveClientAddress} from '~/lib/orders/guest-lookup-address';
import {
  createAdminGuestOrderClient,
  type GuestOrderAdminClient,
} from '~/lib/orders/guest-lookup-client';
import {
  createGuestLookupGate,
  createInMemoryRateLimitStore,
  createKeyHasher,
  type GuestLookupGate,
} from '~/lib/orders/guest-lookup-limiter';

export const GUEST_LOOKUP_UNAVAILABLE_MESSAGE =
  'Order lookup is not available right now. Please sign in to your account to see your order, or try again later.';
export const GUEST_LOOKUP_RATE_LIMITED_MESSAGE =
  'Too many attempts. Please wait a few minutes and try again, or sign in to your account.';

/** ASSUMPTION(V-20): typical Admin API round trip is a few hundred ms; this floor sits above it. */
export const GUEST_LOOKUP_MIN_DURATION_MS = 800;

export type GuestLookupResponse =
  | {readonly status: 'found'; readonly order: GuestOrderView}
  | {readonly status: 'not_found'; readonly message: string}
  | {readonly status: 'rate_limited'; readonly message: string}
  | {readonly status: 'unavailable'; readonly message: string};

export type GuestLookupHttpResult = {
  readonly response: GuestLookupResponse;
  readonly status: number;
  readonly headers: Headers;
};

// The caller's address (security review M-1, L-5) is read only from the header the deployment names in
// TRUSTED_CLIENT_IP_HEADER; with none, every caller shares one stricter bucket. Re-exported for the tests.
export {resolveClientAddress};

// --- The flow ---

export type GuestLookupDeps = {
  /** Null when the Admin token is not configured: the lookup is unavailable. */
  readonly client: GuestOrderAdminClient | null;
  readonly gate: GuestLookupGate;
  readonly now: () => number;
  readonly sleep: SleepFn;
  /** The deployment's trusted address header (TRUSTED_CLIENT_IP_HEADER), if any. */
  readonly addressHeader: string | null;
  /** Carrier domains whose tracking pages may be linked (TRACKING_LINK_HOSTS plus the built-ins). */
  readonly trackingLinkHosts?: readonly string[];
  readonly minDurationMs?: number;
};

function result(
  response: GuestLookupResponse,
  status: number,
  extra: Readonly<Record<string, string>> = {},
): GuestLookupHttpResult {
  const headers = new Headers(PRIVATE_NO_STORE_HEADERS);
  headers.set('X-Robots-Tag', 'noindex, nofollow');
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  return {response, status, headers};
}

/** The one answer for every outcome that depends on the order or the form. */
function genericNotFound(): GuestLookupHttpResult {
  return result(
    {status: 'not_found', message: GUEST_LOOKUP_FAILURE_MESSAGE},
    200,
  );
}

function unavailable(): GuestLookupHttpResult {
  return result(
    {status: 'unavailable', message: GUEST_LOOKUP_UNAVAILABLE_MESSAGE},
    503,
  );
}

export async function handleGuestLookup(
  request: Request,
  deps: GuestLookupDeps,
): Promise<GuestLookupHttpResult> {
  const startedAt = deps.now();
  const floorMs = deps.minDurationMs ?? GUEST_LOOKUP_MIN_DURATION_MS;
  // Held back until the floor has passed, so a lookup that skipped the Admin API is not faster than one that used it.
  const finish = async (
    done: GuestLookupHttpResult,
  ): Promise<GuestLookupHttpResult> => {
    const remaining = floorMs - (deps.now() - startedAt);
    if (remaining > 0) await deps.sleep(remaining);
    return done;
  };

  if (request.method !== 'POST') {
    logWarn('guest_lookup.rejected', {reason: 'method'});
    return result(
      {status: 'not_found', message: GUEST_LOOKUP_FAILURE_MESSAGE},
      405,
      {Allow: 'POST'},
    );
  }
  if (!isSameOriginRequest(request)) {
    logWarn('guest_lookup.rejected', {reason: 'cross_origin'});
    return result(
      {status: 'not_found', message: GUEST_LOOKUP_FAILURE_MESSAGE},
      403,
    );
  }
  if (deps.client === null) {
    logWarn('guest_lookup.unavailable', {reason: 'not_configured'});
    return unavailable();
  }

  // An unreadable or oversized body is just a lookup with no usable input: it is counted and answered like any other.
  const read = await readSmallForm(request);
  const orderNumber =
    read.status === 'ok' ? read.form.get('orderNumber') : null;
  const email = read.status === 'ok' ? read.form.get('email') : null;

  const caller = resolveClientAddress(request.headers, deps.addressHeader);
  const gate = await deps.gate.check({
    address: caller.address,
    orderNumber,
    email,
  });
  if (!gate.allowed) {
    if (gate.reason === 'limiter_failed') {
      logWarn('guest_lookup.limiter_failed', {clientSource: caller.source});
      return unavailable();
    }
    logWarn('guest_lookup.rate_limited', {
      limitedBy: gate.limitedBy,
      retryAfterSeconds: gate.retryAfterSeconds,
      clientSource: caller.source,
    });
    return result(
      {status: 'rate_limited', message: GUEST_LOOKUP_RATE_LIMITED_MESSAGE},
      429,
      {'Retry-After': String(Math.max(1, Math.ceil(gate.retryAfterSeconds)))},
    );
  }

  const input = validateGuestLookupInput({orderNumber, email});
  const lookup = buildGuestOrderLookupRequest(orderNumber);
  if (input.status !== 'ok' || lookup.status !== 'ok') {
    logInfo('guest_lookup.completed', {outcome: 'invalid_input'});
    return finish(genericNotFound());
  }

  const upstream = await deps.client.lookup(lookup.request);
  if (upstream.status === 'error') {
    logWarn('guest_lookup.upstream_failed', {reason: upstream.reason});
    return finish(genericNotFound());
  }

  const matched = matchGuestOrderFromList(
    upstream.candidates,
    {orderNumber, email},
    deps.now(),
    deps.trackingLinkHosts ? {trackingLinkHosts: deps.trackingLinkHosts} : {},
  );
  logInfo('guest_lookup.completed', {
    outcome: matched.status === 'match' ? 'found' : 'no_match',
    candidateCount: upstream.candidates.length,
  });
  return finish(
    matched.status === 'match'
      ? result({status: 'found', order: matched.order}, 200)
      : genericNotFound(),
  );
}

// --- Wiring from the request context ---

type SharedState = {
  readonly gate: GuestLookupGate;
};

let shared: SharedState | null = null;
let warnedAboutTrackingHosts = false;

/**
 * The counters for this runtime instance, made on the first request (not at module load: the key hasher needs
 * random values, which some runtimes refuse in the global scope). Per instance by design; see guest-lookup-limiter.ts
 * and P6-14 for the shared replacement.
 */
function sharedState(): SharedState {
  shared ??= {
    gate: createGuestLookupGate({
      store: createInMemoryRateLimitStore({now: () => Date.now()}),
      hash: createKeyHasher(),
    }),
  };
  return shared;
}

/** Test-only reset of the per-instance counters. Not used by the app. */
export function resetGuestLookupStateForTests(): void {
  shared = null;
  warnedAboutTrackingHosts = false;
}

export function sleepFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Whether the Admin token and store domain are configured. The page uses it to show the unavailable notice instead
 * of a form that could never work; it reads names only and returns no value.
 */
export function guestLookupConfigured(env: object): boolean {
  return adminConfigFromEnv(env).status === 'ready';
}

export function guestLookupDepsFromEnv(
  env: object,
  fetchFn: FetchLike = (url, init) => fetch(url, init),
): GuestLookupDeps {
  const admin = adminConfigFromEnv(env);
  const tracking = parseTrackingLinkHosts(
    readEnvString(env, 'TRACKING_LINK_HOSTS'),
  );
  if (tracking.rejectedCount > 0 && !warnedAboutTrackingHosts) {
    // Once per instance, a count only: the refused values are never logged.
    warnedAboutTrackingHosts = true;
    logWarn('guest_lookup.config_invalid', {
      reason: 'tracking_link_hosts',
      candidateCount: tracking.rejectedCount,
    });
  }
  return {
    client:
      admin.status === 'ready'
        ? createAdminGuestOrderClient({admin, fetch: fetchFn})
        : null,
    gate: sharedState().gate,
    now: () => Date.now(),
    sleep: sleepFor,
    addressHeader: readEnvString(env, 'TRUSTED_CLIENT_IP_HEADER'),
    trackingLinkHosts: tracking.hosts,
  };
}
