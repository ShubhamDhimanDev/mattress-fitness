// SERVER ONLY. Rate limiting for guest order tracking (REQ-ACC-003, P6-08, threat T-09, T-13, risk R-27).
//
// Two layers, so the shared limiter of P6-14 can replace the first without touching the second:
//   - `RateLimitStore`: where attempts are counted. Async on purpose (a shared store such as a Cache API entry,
//     KV or an edge service is asynchronous). It has two operations: `peek` (read only) and `hit` (record). This
//     file ships ONE implementation, `createInMemoryRateLimitStore`, which lives in the memory of one instance.
//   - `createGuestLookupGate`: WHICH counters a lookup must pass, and in what order, failing closed.
//
// Two passes (security review L-1). The gate first PEEKS at every counter, overall first, and records nothing. Only if
// every counter allows the attempt does it HIT them all. So an attempt that any counter refuses is recorded
// nowhere: a flood past the overall ceiling or from one blocked address cannot burn a victim's email or order
// allowance, or fill the stores with new keys.
//
// Atomic path (review M-2). The in-memory store offers `reserve(steps)`: the checks and the records happen in ONE
// synchronous call after every hash has been computed, so N parallel requests cannot all pass the checks before
// any is recorded. The gate uses it whenever the store has it. A store that cannot be atomic (a shared, remote
// one) leaves `reserve` out and the gate does the two passes above; their awaits can interleave, so such a store
// can overshoot a counter by the number of requests in flight (a hit that refuses after a passing peek is still
// honoured, and counters already hit stay recorded).
//
// The counters:
//   address        per client address (IPv6 reduced to its /64): one client trying many orders.
//   order+address  per order number and address: one client guessing emails for one order.
//   order          per order number alone: UNSPOOFABLE by the client, so it holds even when the address is not
//                  trustworthy. Trade-off: anyone can hold one order number's lookup shut for the window (the
//                  owner can still sign in or use the confirmation email link); see GUEST_TRACKING.md.
//   email          per email: the same, for one person's address from many clients.
//   overall        everything: a ceiling that is also a single-party kill switch if it is set too low; alert on it.
//
// The in-memory store is per instance. On Oxygen each isolate has its own memory; a Node deployment has one counter
// set per process and loses it on restart. It slows casual guessing; it is NOT a hard limit. The real limits that do
// not depend on this store: the generic failure message, the 60-day window, a matching email being needed as well as
// the order number, and the host's own per-address limit (nginx), which sees the real address.
//
// Keys. A counter key never holds a raw order number, email or address: the gate keyed-hashes each one first
// (HMAC-SHA-256, random per-instance key), because a shared store's key can appear in logs, dashboards and cache
// keys, and personal data must not (security rules, T-05). The per-instance random key means hashes cannot be
// compared between instances or restarts; a shared store needs one shared secret (GUEST_LOOKUP_KEY_SECRET, future,
// P6-14), derived per scope.

import {
  createRateLimiter,
  GUEST_LOOKUP_LIMITS,
  normalizeEmail,
  normalizeOrderNumber,
  type RateLimiter,
  type RateLimitResult,
} from '~/lib/orders/guest-lookup';

export type LimitRule = {
  readonly limit: number;
  readonly windowMs: number;
};

export type RateLimitStore = {
  /** Where the counters live, for the readiness checks and the runbook. */
  readonly kind: 'instance' | 'shared';
  /**
   * Says whether one more attempt for `key` under `scope` would be allowed, WITHOUT recording it. `key` is already
   * hashed. A store that cannot answer must reject (or throw): the gate treats that as "block".
   */
  peek(scope: string, key: string, rule: LimitRule): Promise<RateLimitResult>;
  /** Records one attempt for `key` under `scope` and says whether it was allowed. Same failure rule as `peek`. */
  hit(scope: string, key: string, rule: LimitRule): Promise<RateLimitResult>;
  /**
   * OPTIONAL, for a store whose state lives in this process only. Checks every step in order and, only if all
   * allow, records all of them, in ONE synchronous call: nothing can run between the check and the record, so
   * parallel requests cannot all pass a check before any is recorded (review M-2). A refused attempt records
   * nowhere. A store that cannot be atomic (a shared, remote one) leaves this out and the gate falls back to the
   * two-pass `peek` then `hit`, which can overshoot by the number of requests in flight.
   */
  reserve?(steps: readonly ReserveStep[]): ReserveResult;
};

export type ReserveStep = {
  readonly scope: string;
  readonly key: string;
  readonly rule: LimitRule;
};

export type ReserveResult =
  | {readonly allowed: true}
  /** `index` is the position in `steps` of the counter that refused. */
  | {
      readonly allowed: false;
      readonly index: number;
      readonly retryAfterSeconds: number;
    };

const DEFAULT_MAX_KEYS_PER_SCOPE = 5000;

/**
 * Counters in this instance's memory. Bounded: each scope tracks at most `maxKeys` keys (least recently used are
 * forgotten first), so a flood of distinct keys cannot exhaust memory.
 */
export function createInMemoryRateLimitStore(options: {
  readonly now: () => number;
  readonly maxKeys?: number;
}): RateLimitStore {
  const limiters = new Map<string, RateLimiter>();
  function limiterFor(scope: string, rule: LimitRule): RateLimiter {
    const id = `${scope}|${rule.limit}|${rule.windowMs}`;
    let limiter = limiters.get(id);
    if (limiter === undefined) {
      limiter = createRateLimiter({
        limit: rule.limit,
        windowMs: rule.windowMs,
        now: options.now,
        maxKeys: options.maxKeys ?? DEFAULT_MAX_KEYS_PER_SCOPE,
      });
      limiters.set(id, limiter);
    }
    return limiter;
  }
  return {
    kind: 'instance',
    peek: (scope, key, rule) =>
      Promise.resolve(limiterFor(scope, rule).peek(key)),
    hit: (scope, key, rule) =>
      Promise.resolve(limiterFor(scope, rule).check(key)),
    // Synchronous on purpose: no await between the reads and the writes, so this is atomic in a single-threaded runtime.
    reserve(steps) {
      for (const [index, step] of steps.entries()) {
        const seen = limiterFor(step.scope, step.rule).peek(step.key);
        if (!seen.allowed) {
          return {
            allowed: false,
            index,
            retryAfterSeconds: seen.retryAfterSeconds,
          };
        }
      }
      for (const [index, step] of steps.entries()) {
        const recorded = limiterFor(step.scope, step.rule).check(step.key);
        // Cannot happen after the reads above in one tick; refuse rather than assume.
        if (!recorded.allowed) {
          return {
            allowed: false,
            index,
            retryAfterSeconds: recorded.retryAfterSeconds,
          };
        }
      }
      return {allowed: true};
    },
  };
}

// --- Key hashing ---

export type KeyHasher = (scope: string, value: string) => Promise<string>;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
}

/**
 * HMAC-SHA-256 under a random key made on first use (never at module load: some runtimes forbid random values
 * in the global scope). Returns the first 16 bytes as hex. Web Crypto only, so it runs on Oxygen and Node.
 * A failed key import is not remembered: the next call imports again, and a failing call is retried once, so one
 * transient failure does not switch the lookup off until a restart (security review I-2). If it still fails, the
 * gate fails closed.
 */
export function createKeyHasher(): KeyHasher {
  let keyPromise: Promise<CryptoKey> | null = null;
  const getKey = (): Promise<CryptoKey> => {
    keyPromise ??= crypto.subtle
      .importKey(
        'raw',
        crypto.getRandomValues(new Uint8Array(32)),
        {name: 'HMAC', hash: 'SHA-256'},
        false,
        ['sign'],
      )
      .catch((error: unknown) => {
        keyPromise = null;
        throw error;
      });
    return keyPromise;
  };
  const sign = async (scope: string, value: string): Promise<string> => {
    const signature = await crypto.subtle.sign(
      'HMAC',
      await getKey(),
      // The separator cannot occur in a scope name, so two different (scope, value) pairs never share input.
      new TextEncoder().encode(`${scope}\u0000${value}`),
    );
    return toHex(new Uint8Array(signature).slice(0, 16));
  };
  return async (scope, value) => {
    try {
      return await sign(scope, value);
    } catch {
      return sign(scope, value);
    }
  };
}

// --- The gate ---

/**
 * ASSUMPTION (pending Q-009 and the security review): starting numbers. A shopper who mistypes the order number
 * twice from one device still gets a third try; guessing is stopped long before it can matter.
 */
export type GuestLookupGateLimits = {
  readonly perAddress: LimitRule;
  readonly perOrderAddress: LimitRule;
  readonly perOrder: LimitRule;
  readonly perEmail: LimitRule;
  readonly overall: LimitRule;
};

export const GUEST_LOOKUP_GATE_LIMITS: GuestLookupGateLimits = {
  perAddress: GUEST_LOOKUP_LIMITS.perAddress,
  perOrderAddress: {
    limit: 3,
    windowMs: GUEST_LOOKUP_LIMITS.perAddress.windowMs,
  },
  perOrder: {limit: 10, windowMs: GUEST_LOOKUP_LIMITS.perAddress.windowMs},
  perEmail: GUEST_LOOKUP_LIMITS.perEmail,
  overall: GUEST_LOOKUP_LIMITS.overall,
};

export type LimitedBy =
  'address' | 'order_address' | 'order' | 'email' | 'overall';

export type GuestLookupGateResult =
  | {readonly allowed: true}
  | {
      readonly allowed: false;
      readonly reason: 'rate_limited';
      readonly retryAfterSeconds: number;
      /** For logs only; never shown to the shopper. */
      readonly limitedBy: LimitedBy;
    }
  | {
      /** The store did not answer sensibly: the lookup is refused rather than run unchecked. */
      readonly allowed: false;
      readonly reason: 'limiter_failed';
    };

export type GuestLookupGate = {
  /**
   * `address` is the caller's address as resolved by the handler (never logged). `orderNumber` and `email` are
   * the raw form values, normalised here. Every counter is read before any is recorded (see the file header), so
   * an attempt refused by one counter counts against none.
   */
  check(input: {
    readonly address: string;
    readonly orderNumber: unknown;
    readonly email: unknown;
  }): Promise<GuestLookupGateResult>;
};

type Step = {
  readonly limitedBy: LimitedBy;
  readonly scope: string;
  readonly value: string;
  readonly rule: LimitRule;
};

function isRateLimitResult(value: unknown): value is RateLimitResult {
  if (typeof value !== 'object' || value === null) return false;
  const allowed: unknown = Reflect.get(value, 'allowed');
  if (allowed === true) return true;
  const retry: unknown = Reflect.get(value, 'retryAfterSeconds');
  return allowed === false && typeof retry === 'number' && retry >= 0;
}

export function createGuestLookupGate(options: {
  readonly store: RateLimitStore;
  readonly hash: KeyHasher;
  readonly limits?: GuestLookupGateLimits;
}): GuestLookupGate {
  const limits = options.limits ?? GUEST_LOOKUP_GATE_LIMITS;

  /** Overall first: it needs no per-request value and is the cheapest to refuse with. */
  function stepsFor(input: {
    readonly address: string;
    readonly orderNumber: unknown;
    readonly email: unknown;
  }): Step[] {
    const order = normalizeOrderNumber(input.orderNumber);
    const email = normalizeEmail(input.email);
    const steps: Step[] = [
      {
        limitedBy: 'overall',
        scope: 'overall',
        value: 'all',
        rule: limits.overall,
      },
      {
        limitedBy: 'address',
        scope: 'address',
        value: input.address,
        rule: limits.perAddress,
      },
    ];
    // A malformed value cannot name an order or a person, so it only counts against the address.
    if (order.status === 'ok') {
      steps.push(
        {
          limitedBy: 'order_address',
          scope: 'order-address',
          value: `${order.number}\u0000${input.address}`,
          rule: limits.perOrderAddress,
        },
        {
          limitedBy: 'order',
          scope: 'order',
          value: order.number,
          rule: limits.perOrder,
        },
      );
    }
    if (email.status === 'ok') {
      steps.push({
        limitedBy: 'email',
        scope: 'email',
        value: email.email,
        rule: limits.perEmail,
      });
    }
    return steps;
  }

  type Pass = 'peek' | 'hit';

  /** Runs one pass over the keyed steps; the first refusal (or unusable answer) ends it. */
  async function run(
    pass: Pass,
    keyed: readonly (Step & {key: string})[],
  ): Promise<GuestLookupGateResult> {
    for (const step of keyed) {
      const result: unknown = await options.store[pass](
        step.scope,
        step.key,
        step.rule,
      );
      if (!isRateLimitResult(result)) {
        return {allowed: false, reason: 'limiter_failed'};
      }
      if (!result.allowed) {
        return {
          allowed: false,
          reason: 'rate_limited',
          retryAfterSeconds: result.retryAfterSeconds,
          limitedBy: step.limitedBy,
        };
      }
    }
    return {allowed: true};
  }

  return {
    async check(input) {
      try {
        const keyed: (Step & {key: string})[] = [];
        for (const step of stepsFor(input)) {
          keyed.push({
            ...step,
            key: await options.hash(step.scope, step.value),
          });
        }
        // Every hash is computed above, so from here to the record there is no await when the store can reserve.
        if (options.store.reserve !== undefined) {
          const reserved: unknown = options.store.reserve(keyed);
          if (typeof reserved !== 'object' || reserved === null) {
            return {allowed: false, reason: 'limiter_failed'};
          }
          if (Reflect.get(reserved, 'allowed') === true) {
            return {allowed: true};
          }
          const index: unknown = Reflect.get(reserved, 'index');
          const retry: unknown = Reflect.get(reserved, 'retryAfterSeconds');
          const refusing = typeof index === 'number' ? keyed[index] : undefined;
          return Reflect.get(reserved, 'allowed') === false &&
            refusing !== undefined &&
            typeof retry === 'number' &&
            retry >= 0
            ? {
                allowed: false,
                reason: 'rate_limited',
                retryAfterSeconds: retry,
                limitedBy: refusing.limitedBy,
              }
            : {allowed: false, reason: 'limiter_failed'};
        }
        const peeked = await run('peek', keyed);
        if (!peeked.allowed) return peeked;
        return await run('hit', keyed);
      } catch {
        return {allowed: false, reason: 'limiter_failed'};
      }
    },
  };
}
