import {describe, expect, it} from 'vitest';
import {
  createInMemoryRateLimitStore,
  type KeyHasher,
  type RateLimitStore,
} from '~/lib/orders/guest-lookup-limiter';
import {
  createSignupGate,
  SIGNUP_GATE_LIMITS,
  type SignupGateLimits,
} from '~/lib/signup/limiter';

// REQ-ANL-003 / T-13 / T-16, security review SU-M2 (ceiling and daily caps) and SU-M3 (per-phone counter): the new
// counters of the signup gate, including 50 parallel posts against the atomic reserve. All identities are fictional.

const HOUR = 3_600_000;
const DAY = 86_400_000;

/** Every counter wide open; a test narrows only the one it is about. */
const OPEN: SignupGateLimits = {
  perAddress: {limit: 1000, windowMs: HOUR},
  perAddressDaily: {limit: 1000, windowMs: DAY},
  sharedAddress: {limit: 1000, windowMs: HOUR},
  sharedAddressDaily: {limit: 1000, windowMs: DAY},
  perEmail: {limit: 1000, windowMs: HOUR},
  perEmailDaily: {limit: 1000, windowMs: DAY},
  perPhoneDaily: {limit: 1000, windowMs: DAY},
  overall: {limit: 1000, windowMs: DAY},
};

const plainHash: KeyHasher = (scope, value) =>
  Promise.resolve(`${scope}#${value}`);

function setup(narrow: Partial<SignupGateLimits>) {
  const clock = {now: 0};
  const store = createInMemoryRateLimitStore({now: () => clock.now});
  const gate = createSignupGate({
    store,
    hash: plainHash,
    limits: {...OPEN, ...narrow},
  });
  return {clock, gate};
}

const from = (address: string, email: string | null, addressKnown = true) => ({
  address,
  addressKnown,
  email,
});

describe('documented defaults (SU-M2, SU-M3)', () => {
  it('ships the lowered ceiling, the daily caps and the per-phone cap', () => {
    expect(SIGNUP_GATE_LIMITS).toEqual({
      perAddress: {limit: 6, windowMs: 900_000},
      perAddressDaily: {limit: 20, windowMs: DAY},
      sharedAddress: {limit: 60, windowMs: 900_000},
      sharedAddressDaily: {limit: 100, windowMs: DAY},
      perEmail: {limit: 3, windowMs: HOUR},
      perEmailDaily: {limit: 5, windowMs: DAY},
      perPhoneDaily: {limit: 2, windowMs: DAY},
      overall: {limit: 60, windowMs: 900_000},
    });
  });
});

describe('daily caps (SU-M2)', () => {
  it('caps a mailbox at 5 a day even though the hourly allowance of 3 renews', async () => {
    const {gate, clock} = setup({
      perEmail: SIGNUP_GATE_LIMITS.perEmail,
      perEmailDaily: SIGNUP_GATE_LIMITS.perEmailDaily,
    });
    const results: boolean[] = [];
    for (let i = 0; i < 7; i += 1) {
      const result = await gate.check(
        from(`198.51.100.${i}`, 'daily@example.com'),
      );
      results.push(result.allowed);
      // Let the hourly window pass after the third and the fifth attempt.
      if (i === 2 || i === 4) clock.now += HOUR + 1000;
    }
    // Hour one: 3 allowed. Hour two: 2 more allowed (5 in the day), then the daily cap refuses.
    expect(results).toEqual([true, true, true, true, true, false, false]);
    expect(
      await gate.check(from('198.51.100.99', 'daily@example.com')),
    ).toMatchObject({allowed: false, limitedBy: 'email'});
    clock.now += DAY;
    expect(
      (await gate.check(from('198.51.100.98', 'daily@example.com'))).allowed,
    ).toBe(true);
  });

  it('caps one client address per day, and the shared bucket separately', async () => {
    const {gate, clock} = setup({
      perAddressDaily: {limit: 4, windowMs: DAY},
      sharedAddressDaily: {limit: 2, windowMs: DAY},
    });
    for (let i = 0; i < 4; i += 1) {
      expect(
        (await gate.check(from('198.51.100.1', `u${i}@example.com`))).allowed,
      ).toBe(true);
    }
    expect(
      await gate.check(from('198.51.100.1', 'u9@example.com')),
    ).toMatchObject({allowed: false, limitedBy: 'address'});
    expect(
      (await gate.check(from('198.51.100.2', 'u9@example.com'))).allowed,
    ).toBe(true);

    for (let i = 0; i < 2; i += 1) {
      expect(
        (await gate.check(from('unknown', `s${i}@example.com`, false))).allowed,
      ).toBe(true);
    }
    expect(
      await gate.check(from('unknown', 's9@example.com', false)),
    ).toMatchObject({allowed: false, limitedBy: 'address'});

    clock.now += DAY + 1;
    expect(
      (await gate.check(from('198.51.100.1', 'u0@example.com'))).allowed,
    ).toBe(true);
  });

  it('holds the whole form to 60 posts per 15 minutes', async () => {
    const {gate} = setup({overall: SIGNUP_GATE_LIMITS.overall});
    let allowed = 0;
    for (let i = 0; i < 70; i += 1) {
      const result = await gate.check(
        from(`198.51.${i}.1`, `user${i}@example.com`),
      );
      if (result.allowed) allowed += 1;
    }
    expect(allowed).toBe(60);
  });
});

describe('per-phone counter (SU-M3)', () => {
  const withPhone = (address: string, email: string, phone: string | null) => ({
    ...from(address, email),
    phone,
  });

  it('counts a number per day whatever the address or email, and not when none is given', async () => {
    const {gate} = setup({perPhoneDaily: {limit: 2, windowMs: DAY}});
    expect(
      (
        await gate.check(
          withPhone('198.51.100.1', 'a@example.com', '+12125550100'),
        )
      ).allowed,
    ).toBe(true);
    expect(
      (
        await gate.check(
          withPhone('198.51.100.2', 'b@example.com', '+12125550100'),
        )
      ).allowed,
    ).toBe(true);
    expect(
      await gate.check(
        withPhone('198.51.100.3', 'c@example.com', '+12125550100'),
      ),
    ).toMatchObject({
      allowed: false,
      reason: 'rate_limited',
      limitedBy: 'phone',
    });
    // Another number, a request with no number, and one that omits the field are unaffected.
    expect(
      (
        await gate.check(
          withPhone('198.51.100.4', 'd@example.com', '+12125550101'),
        )
      ).allowed,
    ).toBe(true);
    expect(
      (await gate.check(withPhone('198.51.100.5', 'e@example.com', null)))
        .allowed,
    ).toBe(true);
    expect(
      (await gate.check(from('198.51.100.6', 'f@example.com'))).allowed,
    ).toBe(true);
  });

  it('a refusal by the phone counter records nothing for the address or the mailbox', async () => {
    const tight = setup({
      perPhoneDaily: {limit: 1, windowMs: DAY},
      perAddress: {limit: 2, windowMs: HOUR},
      perEmail: {limit: 2, windowMs: HOUR},
    });
    await tight.gate.check(
      withPhone('198.51.100.1', 'a@example.com', '+12125550100'),
    );
    for (let i = 0; i < 5; i += 1) {
      await tight.gate.check(
        withPhone('198.51.100.9', 'victim@example.com', '+12125550100'),
      );
    }
    // Neither 198.51.100.9 nor victim@ was burned by the five refused attempts.
    expect(
      (await tight.gate.check(from('198.51.100.9', 'x@example.com'))).allowed,
    ).toBe(true);
    expect(
      (await tight.gate.check(from('198.51.100.8', 'victim@example.com')))
        .allowed,
    ).toBe(true);
  });

  it('never hands a raw phone number to the store', async () => {
    const seen: string[] = [];
    const base = createInMemoryRateLimitStore({now: () => 0});
    const spying: RateLimitStore = {
      ...base,
      reserve(steps) {
        for (const step of steps) seen.push(step.key);
        return base.reserve ? base.reserve(steps) : {allowed: true};
      },
    };
    const gate = createSignupGate({
      store: spying,
      hash: (scope, value) =>
        Promise.resolve(`h(${scope.length}:${value.length})`),
    });
    await gate.check(
      withPhone('198.51.100.1', 'a@example.com', '+12125550100'),
    );
    expect(seen.length).toBeGreaterThan(5);
    expect(seen.join(' ')).not.toContain('2125550100');
  });
});

describe('50 parallel posts against the atomic reserve (SU-M2)', () => {
  it('cannot pass the overall ceiling before it is recorded', async () => {
    const {gate} = setup({overall: {limit: 8, windowMs: HOUR}});
    const results = await Promise.all(
      Array.from({length: 50}, (_, i) =>
        gate.check(from(`198.51.${i}.1`, `user${i}@example.com`)),
      ),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(8);
    expect(
      results.filter((r) => !r.allowed && r.reason === 'limiter_failed'),
    ).toHaveLength(0);
  });

  it('are held to the hourly mailbox cap for one mailbox', async () => {
    const {gate} = setup({perEmail: SIGNUP_GATE_LIMITS.perEmail});
    const results = await Promise.all(
      Array.from({length: 50}, (_, i) =>
        gate.check(from(`198.51.${i}.1`, 'same+tag@example.com')),
      ),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(3);
  });

  it('are held to the daily phone cap for one number', async () => {
    const {gate} = setup({perPhoneDaily: SIGNUP_GATE_LIMITS.perPhoneDaily});
    const results = await Promise.all(
      Array.from({length: 50}, (_, i) =>
        gate.check({
          ...from(`198.51.${i}.1`, `p${i}@example.com`),
          phone: '+12125550100',
        }),
      ),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(2);
  });

  it('are held to the daily address cap for one client address', async () => {
    const {gate} = setup({perAddressDaily: SIGNUP_GATE_LIMITS.perAddressDaily});
    const results = await Promise.all(
      Array.from({length: 50}, (_, i) =>
        gate.check(from('198.51.100.7', `a${i}@example.com`)),
      ),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(20);
  });
});
