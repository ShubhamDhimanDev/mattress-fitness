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

// REQ-ANL-003 / T-13 / R-27: the signup gate. With double opt-in each accepted request makes Klaviyo email the typed
// address, so the per-mailbox counter is the email-bombing guard. All identities are fictional.

const LIMITS: SignupGateLimits = {
  perAddress: {limit: 3, windowMs: 60_000},
  perAddressDaily: {limit: 1000, windowMs: 86_400_000},
  sharedAddressDaily: {limit: 1000, windowMs: 86_400_000},
  perEmailDaily: {limit: 1000, windowMs: 86_400_000},
  perPhoneDaily: {limit: 1000, windowMs: 86_400_000},
  sharedAddress: {limit: 6, windowMs: 60_000},
  perEmail: {limit: 2, windowMs: 60_000},
  overall: {limit: 8, windowMs: 60_000},
};

/** A readable "hash" so the tests can see what reached the store. */
const plainHash: KeyHasher = (scope, value) =>
  Promise.resolve(`${scope}#${value}`);

function setup(limits = LIMITS, store?: RateLimitStore) {
  const clock = {now: 0};
  const realStore =
    store ?? createInMemoryRateLimitStore({now: () => clock.now});
  const gate = createSignupGate({store: realStore, hash: plainHash, limits});
  return {clock, gate, store: realStore};
}

const from = (address: string, email: string | null, addressKnown = true) => ({
  address,
  addressKnown,
  email,
});

describe('signup gate counters (REQ-ANL-003, T-13)', () => {
  it('ships documented defaults, marked as assumptions in the source', () => {
    expect(SIGNUP_GATE_LIMITS.perAddress).toEqual({
      limit: 6,
      windowMs: 900_000,
    });
    expect(SIGNUP_GATE_LIMITS.sharedAddress).toEqual({
      limit: 60,
      windowMs: 900_000,
    });
    expect(SIGNUP_GATE_LIMITS.perEmail).toEqual({
      limit: 3,
      windowMs: 3_600_000,
    });
    expect(SIGNUP_GATE_LIMITS.overall).toEqual({limit: 60, windowMs: 900_000});
    // The full table (daily caps, per-phone cap) is pinned in limiter-caps.test.ts.
  });

  it('limits one address: the next attempt is refused with a wait time, another address is not', async () => {
    const {gate} = setup();
    for (let i = 0; i < 3; i += 1) {
      expect(
        await gate.check(from('198.51.100.1', `user${i}@example.com`)),
      ).toEqual({allowed: true});
    }
    const refused = await gate.check(from('198.51.100.1', 'user9@example.com'));
    expect(refused).toMatchObject({
      allowed: false,
      reason: 'rate_limited',
      limitedBy: 'address',
    });
    expect(refused.allowed === false && 'retryAfterSeconds' in refused).toBe(
      true,
    );
    expect(await gate.check(from('198.51.100.2', 'user9@example.com'))).toEqual(
      {allowed: true},
    );
  });

  it('limits one mailbox from many addresses, and "+tag" variants count as the same mailbox', async () => {
    const {gate} = setup();
    expect(
      (await gate.check(from('198.51.100.1', 'victim+a@example.com'))).allowed,
    ).toBe(true);
    expect(
      (await gate.check(from('198.51.100.2', 'victim+b@example.com'))).allowed,
    ).toBe(true);
    const refused = await gate.check(
      from('198.51.100.3', 'victim+c@example.com'),
    );
    expect(refused).toMatchObject({
      allowed: false,
      reason: 'rate_limited',
      limitedBy: 'email',
    });
  });

  it('counts Gmail dot variants as one mailbox', async () => {
    const {gate} = setup();
    await gate.check(from('198.51.100.1', 'v.ictim@gmail.com'));
    await gate.check(from('198.51.100.2', 'vi.ctim@gmail.com'));
    expect(
      await gate.check(from('198.51.100.3', 'vic.tim@googlemail.com')),
    ).toMatchObject({allowed: false, limitedBy: 'email'});
  });

  it('an attempt without a valid address counts against the address and the ceiling only', async () => {
    const {gate} = setup();
    for (let i = 0; i < 3; i += 1) {
      await gate.check(from('198.51.100.1', null));
    }
    expect(await gate.check(from('198.51.100.1', null))).toMatchObject({
      allowed: false,
      limitedBy: 'address',
    });
    // A mailbox is not burned by someone else's malformed attempts.
    expect(
      await gate.check(from('198.51.100.9', 'someone@example.com')),
    ).toEqual({allowed: true});
  });

  it('puts a ceiling on everything, whoever asks', async () => {
    const {gate} = setup({
      ...LIMITS,
      perAddress: {limit: 100, windowMs: 60_000},
      perEmail: {limit: 100, windowMs: 60_000},
    });
    for (let i = 0; i < 8; i += 1) {
      expect(
        (await gate.check(from(`198.51.100.${i}`, `u${i}@example.com`)))
          .allowed,
      ).toBe(true);
    }
    expect(
      await gate.check(from('203.0.113.7', 'late@example.com')),
    ).toMatchObject({allowed: false, limitedBy: 'overall'});
  });

  it('lets the window pass: the counters empty again', async () => {
    const {gate, clock} = setup();
    for (let i = 0; i < 3; i += 1) {
      await gate.check(from('198.51.100.1', `user${i}@example.com`));
    }
    expect(
      (await gate.check(from('198.51.100.1', 'a@example.com'))).allowed,
    ).toBe(false);
    clock.now += 61_000;
    expect(
      (await gate.check(from('198.51.100.1', 'a@example.com'))).allowed,
    ).toBe(true);
  });

  it('records nothing for a refused attempt (a flood cannot burn a victim mailbox)', async () => {
    const {gate} = setup({
      ...LIMITS,
      perAddress: {limit: 1, windowMs: 60_000},
    });
    expect(
      (await gate.check(from('198.51.100.1', 'first@example.com'))).allowed,
    ).toBe(true);
    // Refused by the address counter, so victim@ is not counted ...
    for (let i = 0; i < 5; i += 1) {
      expect(
        (await gate.check(from('198.51.100.1', 'victim@example.com'))).allowed,
      ).toBe(false);
    }
    // ... and the real owner of victim@ can still sign up from elsewhere.
    expect(
      (await gate.check(from('198.51.100.2', 'victim@example.com'))).allowed,
    ).toBe(true);
  });

  it('parallel requests cannot all pass before any is recorded (atomic reserve)', async () => {
    const {gate} = setup();
    const results = await Promise.all(
      Array.from({length: 10}, (_, i) =>
        gate.check(from('198.51.100.1', `user${i}@example.com`)),
      ),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(3);
  });

  it('with no trusted address header, callers share the roomier shared rule, not the strict per-address one', async () => {
    const {gate} = setup();
    for (let i = 0; i < 6; i += 1) {
      expect(
        (await gate.check(from('unknown', `user${i}@example.com`, false)))
          .allowed,
      ).toBe(true);
    }
    expect(
      await gate.check(from('unknown', 'user9@example.com', false)),
    ).toMatchObject({allowed: false, limitedBy: 'address'});
  });
});

describe('signup gate: keys, failure and stores that cannot reserve', () => {
  it('never hands a raw address or email to the store: keys come from the hasher', async () => {
    const seen: string[] = [];
    const store = createInMemoryRateLimitStore({now: () => 0});
    const spying: RateLimitStore = {
      ...store,
      reserve(steps) {
        for (const step of steps) seen.push(step.scope, step.key);
        return store.reserve ? store.reserve(steps) : {allowed: true};
      },
    };
    const gate = createSignupGate({
      store: spying,
      hash: (scope, value) =>
        Promise.resolve(`h(${scope.length}:${value.length})`),
    });
    await gate.check(from('198.51.100.77', 'secret.person@example.com'));
    const joined = seen.join(' ');
    expect(joined).not.toContain('198.51.100.77');
    expect(joined).not.toContain('secret.person');
  });

  it('fails closed when the hasher throws', async () => {
    const gate = createSignupGate({
      store: createInMemoryRateLimitStore({now: () => 0}),
      hash: () => Promise.reject(new Error('no crypto')),
    });
    expect(await gate.check(from('198.51.100.1', 'a@example.com'))).toEqual({
      allowed: false,
      reason: 'limiter_failed',
    });
  });

  it('fails closed when the store throws or answers nonsense', async () => {
    const base = createInMemoryRateLimitStore({now: () => 0});
    const throwing: RateLimitStore = {
      kind: base.kind,
      peek: base.peek,
      hit: base.hit,
      reserve() {
        throw new Error('store down');
      },
    };
    const nonsense: RateLimitStore = {
      kind: base.kind,
      peek: base.peek,
      hit: base.hit,
      reserve: () => 'yes' as never,
    };
    for (const store of [throwing, nonsense]) {
      const {gate} = setup(LIMITS, store);
      expect(await gate.check(from('198.51.100.1', 'a@example.com'))).toEqual({
        allowed: false,
        reason: 'limiter_failed',
      });
    }
  });

  it('falls back to read-then-record for a shared store without reserve, and fails closed on a bad answer', async () => {
    const inner = createInMemoryRateLimitStore({now: () => 0});
    const shared: RateLimitStore = {
      kind: 'shared',
      peek: inner.peek,
      hit: inner.hit,
    };
    const {gate} = setup(LIMITS, shared);
    for (let i = 0; i < 3; i += 1) {
      expect(
        (await gate.check(from('198.51.100.1', `u${i}@example.com`))).allowed,
      ).toBe(true);
    }
    expect(
      await gate.check(from('198.51.100.1', 'u9@example.com')),
    ).toMatchObject({
      allowed: false,
      limitedBy: 'address',
    });

    const broken: RateLimitStore = {
      kind: 'shared',
      peek: () => Promise.resolve({} as never),
      hit: inner.hit,
    };
    const {gate: brokenGate} = setup(LIMITS, broken);
    expect(
      await brokenGate.check(from('198.51.100.1', 'a@example.com')),
    ).toEqual({
      allowed: false,
      reason: 'limiter_failed',
    });
  });
});
