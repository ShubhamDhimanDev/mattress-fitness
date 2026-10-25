// SERVER ONLY. Rate limiting for the signup form (REQ-ANL-003, T-13, risk R-27; security review SU-M2, SU-M3).
//
// Why it matters more than for most forms: with double opt-in, every accepted request makes Klaviyo send a confirmation
// email to the address that was typed. An open form is therefore a way to send mail to someone else's inbox, and (with
// SMS on) a way to enrol someone else's phone. The counters below stop one client, one mailbox and one number from
// being used that way, and put a small ceiling on the whole form.
//
// It reuses the order-tracking limiter's pieces (the replaceable RateLimitStore, the keyed hasher, the atomic
// reserve) so the shared limiter of P6-14 replaces both at once. Counters, all checked in ONE atomic reserve:
//   overall        everything: a small ceiling and a kill switch; alert on it.
//   address        per client address (IPv6 as its /64), a short window and a daily cap. When the deployment names no
//                  trusted address header every caller would share ONE address, so that case uses the roomier
//                  sharedAddress rules instead of locking the form for everybody after a handful of signups.
//   email          per mailbox, an hourly and a daily cap. The key collapses +tag, Gmail dots and Yahoo-style -word
//                  extensions (email.ts). Counted only for a valid address.
//   phone          per E.164 number, a daily cap. Counted only when a text-message enrolment would really be sent.
// Keys are keyed hashes (never a raw address, email or number), and an attempt refused by one counter is recorded by none.
//
// The in-memory store is per instance: it slows abuse, it is not a hard limit (same caveat as GUEST_TRACKING.md): do
// not run signup on more than one process before P6-14. The limits are ASSUMPTIONS with no evidence behind them yet;
// they are named constants so they can be tuned in one place.

import type {
  KeyHasher,
  LimitRule,
  RateLimitStore,
  ReserveStep,
} from '~/lib/orders/guest-lookup-limiter';
import {limiterEmailKey} from '~/lib/signup/email';

export type SignupGateLimits = {
  readonly perAddress: LimitRule;
  readonly perAddressDaily: LimitRule;
  readonly sharedAddress: LimitRule;
  readonly sharedAddressDaily: LimitRule;
  readonly perEmail: LimitRule;
  readonly perEmailDaily: LimitRule;
  readonly perPhoneDaily: LimitRule;
  readonly overall: LimitRule;
};

const FIFTEEN_MINUTES = 15 * 60_000;
const ONE_HOUR = 60 * 60_000;
const ONE_DAY = 24 * ONE_HOUR;

/**
 * ASSUMPTIONS. A person signs up once: six tries from a home connection in 15 minutes covers typing mistakes, and 20 a
 * day is a household. 60 overall per 15 minutes (4 a minute) is generous for a small store and, at 5760 a day at most,
 * a bound on the confirmation mail the brand can be made to send (security review SU-M2).
 */
export const SIGNUP_GATE_LIMITS: SignupGateLimits = {
  perAddress: {limit: 6, windowMs: FIFTEEN_MINUTES},
  perAddressDaily: {limit: 20, windowMs: ONE_DAY},
  sharedAddress: {limit: 60, windowMs: FIFTEEN_MINUTES},
  sharedAddressDaily: {limit: 100, windowMs: ONE_DAY},
  perEmail: {limit: 3, windowMs: ONE_HOUR},
  perEmailDaily: {limit: 5, windowMs: ONE_DAY},
  perPhoneDaily: {limit: 2, windowMs: ONE_DAY},
  overall: {limit: 60, windowMs: FIFTEEN_MINUTES},
};

export type SignupLimitedBy = 'address' | 'email' | 'phone' | 'overall';

export type SignupGateResult =
  | {readonly allowed: true}
  | {
      readonly allowed: false;
      readonly reason: 'rate_limited';
      readonly retryAfterSeconds: number;
      /** For logs only; never shown to the shopper. */
      readonly limitedBy: SignupLimitedBy;
    }
  | {readonly allowed: false; readonly reason: 'limiter_failed'};

export type SignupGate = {
  check(input: {
    /** From resolveClientAddress. */
    readonly address: string;
    /** True when a trusted header gave the address; false means every caller shares the "unknown" bucket. */
    readonly addressKnown: boolean;
    /** A VALIDATED, lower-cased address, or null when the form had none. */
    readonly email: string | null;
    /** A VALIDATED E.164 number whose text-message enrolment would be sent, or null. */
    readonly phone?: string | null;
  }): Promise<SignupGateResult>;
};

type Step = {
  readonly limitedBy: SignupLimitedBy;
  readonly scope: string;
  readonly value: string;
  readonly rule: LimitRule;
};

function isAnswer(
  value: unknown,
): value is {allowed: boolean; retryAfterSeconds?: number} {
  if (typeof value !== 'object' || value === null) return false;
  const allowed: unknown = Reflect.get(value, 'allowed');
  if (allowed === true) return true;
  const retry: unknown = Reflect.get(value, 'retryAfterSeconds');
  return allowed === false && typeof retry === 'number' && retry >= 0;
}

export function createSignupGate(options: {
  readonly store: RateLimitStore;
  readonly hash: KeyHasher;
  readonly limits?: SignupGateLimits;
}): SignupGate {
  const limits = options.limits ?? SIGNUP_GATE_LIMITS;

  function stepsFor(input: {
    address: string;
    addressKnown: boolean;
    email: string | null;
    phone?: string | null;
  }): Step[] {
    const steps: Step[] = [
      {
        limitedBy: 'overall',
        scope: 'signup-overall',
        value: 'all',
        rule: limits.overall,
      },
    ];
    if (input.addressKnown) {
      steps.push(
        {
          limitedBy: 'address',
          scope: 'signup-address',
          value: input.address,
          rule: limits.perAddress,
        },
        {
          limitedBy: 'address',
          scope: 'signup-address-day',
          value: input.address,
          rule: limits.perAddressDaily,
        },
      );
    } else {
      steps.push(
        {
          limitedBy: 'address',
          scope: 'signup-shared',
          value: 'unknown',
          rule: limits.sharedAddress,
        },
        {
          limitedBy: 'address',
          scope: 'signup-shared-day',
          value: 'unknown',
          rule: limits.sharedAddressDaily,
        },
      );
    }
    if (input.email !== null) {
      const mailbox = limiterEmailKey(input.email);
      steps.push(
        {
          limitedBy: 'email',
          scope: 'signup-email',
          value: mailbox,
          rule: limits.perEmail,
        },
        {
          limitedBy: 'email',
          scope: 'signup-email-day',
          value: mailbox,
          rule: limits.perEmailDaily,
        },
      );
    }
    if (input.phone !== undefined && input.phone !== null) {
      steps.push({
        limitedBy: 'phone',
        scope: 'signup-phone-day',
        value: input.phone,
        rule: limits.perPhoneDaily,
      });
    }
    return steps;
  }

  /** Two passes for a store that cannot reserve atomically: read every counter, then record every counter. */
  async function twoPass(
    keyed: readonly (Step & ReserveStep)[],
  ): Promise<SignupGateResult> {
    for (const pass of ['peek', 'hit'] as const) {
      for (const step of keyed) {
        const answer: unknown = await options.store[pass](
          step.scope,
          step.key,
          step.rule,
        );
        if (!isAnswer(answer))
          return {allowed: false, reason: 'limiter_failed'};
        if (!answer.allowed) {
          return {
            allowed: false,
            reason: 'rate_limited',
            retryAfterSeconds: answer.retryAfterSeconds ?? 1,
            limitedBy: step.limitedBy,
          };
        }
      }
    }
    return {allowed: true};
  }

  return {
    async check(input) {
      try {
        const keyed: (Step & ReserveStep)[] = [];
        for (const step of stepsFor(input)) {
          keyed.push({
            ...step,
            key: await options.hash(step.scope, step.value),
          });
        }
        // No await between here and the record when the store can reserve, so parallel requests cannot all pass first.
        if (options.store.reserve === undefined) return await twoPass(keyed);
        const reserved: unknown = options.store.reserve(keyed);
        if (typeof reserved !== 'object' || reserved === null) {
          return {allowed: false, reason: 'limiter_failed'};
        }
        if (Reflect.get(reserved, 'allowed') === true) return {allowed: true};
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
      } catch {
        return {allowed: false, reason: 'limiter_failed'};
      }
    },
  };
}
