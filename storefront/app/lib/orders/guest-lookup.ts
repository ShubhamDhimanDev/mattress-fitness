// Guest order tracking by order number and email (REQ-ACC-003, threat T-09).
//
// Pure logic for a server route; this module makes no network calls and reads no
// clock or environment: time, rate-limit state and the Admin API response are
// all passed in. The route (P6-08) owns the HTTP call, the Admin token (server
// only) and the response.
//
// Rules this module enforces:
//   - ONE generic failure for every reason (no such order, wrong email, order
//     too old, malformed input, rate limited upstream of here): the shopper and
//     an attacker learn nothing about which field was wrong or whether an order
//     number exists.
//   - Only a minimal view of a matched order is returned (no address, phone, email).
//   - User input never becomes GraphQL structure: the query text is a constant and
//     the only user-derived value travels as a variable, after strict validation.
//   - Personal data stays out of logs (redactLogFields).
//
// Limits to know about (raise with the security-engineer before go-live):
//   - Constant-time comparison in JavaScript is best effort, not a guarantee.
//   - The in-memory rate limiter is per runtime instance. On Oxygen workers each
//     isolate has its own memory, so it slows casual guessing but is NOT a hard
//     limit; a shared store or Cloudflare rate-limit rule is needed for that.
//   - The Admin API only returns about 60 days of orders without the
//     read_all_orders scope (BASIC_PLAN_WORKAROUNDS item 9, V-09, V-20).

import {cleanText, removeInvisibleCharacters} from '~/lib/catalog/text';

export const GUEST_LOOKUP_WINDOW_DAYS = 60;
/** The generic message. It also covers old orders, so it reveals nothing by mentioning them. */
export const GUEST_LOOKUP_FAILURE_MESSAGE =
  "We couldn't find an order with those details. Check the order number and email, " +
  'or sign in to your account. Orders older than 60 days are not available here; ' +
  'use the link in your confirmation email or sign in.';

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
/** Tolerated difference between our clock and Shopify's for a just-placed order. */
const CLOCK_SKEW_MS = 5 * MINUTE_MS;

// --- Input normalisation ---

export type OrderNumberResult =
  | {readonly status: 'ok'; readonly number: string}
  | {readonly status: 'invalid'};

// "ORDER-1001", "Order #1001", "order no. 1001", "Order Number: 1001"
const ORDER_WORD_PREFIX =
  /^(?:order|ord)(?:\s*(?:no|number|num|#))?\.?[\s:_#-]*/i;
// Digits and letters, with an optional short suffix for split orders ("1001-A").
const ORDER_NUMBER_PATTERN = /^[A-Z0-9]{1,20}(?:-[A-Z0-9]{1,6})?$/;

/**
 * "#1001", "1001", " 1001 ", "ORDER-1001" and similar all become "1001".
 * Anything that is not letters, digits and at most one hyphen is invalid, which
 * also keeps search-syntax characters out of the Admin API query.
 */
export function normalizeOrderNumber(raw: unknown): OrderNumberResult {
  if (typeof raw !== 'string' || raw.length > 60) return {status: 'invalid'};
  // Only invisible characters are removed: markup or control characters inside
  // an identifier make it invalid rather than being quietly scrubbed.
  let value = removeInvisibleCharacters(raw.normalize('NFKC')).trim();
  value = value.replace(ORDER_WORD_PREFIX, '');
  if (value.startsWith('#')) value = value.slice(1);
  value = value.trim().toUpperCase();
  return ORDER_NUMBER_PATTERN.test(value)
    ? {status: 'ok', number: value}
    : {status: 'invalid'};
}

/** The name Shopify gives the order, "#1001" with the default prefix. */
export function shopifyOrderName(number: string, prefix = '#'): string {
  return `${prefix}${number}`;
}

export type EmailResult =
  | {readonly status: 'ok'; readonly email: string}
  | {readonly status: 'invalid'};

const EMAIL_LOCAL =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const EMAIL_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Trims and lowercases, then checks the usual address shape. Dots and "+tags"
 * are kept as typed: Shopify stores the address as entered, and removing them
 * would let one person match another's order. Non-ASCII addresses are not
 * accepted (punycode only); a shopper with one signs in instead.
 */
export function normalizeEmail(raw: unknown): EmailResult {
  if (typeof raw !== 'string' || raw.length > 320) return {status: 'invalid'};
  const value = raw.trim().toLowerCase();
  if (value.length < 3 || value.length > 254) return {status: 'invalid'};
  const parts = value.split('@');
  const [local, domain] = parts;
  if (parts.length !== 2 || local === undefined || domain === undefined) {
    return {status: 'invalid'};
  }
  if (local.length === 0 || local.length > 64 || !EMAIL_LOCAL.test(local)) {
    return {status: 'invalid'};
  }
  const labels = domain.split('.');
  const topLevel = labels[labels.length - 1] ?? '';
  const domainOk =
    domain.length <= 253 &&
    labels.length >= 2 &&
    labels.every((label) => EMAIL_LABEL.test(label)) &&
    /^(?:[a-z]{2,}|xn--[a-z0-9-]+)$/.test(topLevel);
  return domainOk ? {status: 'ok', email: value} : {status: 'invalid'};
}

export type GuestLookupInput =
  | {
      readonly status: 'ok';
      readonly orderNumber: string;
      readonly email: string;
    }
  | {readonly status: 'invalid_format'};

/**
 * Format check for the form, before any lookup. A malformed value says nothing
 * about whether an order exists, so the route may show a "check the format"
 * hint, but a well-formed pair that finds nothing must use the generic message.
 */
export function validateGuestLookupInput(input: {
  readonly orderNumber: unknown;
  readonly email: unknown;
}): GuestLookupInput {
  const order = normalizeOrderNumber(input.orderNumber);
  const email = normalizeEmail(input.email);
  return order.status === 'ok' && email.status === 'ok'
    ? {status: 'ok', orderNumber: order.number, email: email.email}
    : {status: 'invalid_format'};
}

/**
 * Compares two strings by looking at every character whatever the content, so
 * the time taken does not reveal where they first differ. Best effort in
 * JavaScript; see the file header.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length);
  let difference = a.length ^ b.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }
  return difference === 0;
}

// --- The order as read from the Admin API, and what a guest may see ---

export type CandidateTracking = {
  readonly company: string | null;
  readonly number: string | null;
  readonly url: string | null;
};

export type GuestOrderCandidate = {
  readonly name: string;
  readonly email: string | null;
  /** ISO 8601 timestamp. */
  readonly createdAt: string;
  readonly cancelledAt: string | null;
  readonly displayFulfillmentStatus: string | null;
  readonly lineItems: readonly {
    readonly title: string;
    readonly quantity: number;
  }[];
  readonly fulfillments: readonly {
    readonly displayStatus: string | null;
    readonly tracking: readonly CandidateTracking[];
  }[];
};

export type GuestOrderStatus =
  | 'cancelled'
  | 'fulfilled'
  | 'partially_fulfilled'
  | 'processing'
  | 'on_hold'
  | 'scheduled'
  | 'returned';

export type GuestOrderView = {
  readonly orderName: string;
  readonly placedAt: string;
  readonly status: GuestOrderStatus;
  readonly statusLabel: string;
  readonly items: readonly {
    readonly title: string;
    readonly quantity: number;
  }[];
  readonly shipments: readonly {
    readonly statusLabel: string | null;
    readonly trackingCompany: string | null;
    readonly trackingNumber: string | null;
    readonly trackingUrl: string | null;
  }[];
};

export type GuestMatchResult =
  | {readonly status: 'match'; readonly order: GuestOrderView}
  | {readonly status: 'no_match'};

const NO_MATCH: GuestMatchResult = {status: 'no_match'};

const STATUS_LABELS: Readonly<Record<GuestOrderStatus, string>> = {
  cancelled: 'Cancelled',
  fulfilled: 'Fulfilled',
  partially_fulfilled: 'Partially fulfilled',
  processing: 'Being prepared',
  on_hold: 'On hold',
  scheduled: 'Scheduled',
  returned: 'Returned',
};

/**
 * ASSUMPTION(V-09): values of the Admin API OrderDisplayFulfillmentStatus enum
 * as listed in Shopify's docs. An unknown value falls back to "processing", so
 * a new value can never show something wrong.
 */
const FULFILLMENT_STATUS: ReadonlyMap<string, GuestOrderStatus> = new Map([
  ['FULFILLED', 'fulfilled'],
  ['PARTIALLY_FULFILLED', 'partially_fulfilled'],
  ['ON_HOLD', 'on_hold'],
  ['SCHEDULED', 'scheduled'],
  ['RESTOCKED', 'returned'],
  ['UNFULFILLED', 'processing'],
  ['PENDING_FULFILLMENT', 'processing'],
  ['OPEN', 'processing'],
  ['IN_PROGRESS', 'processing'],
  ['REQUEST_DECLINED', 'processing'],
]);

/**
 * ASSUMPTION(V-09): values of the Admin API FulfillmentDisplayStatus enum. A
 * value that is not listed gets no label rather than a wrong one.
 */
const SHIPMENT_LABELS: ReadonlyMap<string, string> = new Map([
  ['SUBMITTED', 'Preparing to ship'],
  ['CONFIRMED', 'Preparing to ship'],
  ['LABEL_PURCHASED', 'Label created'],
  ['LABEL_PRINTED', 'Label created'],
  ['FULFILLED', 'Shipped'],
  ['MARKED_AS_FULFILLED', 'Shipped'],
  ['IN_TRANSIT', 'In transit'],
  ['OUT_FOR_DELIVERY', 'Out for delivery'],
  ['ATTEMPTED_DELIVERY', 'Delivery attempted'],
  ['DELIVERED', 'Delivered'],
  ['READY_FOR_PICKUP', 'Ready for pickup'],
  ['PICKED_UP', 'Picked up'],
  ['DELAYED', 'Delayed'],
  ['NOT_DELIVERED', 'Not delivered'],
  ['FAILURE', 'Delivery failed'],
  ['CANCELED', 'Cancelled'],
]);

export function deriveGuestOrderStatus(
  candidate: Pick<
    GuestOrderCandidate,
    'cancelledAt' | 'displayFulfillmentStatus'
  >,
): GuestOrderStatus {
  if (candidate.cancelledAt) return 'cancelled';
  return (
    FULFILLMENT_STATUS.get(candidate.displayFulfillmentStatus ?? '') ??
    'processing'
  );
}

/** Within the lookup window (inclusive), allowing a few minutes of clock skew. */
export function isWithinLookupWindow(
  createdAt: string,
  nowMs: number,
  windowDays = GUEST_LOOKUP_WINDOW_DAYS,
): boolean {
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created) || !Number.isFinite(nowMs)) return false;
  const age = nowMs - created;
  return age >= -CLOCK_SKEW_MS && age <= windowDays * DAY_MS;
}

function httpsUrlOrNull(value: string | null): string | null {
  if (!value || value.length > 2000) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function shortText(value: string | null, maxLength: number): string | null {
  if (value === null) return null;
  const text = cleanText(value);
  return text !== '' ? text.slice(0, maxLength) : null;
}

function toView(candidate: GuestOrderCandidate): GuestOrderView {
  const status = deriveGuestOrderStatus(candidate);
  return {
    orderName: shortText(candidate.name, 40) ?? '',
    placedAt: candidate.createdAt,
    status,
    statusLabel: STATUS_LABELS[status],
    items: candidate.lineItems.map((item) => ({
      title: shortText(item.title, 200) ?? 'Item',
      quantity: item.quantity,
    })),
    shipments: candidate.fulfillments.flatMap((fulfillment) => {
      const label =
        SHIPMENT_LABELS.get(fulfillment.displayStatus ?? '') ?? null;
      const tracking =
        fulfillment.tracking.length > 0
          ? fulfillment.tracking
          : [{company: null, number: null, url: null}];
      return tracking.map((entry) => ({
        statusLabel: label,
        trackingCompany: shortText(entry.company, 100),
        trackingNumber: shortText(entry.number, 100),
        trackingUrl: httpsUrlOrNull(entry.url),
      }));
    }),
  };
}

/**
 * Decides whether the shopper's number and email match one Admin API order.
 * Every comparison runs for every call (candidate or not, input valid or not),
 * so which check failed cannot be read from the result or the work done. The
 * only failure is `no_match`.
 */
export function matchGuestOrder(
  candidate: GuestOrderCandidate | null,
  input: {readonly orderNumber: unknown; readonly email: unknown},
  nowMs: number,
): GuestMatchResult {
  const wantedNumber = normalizeOrderNumber(input.orderNumber);
  const wantedEmail = normalizeEmail(input.email);
  const actualNumber = normalizeOrderNumber(candidate?.name);
  const actualEmail = normalizeEmail(candidate?.email);

  // Placeholders differ from each other and can never be a valid number or email
  // (no "@", and "~" is not allowed in an order number), so two unusable values
  // are never reported as equal.
  const numberMatches = constantTimeEqual(
    wantedNumber.status === 'ok' ? wantedNumber.number : '~wanted~',
    actualNumber.status === 'ok' ? actualNumber.number : '~actual~',
  );
  const emailMatches = constantTimeEqual(
    wantedEmail.status === 'ok' ? wantedEmail.email : '~wanted~',
    actualEmail.status === 'ok' ? actualEmail.email : '~actual~',
  );
  const inWindow = candidate
    ? isWithinLookupWindow(candidate.createdAt, nowMs)
    : false;

  const checks = [
    candidate !== null,
    wantedNumber.status === 'ok',
    wantedEmail.status === 'ok',
    numberMatches,
    emailMatches,
    inWindow,
  ];
  // Counted rather than short-circuited, so every check is always evaluated.
  const passed = checks.reduce((total, ok) => total + (ok ? 1 : 0), 0);
  return candidate !== null && passed === checks.length
    ? {status: 'match', order: toView(candidate)}
    : NO_MATCH;
}

/** Same as matchGuestOrder for the several orders a name search can return (split orders). */
export function matchGuestOrderFromList(
  candidates: readonly GuestOrderCandidate[],
  input: {readonly orderNumber: unknown; readonly email: unknown},
  nowMs: number,
): GuestMatchResult {
  let found: GuestMatchResult = NO_MATCH;
  // Looks at every candidate even after a match, so the work does not reveal which one matched.
  const attempts = candidates.length > 0 ? candidates : [null];
  for (const candidate of attempts) {
    const result = matchGuestOrder(candidate, input, nowMs);
    if (found.status === 'no_match' && result.status === 'match')
      found = result;
  }
  return found;
}

// --- Admin API request and response ---

/**
 * The query text is a constant: nothing a shopper types is ever placed in it.
 * ASSUMPTION(V-09, V-20): the Dev Dashboard app has the read_orders scope on the
 * client's store, and Order.email, displayFulfillmentStatus, lineItems and
 * fulfillments.trackingInfo are readable with it. Without read_all_orders the
 * API returns about the last 60 days.
 */
export const GUEST_ORDER_LOOKUP_QUERY = `
query GuestOrderLookup($query: String!) {
  orders(first: 5, query: $query, sortKey: PROCESSED_AT, reverse: true) {
    nodes {
      name
      email
      createdAt
      cancelledAt
      displayFulfillmentStatus
      lineItems(first: 25) {
        nodes {
          title
          quantity
        }
      }
      fulfillments(first: 10) {
        displayStatus
        trackingInfo(first: 5) {
          company
          number
          url
        }
      }
    }
  }
}
`;

export type GuestOrderLookupRequest = {
  readonly operationName: 'GuestOrderLookup';
  readonly query: string;
  readonly variables: {readonly query: string};
};

export type BuildRequestResult =
  | {readonly status: 'ok'; readonly request: GuestOrderLookupRequest}
  | {readonly status: 'invalid'};

/**
 * Builds the request for a name search. The search text `name:1001` goes in a
 * variable, and only after normalizeOrderNumber has limited it to letters,
 * digits and one hyphen, so it cannot carry search operators. ASSUMPTION(V-09):
 * `name:1001` matches the order named "#1001"; the result is checked again by
 * matchGuestOrder either way, so a loose match can never leak another order.
 */
export function buildGuestOrderLookupRequest(
  rawOrderNumber: unknown,
): BuildRequestResult {
  const order = normalizeOrderNumber(rawOrderNumber);
  if (order.status !== 'ok') return {status: 'invalid'};
  return {
    status: 'ok',
    request: {
      operationName: 'GuestOrderLookup',
      query: GUEST_ORDER_LOOKUP_QUERY,
      variables: {query: `name:${order.number}`},
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown, maxLength: number): string | null {
  return typeof value === 'string' && value.length <= maxLength ? value : null;
}

function readTracking(value: unknown): CandidateTracking[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 5).flatMap((entry: unknown) =>
    isRecord(entry)
      ? [
          {
            company: stringOrNull(entry.company, 200),
            number: stringOrNull(entry.number, 200),
            url: stringOrNull(entry.url, 2000),
          },
        ]
      : [],
  );
}

function readOrderNode(raw: unknown): GuestOrderCandidate | null {
  if (!isRecord(raw)) return null;
  const name = stringOrNull(raw.name, 40);
  const createdAt = stringOrNull(raw.createdAt, 40);
  if (name === null || createdAt === null) return null;

  const itemNodes =
    isRecord(raw.lineItems) && Array.isArray(raw.lineItems.nodes)
      ? raw.lineItems.nodes
      : [];
  const lineItems = itemNodes.slice(0, 50).flatMap((item: unknown) => {
    if (!isRecord(item)) return [];
    const title = stringOrNull(item.title, 500);
    const quantity = item.quantity;
    return title !== null &&
      typeof quantity === 'number' &&
      Number.isInteger(quantity) &&
      quantity >= 0 &&
      quantity <= 100_000
      ? [{title, quantity}]
      : [];
  });
  const fulfillments = (Array.isArray(raw.fulfillments) ? raw.fulfillments : [])
    .slice(0, 10)
    .flatMap((entry: unknown) =>
      isRecord(entry)
        ? [
            {
              displayStatus: stringOrNull(entry.displayStatus, 60),
              tracking: readTracking(entry.trackingInfo),
            },
          ]
        : [],
    );
  return {
    name,
    email: stringOrNull(raw.email, 320),
    createdAt,
    cancelledAt: stringOrNull(raw.cancelledAt, 40),
    displayFulfillmentStatus: stringOrNull(raw.displayFulfillmentStatus, 60),
    lineItems,
    fulfillments,
  };
}

export type ParsedLookupResponse =
  | {readonly status: 'ok'; readonly candidates: readonly GuestOrderCandidate[]}
  | {readonly status: 'upstream_error'};

/**
 * Reads the Admin API JSON. GraphQL errors or a missing `orders` field are an
 * upstream failure (the route answers 502/503), which is different from "no
 * match" and says nothing about any order.
 */
export function parseGuestOrderResponse(json: unknown): ParsedLookupResponse {
  if (!isRecord(json)) return {status: 'upstream_error'};
  if (Array.isArray(json.errors) && json.errors.length > 0)
    return {status: 'upstream_error'};
  const data = json.data;
  const orders = isRecord(data) ? data.orders : undefined;
  const nodes = isRecord(orders) ? orders.nodes : undefined;
  if (!Array.isArray(nodes)) return {status: 'upstream_error'};
  return {
    status: 'ok',
    candidates: nodes.slice(0, 10).flatMap((node: unknown) => {
      const candidate = readOrderNode(node);
      return candidate ? [candidate] : [];
    }),
  };
}

// --- Rate limiting ---

export type RateLimitConfig = {
  readonly limit: number;
  readonly windowMs: number;
  /** Injected clock returning epoch milliseconds. */
  readonly now: () => number;
  /** Upper bound on tracked keys, so a flood of new keys cannot exhaust memory. */
  readonly maxKeys?: number;
};

export type RateLimitResult =
  | {readonly allowed: true; readonly remaining: number}
  | {readonly allowed: false; readonly retryAfterSeconds: number};

export type RateLimiter = {
  /** Records an attempt for the key and says whether it is allowed. */
  check(key: string): RateLimitResult;
};

const DEFAULT_MAX_KEYS = 5000;
const MAX_KEY_LENGTH = 300;

/**
 * Sliding-window limiter: at most `limit` attempts per `windowMs` for each key.
 * Blocked attempts are not recorded, so the block lifts exactly when the oldest
 * counted attempt leaves the window. An unusable clock blocks (fails closed).
 * Keys can hold an email or an IP address: keep them in memory only, never log them.
 */
export function createRateLimiter(config: RateLimitConfig): RateLimiter {
  const maxKeys = config.maxKeys ?? DEFAULT_MAX_KEYS;
  const attempts = new Map<string, number[]>();

  function sweep(now: number): void {
    const cutoff = now - config.windowMs;
    for (const [key, times] of attempts) {
      if (times.every((time) => time <= cutoff)) attempts.delete(key);
    }
    // Still too many: drop the least recently used keys.
    for (const key of attempts.keys()) {
      if (attempts.size <= maxKeys) break;
      attempts.delete(key);
    }
  }

  return {
    check(rawKey: string): RateLimitResult {
      const now = config.now();
      if (!Number.isFinite(now)) {
        return {
          allowed: false,
          retryAfterSeconds: Math.ceil(config.windowMs / 1000),
        };
      }
      const key = rawKey.slice(0, MAX_KEY_LENGTH);
      const cutoff = now - config.windowMs;
      // A time in the future (clock moved back) counts as now rather than blocking for longer.
      const recent = (attempts.get(key) ?? [])
        .map((time) => Math.min(time, now))
        .filter((time) => time > cutoff);

      if (recent.length >= config.limit) {
        const oldest = recent[0] ?? now;
        attempts.delete(key);
        attempts.set(key, recent);
        return {
          allowed: false,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((oldest + config.windowMs - now) / 1000),
          ),
        };
      }
      recent.push(now);
      // Delete then set keeps the Map in least-recently-used order.
      attempts.delete(key);
      attempts.set(key, recent);
      if (attempts.size > maxKeys) sweep(now);
      return {allowed: true, remaining: config.limit - recent.length};
    },
  };
}

/**
 * ASSUMPTION (pending Q-009 and security review): the numbers below are a
 * starting point. Ten tries per address and five per email per 15 minutes stop
 * guessing without troubling a shopper who mistypes twice.
 */
export type GuestLookupLimits = {
  readonly perAddress: {readonly limit: number; readonly windowMs: number};
  readonly perEmail: {readonly limit: number; readonly windowMs: number};
  readonly overall: {readonly limit: number; readonly windowMs: number};
};

export const GUEST_LOOKUP_LIMITS: GuestLookupLimits = {
  perAddress: {limit: 10, windowMs: 15 * MINUTE_MS},
  perEmail: {limit: 5, windowMs: 15 * MINUTE_MS},
  overall: {limit: 300, windowMs: 15 * MINUTE_MS},
};

export type GuestLookupGuardResult =
  | {readonly allowed: true}
  | {
      readonly allowed: false;
      readonly retryAfterSeconds: number;
      /** For logs only; never shown to the shopper. */
      readonly limitedBy: 'address' | 'email' | 'overall';
    };

export type GuestLookupGuard = {
  /**
   * `address` is the caller's IP or another client identifier (never logged);
   * `email` is the value from the form, normalised here. Checks in order, and an
   * attempt blocked by an earlier limiter is not counted against a later one.
   */
  check(input: {
    readonly address: string;
    readonly email: unknown;
  }): GuestLookupGuardResult;
};

export function createGuestLookupGuard(options: {
  readonly now: () => number;
  readonly limits?: GuestLookupLimits;
}): GuestLookupGuard {
  const limits = options.limits ?? GUEST_LOOKUP_LIMITS;
  const make = (limit: {limit: number; windowMs: number}) =>
    createRateLimiter({...limit, now: options.now});
  const perAddress = make(limits.perAddress);
  const perEmail = make(limits.perEmail);
  const overall = make(limits.overall);

  return {
    check({address, email}) {
      const byAddress = perAddress.check(`address:${address}`);
      if (!byAddress.allowed) {
        return {
          allowed: false,
          retryAfterSeconds: byAddress.retryAfterSeconds,
          limitedBy: 'address',
        };
      }
      const normalized = normalizeEmail(email);
      // A malformed email still counts against the address limiter above; it cannot name a victim.
      if (normalized.status === 'ok') {
        const byEmail = perEmail.check(`email:${normalized.email}`);
        if (!byEmail.allowed) {
          return {
            allowed: false,
            retryAfterSeconds: byEmail.retryAfterSeconds,
            limitedBy: 'email',
          };
        }
      }
      const total = overall.check('overall');
      if (!total.allowed) {
        return {
          allowed: false,
          retryAfterSeconds: total.retryAfterSeconds,
          limitedBy: 'overall',
        };
      }
      return {allowed: true};
    },
  };
}

// --- Logging ---

/**
 * Fields that may be logged (still scrubbed for emails and numbers). They must
 * carry codes and counts, never free text a shopper typed: a name cannot be
 * recognised in a sentence, so it is kept out by never logging it.
 */
export const LOG_SAFE_KEYS: ReadonlySet<string> = new Set([
  'event',
  'outcome',
  'reason',
  'status',
  'limitedBy',
  'retryAfterSeconds',
  'durationMs',
  'candidateCount',
  'httpStatus',
  'upstream',
]);

const REDACTED = '[redacted]';
const EMAIL_IN_TEXT = /[^\s@]+@[^\s@]+/g;
const DIGIT_RUN = /\d{4,}/g;

function scrub(text: string): string {
  return cleanText(text)
    .replace(EMAIL_IN_TEXT, '[email]')
    .replace(DIGIT_RUN, '[number]')
    .slice(0, 120);
}

/**
 * Makes a set of fields safe to log (T-05, T-09). Only an allow-list of keys is
 * kept; every other key, and any value that is not a plain string, number or
 * boolean, becomes "[redacted]". Text in kept fields has emails and long digit
 * runs (order numbers, phone numbers, ZIP+4) replaced.
 */
export function redactLogFields(
  fields: Readonly<Record<string, unknown>>,
): Record<string, string | number | boolean> {
  const entries = Object.entries(fields)
    .slice(0, 30)
    .map(([key, value]): [string, string | number | boolean] => {
      if (!LOG_SAFE_KEYS.has(key)) {
        return [key.slice(0, 40).replace(/[^A-Za-z0-9_.-]/g, '_'), REDACTED];
      }
      if (typeof value === 'string') return [key, scrub(value)];
      if (typeof value === 'number' && Number.isFinite(value))
        return [key, value];
      if (typeof value === 'boolean') return [key, value];
      return [key, REDACTED];
    });
  // fromEntries defines own properties, so a key such as "__proto__" is harmless.
  return Object.fromEntries(entries);
}
