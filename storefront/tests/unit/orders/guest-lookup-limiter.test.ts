import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  GUEST_LOOKUP_GATE_LIMITS,
  createGuestLookupGate,
  createInMemoryRateLimitStore,
  createKeyHasher,
  type KeyHasher,
  type LimitRule,
  type RateLimitStore,
} from '~/lib/orders/guest-lookup-limiter';

// REQ-ACC-003 (rate limiting), T-09, R-27 / P6-08: the gate over a replaceable store. All identities are
// fictional; 198.51.100.x and 203.0.113.x are documentation address ranges.

const LIMITS = {
  perAddress: {limit: 4, windowMs: 60_000},
  perOrderAddress: {limit: 2, windowMs: 60_000},
  perOrder: {limit: 4, windowMs: 60_000},
  perEmail: {limit: 3, windowMs: 60_000},
  overall: {limit: 6, windowMs: 60_000},
};

/** A readable "hash" so the tests can see what reached the store. */
const plainHash: KeyHasher = (scope, value) =>
  Promise.resolve(`${scope}#${value}`);

function setup(limits = LIMITS) {
  const clock = {now: 0};
  const store = createInMemoryRateLimitStore({now: () => clock.now});
  const gate = createGuestLookupGate({store, hash: plainHash, limits});
  return {clock, store, gate};
}

const attempt = (
  address: string,
  orderNumber: unknown,
  email: unknown,
): {address: string; orderNumber: unknown; email: unknown} => ({
  address,
  orderNumber,
  email,
});

describe('guest lookup gate: the counters (REQ-ACC-003, T-09)', () => {
  it('ships the documented defaults', () => {
    expect(GUEST_LOOKUP_GATE_LIMITS.perAddress).toEqual({
      limit: 10,
      windowMs: 900_000,
    });
    expect(GUEST_LOOKUP_GATE_LIMITS.perOrderAddress).toEqual({
      limit: 3,
      windowMs: 900_000,
    });
    expect(GUEST_LOOKUP_GATE_LIMITS.perOrder).toEqual({
      limit: 10,
      windowMs: 900_000,
    });
    expect(GUEST_LOOKUP_GATE_LIMITS.perEmail.limit).toBe(5);
    expect(GUEST_LOOKUP_GATE_LIMITS.overall.limit).toBe(300);
  });

  it('stops the same order number from the same address after the order+address limit', async () => {
    const {gate} = setup();
    const a = attempt('198.51.100.1', '#1001', 'a@example.com');
    expect(await gate.check(a)).toEqual({allowed: true});
    expect(await gate.check({...a, email: 'b@example.com'})).toEqual({
      allowed: true,
    });
    expect(await gate.check({...a, email: 'c@example.com'})).toMatchObject({
      allowed: false,
      reason: 'rate_limited',
      limitedBy: 'order_address',
    });
  });

  it('counts the order number in any spelling as the same order', async () => {
    const {gate} = setup();
    const ip = '198.51.100.1';
    await gate.check(attempt(ip, '#1001', 'a@example.com'));
    await gate.check(attempt(ip, ' 1001 ', 'b@example.com'));
    expect(
      await gate.check(attempt(ip, 'ORDER-1001', 'c@example.com')),
    ).toMatchObject({allowed: false, limitedBy: 'order_address'});
  });

  it('lets the same order number through from another address', async () => {
    const {gate} = setup();
    for (let i = 0; i < 2; i += 1) {
      await gate.check(attempt('198.51.100.1', '1001', `p${i}@example.com`));
    }
    expect(
      await gate.check(attempt('198.51.100.2', '1001', 'q@example.com')),
    ).toEqual({allowed: true});
  });

  it('stops one address trying many order numbers (per-address limit)', async () => {
    const {gate} = setup();
    const ip = '203.0.113.9';
    for (let n = 1; n <= 4; n += 1) {
      expect(
        (await gate.check(attempt(ip, `${1000 + n}`, `p${n}@example.com`)))
          .allowed,
      ).toBe(true);
    }
    expect(
      await gate.check(attempt(ip, '2000', 'p5@example.com')),
    ).toMatchObject({allowed: false, limitedBy: 'address'});
  });

  it('stops one email tried from many addresses (distributed guessing)', async () => {
    const {gate} = setup();
    for (let n = 1; n <= 3; n += 1) {
      expect(
        (
          await gate.check(
            attempt(`198.51.100.${n}`, `${1000 + n}`, 'Victim@Example.com'),
          )
        ).allowed,
      ).toBe(true);
    }
    expect(
      await gate.check(attempt('198.51.100.9', '1009', ' victim@example.com ')),
    ).toMatchObject({allowed: false, limitedBy: 'email'});
  });

  it('applies an overall ceiling across everyone', async () => {
    const {gate} = setup();
    for (let n = 1; n <= 6; n += 1) {
      expect(
        (
          await gate.check(
            attempt(`addr-${n}`, `${1000 + n}`, `p${n}@example.com`),
          )
        ).allowed,
      ).toBe(true);
    }
    expect(
      await gate.check(attempt('addr-7', '1007', 'p7@example.com')),
    ).toMatchObject({allowed: false, limitedBy: 'overall'});
  });

  it('a blocked attacker cannot use up a victim email allowance or the overall ceiling', async () => {
    const {gate} = setup();
    for (let n = 1; n <= 4; n += 1) {
      await gate.check(attempt('attacker', `${1000 + n}`, `x${n}@example.com`));
    }
    for (let i = 0; i < 20; i += 1) {
      expect(
        await gate.check(attempt('attacker', '5000', 'victim@example.com')),
      ).toMatchObject({limitedBy: 'address'});
    }
    // Victim still has their whole email allowance and the overall ceiling is barely touched.
    for (let n = 1; n <= 2; n += 1) {
      expect(
        (
          await gate.check(
            attempt(`friend-${n}`, `${6000 + n}`, 'victim@example.com'),
          )
        ).allowed,
      ).toBe(true);
    }
  });

  it('counts malformed values against the address only', async () => {
    const {gate} = setup();
    for (let i = 0; i < 4; i += 1) {
      expect(
        (await gate.check(attempt('a', 'x y', 'not-an-email'))).allowed,
      ).toBe(true);
    }
    expect(await gate.check(attempt('a', 'x y', 'not-an-email'))).toMatchObject(
      {
        allowed: false,
        limitedBy: 'address',
      },
    );
    // The malformed email never counted against an email key.
    expect(
      (await gate.check(attempt('b', '1001', 'ok@example.com'))).allowed,
    ).toBe(true);
  });

  it('hostile values do not throw and are treated as malformed', async () => {
    const {gate} = setup();
    const result = await gate.check(
      attempt('a', {toString: () => '1001'}, ['x@example.com']),
    );
    expect(result).toEqual({allowed: true});
  });

  it('reports a retry time and allows again once the window has passed', async () => {
    const {clock, gate} = setup();
    for (let n = 1; n <= 4; n += 1) {
      await gate.check(attempt('a', `${1000 + n}`, `p${n}@example.com`));
    }
    const blocked = await gate.check(attempt('a', '1009', 'p9@example.com'));
    expect(blocked).toMatchObject({
      allowed: false,
      retryAfterSeconds: 60,
      limitedBy: 'address',
    });
    clock.now = 60_001;
    expect(
      (await gate.check(attempt('a', '1010', 'p10@example.com'))).allowed,
    ).toBe(true);
  });
});

describe('guest lookup gate: read every counter before recording any (L-1, T-13)', () => {
  const TWO = {
    ...LIMITS,
    overall: {limit: 2, windowMs: 60_000},
    perEmail: {limit: 2, windowMs: 60_000},
  };

  it('a flood past the overall ceiling does not burn a victim email allowance or fill the stores', async () => {
    const {store, gate} = setup(TWO);
    expect(
      (await gate.check(attempt('a1', '1001', 'v@example.com'))).allowed,
    ).toBe(true);
    expect(
      (await gate.check(attempt('a2', '1002', 'w@example.com'))).allowed,
    ).toBe(true);
    for (let i = 0; i < 50; i += 1) {
      expect(
        await gate.check(attempt(`flood-${i}`, `${5000 + i}`, 'v@example.com')),
      ).toMatchObject({allowed: false, limitedBy: 'overall'});
    }
    // Only the first attempt recorded against the victim's email; the 50 refused ones recorded nowhere.
    expect(
      await store.peek('email', 'email#v@example.com', TWO.perEmail),
    ).toEqual({allowed: true, remaining: 1});
    expect(
      await store.peek('address', 'address#flood-0', TWO.perAddress),
    ).toEqual({allowed: true, remaining: 4});
    expect(await store.peek('order', 'order#5000', TWO.perOrder)).toEqual({
      allowed: true,
      remaining: 4,
    });
  });

  it('an attempt refused by the address counter records on no other counter', async () => {
    const {store, gate} = setup();
    for (let n = 1; n <= 4; n += 1) {
      await gate.check(attempt('att', `${1000 + n}`, `x${n}@example.com`));
    }
    await gate.check(attempt('att', '7777', 'victim@example.com'));
    expect(
      await store.peek('email', 'email#victim@example.com', LIMITS.perEmail),
    ).toEqual({allowed: true, remaining: 3});
    expect(await store.peek('order', 'order#7777', LIMITS.perOrder)).toEqual({
      allowed: true,
      remaining: 4,
    });
    expect(await store.peek('overall', 'overall#all', LIMITS.overall)).toEqual({
      allowed: true,
      remaining: 2,
    });
  });

  it('checks the overall counter first when several would refuse', async () => {
    const {gate} = setup({
      ...LIMITS,
      overall: {limit: 1, windowMs: 60_000},
      perAddress: {limit: 1, windowMs: 60_000},
    });
    await gate.check(attempt('a', '1001', 'a@example.com'));
    expect(
      await gate.check(attempt('a', '1001', 'a@example.com')),
    ).toMatchObject({limitedBy: 'overall'});
  });

  it('reads and records in the same order, one record per applicable counter', async () => {
    const {store, gate} = setup();
    await gate.check(attempt('a', '1001', 'a@example.com'));
    for (const [scope, key, rule, remaining] of [
      ['overall', 'overall#all', LIMITS.overall, 5],
      ['address', 'address#a', LIMITS.perAddress, 3],
      ['order-address', 'order-address#1001\u0000a', LIMITS.perOrderAddress, 1],
      ['order', 'order#1001', LIMITS.perOrder, 3],
      ['email', 'email#a@example.com', LIMITS.perEmail, 2],
    ] as const) {
      expect(await store.peek(scope, key, rule), scope).toEqual({
        allowed: true,
        remaining,
      });
    }
  });
});

describe('guest lookup gate: the per-order counter (L-1, T-09)', () => {
  it('holds when the attacker rotates addresses and emails', async () => {
    const {gate} = setup();
    for (let n = 1; n <= 4; n += 1) {
      expect(
        (
          await gate.check(
            attempt(`198.51.100.${n}`, '#1001', `guess${n}@example.com`),
          )
        ).allowed,
      ).toBe(true);
    }
    expect(
      await gate.check(attempt('198.51.100.99', '1001', 'guess9@example.com')),
    ).toMatchObject({allowed: false, limitedBy: 'order'});
    // Another order is unaffected.
    expect(
      (await gate.check(attempt('198.51.100.99', '1002', 'g@example.com')))
        .allowed,
    ).toBe(true);
  });

  it('counts the order number in any spelling', async () => {
    const {gate} = setup();
    for (const [n, spelling] of [
      '#1001',
      '1001',
      ' order-1001 ',
      'ORDER #1001',
    ].entries()) {
      await gate.check(attempt(`a${n}`, spelling, `p${n}@example.com`));
    }
    expect(
      await gate.check(attempt('a9', '1001', 'p9@example.com')),
    ).toMatchObject({limitedBy: 'order'});
  });

  it('is not charged for a malformed order number', async () => {
    const {store, gate} = setup();
    await gate.check(attempt('a', '1001 OR 1002', 'p@example.com'));
    expect(await store.peek('order', 'order#1001', LIMITS.perOrder)).toEqual({
      allowed: true,
      remaining: 4,
    });
  });
});

describe('the key hasher after a failed import (I-2)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('retries once, so one transient failure does not break the lookup', async () => {
    vi.spyOn(crypto.subtle, 'importKey').mockRejectedValueOnce(
      new Error('transient'),
    );
    expect(await createKeyHasher()('email', 'a@example.com')).toMatch(
      /^[0-9a-f]{32}$/,
    );
  });

  it('does not remember a failure: a later call works', async () => {
    vi.spyOn(crypto.subtle, 'importKey')
      .mockRejectedValueOnce(new Error('transient'))
      .mockRejectedValueOnce(new Error('transient'));
    const hash = createKeyHasher();
    await expect(hash('email', 'a@example.com')).rejects.toThrow();
    expect(await hash('email', 'a@example.com')).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('guest lookup gate: keys and failure (T-05, T-09)', () => {
  function recordingStore(): {
    store: RateLimitStore;
    keys: {scope: string; key: string; rule: LimitRule}[];
    peeked: {scope: string; key: string}[];
  } {
    const keys: {scope: string; key: string; rule: LimitRule}[] = [];
    const peeked: {scope: string; key: string}[] = [];
    return {
      keys,
      peeked,
      store: {
        kind: 'shared',
        peek(scope, key) {
          peeked.push({scope, key});
          return Promise.resolve({allowed: true, remaining: 1});
        },
        hit(scope, key, rule) {
          keys.push({scope, key, rule});
          return Promise.resolve({allowed: true, remaining: 1});
        },
      },
    };
  }

  it('never gives the store a raw order number, email or address', async () => {
    const {store, keys, peeked} = recordingStore();
    const gate = createGuestLookupGate({
      store,
      hash: createKeyHasher(),
      limits: LIMITS,
    });
    await gate.check(attempt('198.51.100.77', '#1001', 'Shopper@Example.com'));
    const text0 = JSON.stringify(peeked);
    expect(peeked.map((k) => k.scope)).toEqual([
      'overall',
      'address',
      'order-address',
      'order',
      'email',
    ]);
    expect(text0).not.toContain('198.51.100.77');
    expect(text0).not.toContain('1001');
    // Overall first (L-1); the same order for the read pass and the record pass.
    const scopes = ['overall', 'address', 'order-address', 'order', 'email'];
    expect(keys.map((k) => k.scope)).toEqual(scopes);
    const text = JSON.stringify(keys);
    expect(text).not.toContain('198.51.100.77');
    expect(text).not.toContain('1001');
    expect(text.toLowerCase()).not.toContain('shopper');
    expect(text).not.toContain('example.com');
    for (const {key} of [...keys, ...peeked]) {
      expect(key).toMatch(/^[0-9a-f]{32}$/);
    }
  });

  it('hashes the same input the same way inside one instance and keeps scopes apart', async () => {
    const hash = createKeyHasher();
    const first = await hash('email', 'a@example.com');
    expect(await hash('email', 'a@example.com')).toBe(first);
    expect(await hash('address', 'a@example.com')).not.toBe(first);
    expect(await hash('email', 'b@example.com')).not.toBe(first);
    // A different instance has a different random key.
    expect(await createKeyHasher()('email', 'a@example.com')).not.toBe(first);
  });

  it('hands the rule to the store so a shared store can enforce it', async () => {
    const {store, keys} = recordingStore();
    const gate = createGuestLookupGate({
      store,
      hash: plainHash,
      limits: LIMITS,
    });
    await gate.check(attempt('a', '1001', 'a@example.com'));
    expect(keys.find((k) => k.scope === 'order-address')?.rule).toEqual(
      LIMITS.perOrderAddress,
    );
  });

  const BAD_ANSWERS: readonly (readonly [string, () => Promise<unknown>])[] = [
    ['rejects', () => Promise.reject(new Error('store down'))],
    [
      'throws',
      () => {
        throw new Error('store down');
      },
    ],
    ['answers nothing', () => Promise.resolve(undefined)],
    ['answers rubbish', () => Promise.resolve({allowed: 'yes'})],
    ['allows with no retry time', () => Promise.resolve({allowed: false})],
  ];
  const GOOD = () => Promise.resolve({allowed: true, remaining: 1});

  it.each(
    BAD_ANSWERS.flatMap(([name, bad]) => [
      ['peek', name, bad] as const,
      ['hit', name, bad] as const,
    ]),
  )('fails closed when the store %s step %s', async (operation, _name, bad) => {
    const store = {
      kind: 'shared',
      peek: operation === 'peek' ? bad : GOOD,
      hit: operation === 'hit' ? bad : GOOD,
    } as unknown as RateLimitStore;
    const gate = createGuestLookupGate({
      store,
      hash: plainHash,
      limits: LIMITS,
    });
    expect(await gate.check(attempt('a', '1001', 'a@example.com'))).toEqual({
      allowed: false,
      reason: 'limiter_failed',
    });
  });

  it('fails closed when the hasher fails', async () => {
    const gate = createGuestLookupGate({
      store: createInMemoryRateLimitStore({now: () => 0}),
      hash: () => Promise.reject(new Error('no crypto')),
      limits: LIMITS,
    });
    expect(await gate.check(attempt('a', '1001', 'a@example.com'))).toEqual({
      allowed: false,
      reason: 'limiter_failed',
    });
  });

  it('fails closed on an unusable clock (via the in-memory store)', async () => {
    const gate = createGuestLookupGate({
      store: createInMemoryRateLimitStore({now: () => Number.NaN}),
      hash: plainHash,
      limits: LIMITS,
    });
    expect(
      await gate.check(attempt('a', '1001', 'a@example.com')),
    ).toMatchObject({
      allowed: false,
      reason: 'rate_limited',
    });
  });

  it('declares itself per instance', () => {
    expect(createInMemoryRateLimitStore({now: () => 0}).kind).toBe('instance');
  });

  it('bounds memory under a flood of distinct addresses', async () => {
    const clock = {now: 0};
    const store = createInMemoryRateLimitStore({
      now: () => clock.now,
      maxKeys: 50,
    });
    const gate = createGuestLookupGate({
      store,
      hash: plainHash,
      limits: {...LIMITS, overall: {limit: 1_000_000, windowMs: 60_000}},
    });
    for (let i = 0; i < 5000; i += 1) {
      clock.now = i;
      expect(
        (await gate.check(attempt(`addr-${i}`, `${i}`, `p${i}@example.com`)))
          .allowed,
      ).toBe(true);
    }
  });
});
