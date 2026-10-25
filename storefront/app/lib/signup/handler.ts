// SERVER ONLY. The request flow behind POST /signup (REQ-ANL-003, P7-02, NFR-011, NFR-013, T-05, T-10, T-13, T-16).
//
// In order:
//   1. POST only, same origin. Nothing is read or counted for anything else.
//   2. Signup not configured (no key or list, or a malformed one): "not available" (503). Nothing is faked, no call is made.
//   3. The body is read with a hard size cap; an unreadable or oversized body is just a form with nothing usable in it.
//   4. The rate-limit gate runs BEFORE any Klaviyo call and fails closed (a limiter error is "unavailable", not "allowed").
//   5. A filled honeypot gets the same "thank you" as a real signup and nothing else happens (the bot learns nothing).
//   6. Invalid input (address shape, missing consent, stale form) gets field messages. They describe the FORM only.
//   7. One Klaviyo call. Whatever Klaviyo already knows about the address (new, subscribed, unsubscribed, waiting for a
//      confirmation) the shopper sees the same "thank you": Klaviyo answers 202 for all of them, and the message is
//      true in every case. A Klaviyo outage, timeout or refusal is a friendly "try again later" and never an error page.
//   8. Logs carry event names, reason codes and counts. Never an address, phone number, key or Klaviyo message.
//
// The marketing-email consent is its own explicit act (an unticked checkbox with the sentence beside it). It does not
// read, set or depend on the analytics consent banner (docs/integrations/KLAVIYO.md, section 5).

import {isSameOriginRequest} from '~/lib/cart/http';
import {readSmallForm} from '~/lib/delivery-runtime/form';
import type {FetchLike} from '~/lib/extend/types';
import {readEnvString} from '~/lib/extend/env';
import {logInfo, logWarn} from '~/lib/logging/logger';
import {resolveClientAddress} from '~/lib/orders/guest-lookup-address';
import {
  createInMemoryRateLimitStore,
  createKeyHasher,
} from '~/lib/orders/guest-lookup-limiter';
import {PRIVATE_NO_STORE_HEADERS} from '~/lib/pages/private-response';
import {
  readSignupConfig,
  type SignupConfigOptions,
  type SignupServerConfig,
} from '~/lib/signup/config';
import {EMAIL_CONSENT} from '~/lib/signup/consent';
import {
  createKlaviyoClient,
  type KlaviyoClient,
  type SubscribeFailure,
  type SubscribeRequest,
  type SubscribeResult,
} from '~/lib/signup/klaviyo-client';
import {validateSignupEmail} from '~/lib/signup/email';
import {createSignupGate, type SignupGate} from '~/lib/signup/limiter';
import {parseSignupForm, type SignupInput} from '~/lib/signup/request';
import {
  SIGNUP_FIELD_ERRORS,
  SIGNUP_FIELDS,
  SIGNUP_MESSAGES,
  type SignupResponse,
} from '~/lib/signup/shared';

export type SignupHttpResult = {
  readonly response: SignupResponse;
  readonly status: number;
  readonly headers: Headers;
};

export type SignupDeps = {
  /** Null when the signup is not configured. */
  readonly client: KlaviyoClient | null;
  /** Whether the optional SMS fields are accepted. */
  readonly sms: boolean;
  readonly gate: SignupGate;
  /** The deployment's trusted address header (TRUSTED_CLIENT_IP_HEADER), if any. */
  readonly addressHeader: string | null;
};

function result(
  response: SignupResponse,
  status: number,
  extra: Readonly<Record<string, string>> = {},
): SignupHttpResult {
  const headers = new Headers(PRIVATE_NO_STORE_HEADERS);
  headers.set('X-Robots-Tag', 'noindex, nofollow');
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  return {response, status, headers};
}

const thankYou = (): SignupHttpResult =>
  result({status: 'ok', message: SIGNUP_MESSAGES.ok}, 200);

const unavailable = (status = 503): SignupHttpResult =>
  result({status: 'unavailable', message: SIGNUP_MESSAGES.unavailable}, status);

/**
 * What Klaviyo stores as the consent record's source: where the shopper signed up and which wording they saw.
 * Fixed text from our own allow-listed values; no personal data.
 */
export function consentSource(input: SignupInput): string {
  const sms = input.sms === null ? '' : `, ${input.sms.consentVersion}`;
  return `Storefront ${input.surface} signup form (${input.emailConsentVersion}${sms})`;
}

export async function handleSignup(
  request: Request,
  deps: SignupDeps,
): Promise<SignupHttpResult> {
  if (request.method !== 'POST') {
    logWarn('signup.rejected', {reason: 'method'});
    return result(
      {status: 'unavailable', message: SIGNUP_MESSAGES.unavailable},
      405,
      {Allow: 'POST'},
    );
  }
  if (!isSameOriginRequest(request)) {
    logWarn('signup.rejected', {reason: 'cross_origin'});
    return unavailable(403);
  }
  if (deps.client === null) {
    logWarn('signup.unavailable', {reason: 'not_configured'});
    return unavailable();
  }

  const read = await readSmallForm(request);
  const form = read.status === 'ok' ? read.form : new FormData();

  // The gate sees the address only when it is well-formed; a malformed one counts against the address alone.
  const parsed = parseSignupForm(form, {sms: deps.sms});
  // One definition of a countable address: the same check the signup itself uses (review n5).
  const checked = validateSignupEmail(form.get(SIGNUP_FIELDS.email));
  const gateEmail = checked.status === 'ok' ? checked.email : null;
  const caller = resolveClientAddress(request.headers, deps.addressHeader);
  const gate = await deps.gate.check({
    address: caller.address,
    addressKnown: caller.source === 'header',
    email: gateEmail,
    // Counted only for a number that would really be enrolled (valid, with its own ticked consent): SU-M3.
    phone: parsed.status === 'ok' ? (parsed.input.sms?.phone ?? null) : null,
  });
  if (!gate.allowed) {
    if (gate.reason === 'limiter_failed') {
      logWarn('signup.limiter_failed', {clientSource: caller.source});
      return unavailable();
    }
    logWarn('signup.rate_limited', {
      limitedBy: gate.limitedBy,
      retryAfterSeconds: gate.retryAfterSeconds,
      clientSource: caller.source,
    });
    return result(
      {status: 'rate_limited', message: SIGNUP_MESSAGES.rateLimited},
      429,
      {'Retry-After': String(Math.max(1, Math.ceil(gate.retryAfterSeconds)))},
    );
  }

  if (read.status !== 'ok') {
    logInfo('signup.completed', {outcome: 'unreadable_body'});
    return result(
      {
        status: 'invalid',
        message: SIGNUP_MESSAGES.invalid,
        errors: {form: SIGNUP_FIELD_ERRORS.stale},
      },
      400,
    );
  }
  if (parsed.status === 'honeypot') {
    // Its own event, so ops can see the volume of bots (review m4).
    logInfo('signup.honeypot', {outcome: 'dropped'});
    return thankYou();
  }
  if (parsed.status === 'invalid') {
    logInfo('signup.completed', {
      outcome: 'invalid',
      fieldCount: Object.keys(parsed.errors).length,
    });
    return result(
      {
        status: 'invalid',
        message: SIGNUP_MESSAGES.invalid,
        errors: parsed.errors,
      },
      422,
    );
  }

  const subscribed = await subscribeSafely(deps.client, {
    email: parsed.input.email,
    phone: parsed.input.sms?.phone ?? null,
    source: consentSource(parsed.input),
  });
  if (subscribed.status === 'failed') {
    // `config` and `auth` are OURS to fix (list id, key, revision): alert on them. The HTTP status is a number only.
    logWarn('signup.upstream_failed', {
      reason: subscribed.reason,
      surface: parsed.input.surface,
      ...(subscribed.httpStatus === undefined
        ? {}
        : {httpStatus: subscribed.httpStatus}),
    });
    return failureResponse(subscribed.reason);
  }
  if (parsed.input.strayFill) {
    // A person's autofill put text in the hidden field after the form had been open a while: not a bot, so it went ahead.
    logInfo('signup.honeypot', {outcome: 'ignored_autofill'});
  }
  logInfo('signup.completed', {
    outcome: 'submitted',
    surface: parsed.input.surface,
    withSms: parsed.input.sms !== null,
    consentVersion: EMAIL_CONSENT.version,
  });
  return thankYou();
}

/** The client never throws by contract; if a future one does, the shopper still gets "try again later", not an error page. */
async function subscribeSafely(
  client: KlaviyoClient,
  request: SubscribeRequest,
): Promise<SubscribeResult> {
  try {
    return await client.subscribe(request);
  } catch {
    return {status: 'failed', reason: 'network'};
  }
}

/** A 'rejected' answer is Klaviyo refusing this one request; everything else is "try again later". */
function failureResponse(reason: SubscribeFailure): SignupHttpResult {
  if (reason === 'rejected') {
    return result(
      {
        status: 'invalid',
        message: SIGNUP_MESSAGES.invalid,
        errors: {form: SIGNUP_FIELD_ERRORS.rejected},
      },
      422,
    );
  }
  return unavailable(503);
}

// --- Wiring from the request context ---

let sharedGate: SignupGate | null = null;

/**
 * The counters for this runtime instance, made on the first request (the key hasher needs random values, which some
 * runtimes refuse at module load). Its own store: signup traffic never uses up the order-tracking counters.
 */
function gateForInstance(): SignupGate {
  sharedGate ??= createSignupGate({
    store: createInMemoryRateLimitStore({now: () => Date.now()}),
    hash: createKeyHasher(),
  });
  return sharedGate;
}

/** Test-only reset of the per-instance counters. Not used by the app. */
export function resetSignupStateForTests(): void {
  sharedGate = null;
}

export function signupDepsFromEnv(
  env: object,
  options: SignupConfigOptions,
  fetchFn: FetchLike = (url, init) => fetch(url, init),
): SignupDeps {
  const config: SignupServerConfig = readSignupConfig(env, options);
  return {
    client:
      config.status === 'ready'
        ? createKlaviyoClient({
            apiKey: config.apiKey,
            listId: config.listId,
            fetch: fetchFn,
          })
        : null,
    sms: config.status === 'ready' && config.sms,
    gate: gateForInstance(),
    addressHeader: readEnvString(env, 'TRUSTED_CLIENT_IP_HEADER'),
  };
}
