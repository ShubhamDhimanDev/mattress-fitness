// SERVER ONLY. Rate limiting for guest order tracking (REQ-ACC-003, P6-08, threat T-09, risk R-27).
//
// Two layers, so the shared limiter of P6-14 can replace the first without touching the second:
//   - `RateLimitStore`: where attempts are counted. Async on purpose (a shared store such as a Cache API entry,
//     KV or an edge service is asynchronous). This file ships ONE implementation, `createInMemoryRateLimitStore`,
//     which lives in the memory of one runtime instance.
//   - `createGuestLookupGate`: WHICH counters a lookup must pass (address, order number + address, email,
//     everything), in a fixed order, failing closed.
//
// The in-memory store is per instance. On Oxygen each isolate has its own memory and isolates come and go, and a
// Node deployment with several processes has one counter per process. It slows casual guessing; it is NOT a hard
// limit. Until P6-14 swaps in a shared store, the real limits are the ones that do not depend on this store: the
// generic failure message, the 60-day window and a matching email being needed as well as the order number.
//
// Keys. A counter key never holds a raw order number, email or address: the gate keyed-hashes each one first
// (HMAC-SHA-256, random per-instance key), because a shared store's key can appear in logs, dashboards and cache
// keys, and personal data must not (security rules, T-05). The per-instance random key means hashes cannot be
// compared between instances; a shared store needs one shared secret, which is a P6-14 decision.

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
   * Records one attempt for `key` under `scope` and says whether it is allowed. `key` is already hashed.
   * A store that cannot answer must reject (or throw): the gate treats that as "block".
   */
  hit(scope: string, key: string, rule: LimitRule): Promise<RateLimitResult>;
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
  return {
    kind: 'instance',
    hit(scope, key, rule) {
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
      return Promise.resolve(limiter.check(key));
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
 */
export function createKeyHasher(): KeyHasher {
  let keyPromise: Promise<CryptoKey> | null = null;
  const getKey = (): Promise<CryptoKey> => {
    keyPromise ??= crypto.subtle.importKey(
      'raw',
      crypto.getRandomValues(new Uint8Array(32)),
      {name: 'HMAC', hash: 'SHA-256'},
      false,
      ['sign'],
    );
    return keyPromise;
  };
  return async (scope, value) => {
    const signature = await crypto.subtle.sign(
      'HMAC',
      await getKey(),
      // The separator cannot occur in a scope name, so two different (scope, value) pairs never share input.
      new TextEncoder().encode(`${scope}\u0000${value}`),
    );
    return toHex(new Uint8Array(signature).slice(0, 16));
  };
}

// --- The gate ---

/**
 * ASSUMPTION (pending Q-009 and the security-engineer's review): starting numbers. A shopper who mistypes the
 * order number twice from one device still gets a third try; guessing is stopped long before it can matter.
 */
export type GuestLookupGateLimits = {
  readonly perAddress: LimitRule;
  readonly perOrderAddress: LimitRule;
  readonly perEmail: LimitRule;
  readonly overall: LimitRule;
};

export const GUEST_LOOKUP_GATE_LIMITS: GuestLookupGateLimits = {
  perAddress: GUEST_LOOKUP_LIMITS.perAddress,
  perOrderAddress: {
    limit: 3,
    windowMs: GUEST_LOOKUP_LIMITS.perAddress.windowMs,
  },
  perEmail: GUEST_LOOKUP_LIMITS.perEmail,
  overall: GUEST_LOOKUP_LIMITS.overall,
};

export type GuestLookupGateResult =
  | {readonly allowed: true}
  | {
      readonly allowed: false;
      readonly reason: 'rate_limited';
      readonly retryAfterSeconds: number;
      /** For logs only; never shown to the shopper. */
      readonly limitedBy: 'address' | 'order_address' | 'email' | 'overall';
    }
  | {
      /** The store did not answer sensibly: the lookup is refused rather than run unchecked. */
      readonly allowed: false;
      readonly reason: 'limiter_failed';
    };

export type GuestLookupGate = {
  /**
   * `address` is the caller's address as resolved by the handler (never logged). `orderNumber` and `email` are
   * the raw form values, normalised here. Counters are checked in order, and an attempt refused by an earlier
   * counter is not recorded on a later one, so one blocked attacker cannot use up a victim's email allowance.
   */
  check(input: {
    readonly address: string;
    readonly orderNumber: unknown;
    readonly email: unknown;
  }): Promise<GuestLookupGateResult>;
};

type Step = {
  readonly limitedBy: 'address' | 'order_address' | 'email' | 'overall';
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

  function stepsFor(input: {
    readonly address: string;
    readonly orderNumber: unknown;
    readonly email: unknown;
  }): Step[] {
    const order = normalizeOrderNumber(input.orderNumber);
    const email = normalizeEmail(input.email);
    const steps: Step[] = [
      {
        limitedBy: 'address',
        scope: 'address',
        value: input.address,
        rule: limits.perAddress,
      },
    ];
    // A malformed value cannot name an order or a person, so it only counts against the address.
    if (order.status === 'ok') {
      steps.push({
        limitedBy: 'order_address',
        scope: 'order-address',
        value: `${order.number}\u0000${input.address}`,
        rule: limits.perOrderAddress,
      });
    }
    if (email.status === 'ok') {
      steps.push({
        limitedBy: 'email',
        scope: 'email',
        value: email.email,
        rule: limits.perEmail,
      });
    }
    steps.push({
      limitedBy: 'overall',
      scope: 'overall',
      value: 'all',
      rule: limits.overall,
    });
    return steps;
  }

  return {
    async check(input) {
      try {
        for (const step of stepsFor(input)) {
          const key = await options.hash(step.scope, step.value);
          const result: unknown = await options.store.hit(
            step.scope,
            key,
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
      } catch {
        return {allowed: false, reason: 'limiter_failed'};
      }
    },
  };
}
