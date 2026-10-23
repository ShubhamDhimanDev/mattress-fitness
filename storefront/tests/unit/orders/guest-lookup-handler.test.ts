import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  GUEST_LOOKUP_FAILURE_MESSAGE,
  type GuestOrderCandidate,
} from '~/lib/orders/guest-lookup';
import type {GuestOrderLookupResult} from '~/lib/orders/guest-lookup-client';
import {
  GUEST_LOOKUP_MIN_DURATION_MS,
  GUEST_LOOKUP_RATE_LIMITED_MESSAGE,
  GUEST_LOOKUP_UNAVAILABLE_MESSAGE,
  guestLookupConfigured,
  guestLookupDepsFromEnv,
  handleGuestLookup,
  resetGuestLookupStateForTests,
  resolveClientAddress,
  type GuestLookupDeps,
  type GuestLookupHttpResult,
} from '~/lib/orders/guest-lookup-handler';
import {
  createGuestLookupGate,
  createInMemoryRateLimitStore,
  type RateLimitStore,
} from '~/lib/orders/guest-lookup-limiter';
import {
  FIXTURE_DAY_MS,
  FIXTURE_NOW,
  fakeAdminClient,
  fixtureOrder,
  type FakeAdminClient,
} from './fake-admin-client';

// REQ-ACC-003 / P6-08 / T-09 / T-05: the request flow, with a fake Admin client, a fake clock and a fake sleep. No
// network, no real timers. UNVERIFIED against a real store (V-20).

afterEach(() => {
  vi.restoreAllMocks();
  resetGuestLookupStateForTests();
});

const ORIGIN = 'https://shop.example';
const RIGHT = {orderNumber: '#1001', email: 'shopper@example.com'};
const ADDRESS_HEADER = 'x-real-ip';

const GENEROUS = {
  perAddress: {limit: 1000, windowMs: 60_000},
  perOrderAddress: {limit: 1000, windowMs: 60_000},
  perEmail: {limit: 1000, windowMs: 60_000},
  overall: {limit: 1000, windowMs: 60_000},
};

type Harness = {
  deps: GuestLookupDeps;
  client: FakeAdminClient;
  clock: {now: number};
  sleeps: number[];
  store: RateLimitStore;
};

function harness(
  options: {
    respond?: (candidates: GuestOrderCandidate[]) => GuestOrderLookupResult;
    candidates?: GuestOrderCandidate[];
    latencyMs?: number;
    limits?: typeof GENEROUS;
    store?: RateLimitStore;
    noClient?: boolean;
  } = {},
): Harness {
  const clock = {now: FIXTURE_NOW};
  const sleeps: number[] = [];
  const store =
    options.store ?? createInMemoryRateLimitStore({now: () => clock.now});
  const candidates = options.candidates ?? [fixtureOrder()];
  const client = fakeAdminClient(() => {
    clock.now += options.latencyMs ?? 200;
    return options.respond
      ? options.respond(candidates)
      : {status: 'ok', candidates};
  });
  return {
    client,
    clock,
    sleeps,
    store,
    deps: {
      client: options.noClient ? null : client,
      gate: createGuestLookupGate({
        store,
        hash: (scope, value) => Promise.resolve(`${scope}#${value}`),
        limits: options.limits ?? GENEROUS,
      }),
      now: () => clock.now,
      sleep: (ms) => {
        sleeps.push(ms);
        clock.now += ms;
        return Promise.resolve();
      },
      addressHeader: ADDRESS_HEADER,
    },
  };
}

function post(
  fields: Record<string, string>,
  headers: Record<string, string> = {},
  init: {method?: string; body?: BodyInit; contentType?: string} = {},
): Request {
  return new Request(`${ORIGIN}/track-order`, {
    method: init.method ?? 'POST',
    headers: {
      Origin: ORIGIN,
      [ADDRESS_HEADER]: '198.51.100.10',
      ...(init.contentType ? {'Content-Type': init.contentType} : {}),
      ...headers,
    },
    body: init.body ?? new URLSearchParams(fields),
  });
}

function snapshot(result: GuestLookupHttpResult) {
  return {
    status: result.status,
    response: result.response,
    headers: Object.fromEntries(
      [...result.headers.entries()].sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
}

describe('a matching lookup (REQ-ACC-003)', () => {
  it('returns a minimal order view, private and not indexable', async () => {
    const h = harness();
    const result = await handleGuestLookup(post(RIGHT), h.deps);
    expect(result.status).toBe(200);
    expect(result.response).toMatchObject({
      status: 'found',
      order: {
        orderName: '#1001',
        status: 'fulfilled',
        statusLabel: 'Fulfilled',
        items: [
          {title: 'Larkmoor Cedar Medium Hybrid Mattress - Queen', quantity: 1},
        ],
        shipments: [
          {
            trackingCompany: 'Example Freight',
            trackingNumber: 'TRK123456789',
            trackingUrl: 'https://tracking.example.com/TRK123456789',
          },
        ],
      },
    });
    expect(JSON.stringify(result.response).toLowerCase()).not.toContain(
      'shopper@example.com',
    );
    expect(result.headers.get('Cache-Control')).toBe('private, no-store');
    expect(result.headers.get('Vary')).toBe('Cookie');
    expect(result.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
  });

  it('sends the lookup as one constant query with the order number as a variable', async () => {
    const h = harness();
    await handleGuestLookup(
      post({orderNumber: ' order #1001 ', email: RIGHT.email}),
      h.deps,
    );
    expect(h.client.calls).toHaveLength(1);
    expect(h.client.calls[0]?.variables).toEqual({query: 'name:1001'});
    expect(h.client.calls[0]?.query).not.toContain('1001');
  });

  it('matches an email typed in another case, with surrounding space', async () => {
    const h = harness();
    const result = await handleGuestLookup(
      post({orderNumber: '1001', email: '  SHOPPER@Example.COM '}),
      h.deps,
    );
    expect(result.response.status).toBe('found');
  });

  it('finds the right order among several split-order candidates', async () => {
    const h = harness({
      candidates: [
        fixtureOrder({name: '#1001-B'}),
        fixtureOrder({email: 'other@example.com'}),
        fixtureOrder(),
      ],
    });
    const result = await handleGuestLookup(post(RIGHT), h.deps);
    expect(result.response.status).toBe('found');
  });
});

describe('one generic failure for every order-dependent outcome (T-09)', () => {
  const TOO_OLD = fixtureOrder({
    createdAt: new Date(FIXTURE_NOW - 61 * FIXTURE_DAY_MS).toISOString(),
  });
  const upstream =
    (reason: 'auth' | 'timeout' | 'network' | 'graphql') =>
    (): GuestOrderLookupResult => ({status: 'error', reason});

  const scenarios: readonly {
    name: string;
    fields: Record<string, string>;
    candidates?: GuestOrderCandidate[];
    respond?: () => GuestOrderLookupResult;
    request?: () => Request;
    reachesAdmin: boolean;
  }[] = [
    {
      name: 'wrong email',
      fields: {orderNumber: '#1001', email: 'other@example.com'},
      reachesAdmin: true,
    },
    {
      name: 'no such order',
      fields: RIGHT,
      candidates: [],
      reachesAdmin: true,
    },
    {
      name: 'a different order returned',
      fields: RIGHT,
      candidates: [fixtureOrder({name: '#2002'})],
      reachesAdmin: true,
    },
    {
      name: 'order older than 60 days',
      fields: RIGHT,
      candidates: [TOO_OLD],
      reachesAdmin: true,
    },
    {
      name: 'order with no email',
      fields: RIGHT,
      candidates: [fixtureOrder({email: null})],
      reachesAdmin: true,
    },
    {
      name: 'malformed order number',
      fields: {orderNumber: '1001 OR email:*', email: RIGHT.email},
      reachesAdmin: false,
    },
    {
      name: 'malformed email',
      fields: {orderNumber: '#1001', email: 'shopper'},
      reachesAdmin: false,
    },
    {name: 'missing fields', fields: {}, reachesAdmin: false},
    {
      name: 'oversized values',
      fields: {orderNumber: '1'.repeat(3000), email: 'a'.repeat(3000)},
      reachesAdmin: false,
    },
    {
      name: 'Admin API refuses the token',
      fields: RIGHT,
      respond: upstream('auth'),
      reachesAdmin: true,
    },
    {
      name: 'Admin API times out',
      fields: RIGHT,
      respond: upstream('timeout'),
      reachesAdmin: true,
    },
    {
      name: 'Admin API unreachable',
      fields: RIGHT,
      respond: upstream('network'),
      reachesAdmin: true,
    },
    {
      name: 'Admin API answers with errors',
      fields: RIGHT,
      respond: upstream('graphql'),
      reachesAdmin: true,
    },
    {
      name: 'body that is not a form',
      fields: {},
      request: () =>
        post({}, {}, {body: 'orderNumber=1001', contentType: 'text/plain'}),
      reachesAdmin: false,
    },
    {
      name: 'body past the size cap',
      fields: {},
      request: () =>
        post(
          {},
          {},
          {
            body: `orderNumber=1001&email=${'a'.repeat(9000)}`,
            contentType: 'application/x-www-form-urlencoded',
          },
        ),
      reachesAdmin: false,
    },
  ];

  it.each(scenarios)(
    '$name gives the same answer, headers and duration',
    async (scenario) => {
      const h = harness({
        ...(scenario.candidates ? {candidates: scenario.candidates} : {}),
        ...(scenario.respond ? {respond: scenario.respond} : {}),
      });
      const started = h.clock.now;
      const result = await handleGuestLookup(
        scenario.request ? scenario.request() : post(scenario.fields),
        h.deps,
      );
      expect(h.client.calls.length > 0).toBe(scenario.reachesAdmin);
      expect(snapshot(result)).toEqual({
        status: 200,
        response: {status: 'not_found', message: GUEST_LOOKUP_FAILURE_MESSAGE},
        headers: {
          'cache-control': 'private, no-store',
          vary: 'Cookie',
          'x-robots-tag': 'noindex, nofollow',
        },
      });
      // Every one of them took exactly the floor on the (fake) clock.
      expect(h.clock.now - started).toBe(GUEST_LOOKUP_MIN_DURATION_MS);
    },
  );

  it('the generic message names no field and no reason', () => {
    expect(GUEST_LOOKUP_FAILURE_MESSAGE).toContain('60 days');
    expect(GUEST_LOOKUP_FAILURE_MESSAGE).toContain('sign in');
  });

  it('returns byte-identical JSON for a wrong email and a missing order', async () => {
    const wrongEmail = await handleGuestLookup(
      post({orderNumber: '#1001', email: 'other@example.com'}),
      harness().deps,
    );
    const missing = await handleGuestLookup(
      post(RIGHT),
      harness({candidates: []}).deps,
    );
    expect(JSON.stringify(wrongEmail.response)).toBe(
      JSON.stringify(missing.response),
    );
  });
});

describe('timing class (T-09)', () => {
  it('pads a fast upstream to the floor and does not pad a slow one', async () => {
    const fast = harness({latencyMs: 100});
    await handleGuestLookup(post(RIGHT), fast.deps);
    expect(fast.sleeps).toEqual([GUEST_LOOKUP_MIN_DURATION_MS - 100]);

    const slow = harness({latencyMs: GUEST_LOOKUP_MIN_DURATION_MS + 1500});
    await handleGuestLookup(post(RIGHT), slow.deps);
    expect(slow.sleeps).toEqual([]);
  });

  it('a lookup that skips the Admin API waits the whole floor', async () => {
    const h = harness();
    await handleGuestLookup(post({orderNumber: 'x y', email: 'nope'}), h.deps);
    expect(h.client.calls).toHaveLength(0);
    expect(h.sleeps).toEqual([GUEST_LOOKUP_MIN_DURATION_MS]);
  });

  it('found and not found take the same time on a fixed-latency upstream', async () => {
    const found = harness();
    const t0 = found.clock.now;
    await handleGuestLookup(post(RIGHT), found.deps);
    const notFound = harness();
    const t1 = notFound.clock.now;
    await handleGuestLookup(
      post({orderNumber: '#1001', email: 'other@example.com'}),
      notFound.deps,
    );
    expect(found.clock.now - t0).toBe(notFound.clock.now - t1);
  });
});

describe('refusals that carry no order information', () => {
  it('refuses every method but POST without looking anything up', async () => {
    for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) {
      const h = harness();
      const request = new Request(
        `${ORIGIN}/track-order?orderNumber=1001&email=shopper@example.com`,
        {method, headers: {Origin: ORIGIN}},
      );
      const result = await handleGuestLookup(request, h.deps);
      expect(result.status).toBe(405);
      expect(result.headers.get('Allow')).toBe('POST');
      expect(result.response.status).toBe('not_found');
      expect(h.client.calls).toHaveLength(0);
    }
  });

  it('refuses a cross-origin POST before it reads the body or touches a counter', async () => {
    const h = harness();
    const hits = vi.spyOn(h.store, 'hit');
    const result = await handleGuestLookup(
      post(RIGHT, {Origin: 'https://evil.example'}),
      h.deps,
    );
    expect(result.status).toBe(403);
    expect(h.client.calls).toHaveLength(0);
    expect(hits).not.toHaveBeenCalled();
  });

  it('refuses a request the browser labels cross-site even with no Origin', async () => {
    const h = harness();
    const request = new Request(`${ORIGIN}/track-order`, {
      method: 'POST',
      headers: {
        'Sec-Fetch-Site': 'cross-site',
        [ADDRESS_HEADER]: '198.51.100.10',
      },
      body: new URLSearchParams(RIGHT),
    });
    expect((await handleGuestLookup(request, h.deps)).status).toBe(403);
    expect(h.client.calls).toHaveLength(0);
  });
});

describe('Admin token not configured: fail closed (REQ-ACC-003)', () => {
  it('says the lookup is unavailable and fakes nothing', async () => {
    const h = harness({noClient: true});
    const hits = vi.spyOn(h.store, 'hit');
    const result = await handleGuestLookup(post(RIGHT), h.deps);
    expect(result.status).toBe(503);
    expect(result.response).toEqual({
      status: 'unavailable',
      message: GUEST_LOOKUP_UNAVAILABLE_MESSAGE,
    });
    expect(GUEST_LOOKUP_UNAVAILABLE_MESSAGE).toContain(
      'Order lookup is not available right now',
    );
    expect(hits).not.toHaveBeenCalled();
    expect(result.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('is decided from the environment: both the store domain and the token are needed', () => {
    const token = 'fixture-admin-token-not-real';
    expect(guestLookupConfigured({})).toBe(false);
    expect(guestLookupConfigured({SHOPIFY_ADMIN_API_ACCESS_TOKEN: token})).toBe(
      false,
    );
    expect(
      guestLookupConfigured({PUBLIC_STORE_DOMAIN: 'test-shop.myshopify.com'}),
    ).toBe(false);
    expect(
      guestLookupConfigured({
        PUBLIC_STORE_DOMAIN: 'test-shop.myshopify.com',
        SHOPIFY_ADMIN_API_ACCESS_TOKEN: token,
      }),
    ).toBe(true);
    expect(guestLookupDepsFromEnv({}).client).toBeNull();
    expect(
      guestLookupDepsFromEnv({
        PUBLIC_STORE_DOMAIN: 'test-shop.myshopify.com',
        SHOPIFY_ADMIN_API_ACCESS_TOKEN: token,
      }).client,
    ).not.toBeNull();
  });
});

describe('rate limiting in the flow (T-09, R-27)', () => {
  const TIGHT = {
    perAddress: {limit: 3, windowMs: 60_000},
    perOrderAddress: {limit: 2, windowMs: 60_000},
    perEmail: {limit: 3, windowMs: 60_000},
    overall: {limit: 50, windowMs: 60_000},
  };

  it('answers 429 with Retry-After and never reaches the Admin API once blocked', async () => {
    const h = harness({limits: TIGHT});
    const wrong = {orderNumber: '#1001', email: 'other@example.com'};
    expect((await handleGuestLookup(post(wrong), h.deps)).status).toBe(200);
    expect((await handleGuestLookup(post(wrong), h.deps)).status).toBe(200);
    expect(h.client.calls).toHaveLength(2);

    const blocked = await handleGuestLookup(post(wrong), h.deps);
    expect(blocked.status).toBe(429);
    expect(blocked.response).toEqual({
      status: 'rate_limited',
      message: GUEST_LOOKUP_RATE_LIMITED_MESSAGE,
    });
    expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(h.client.calls).toHaveLength(2);
  });

  it('counts malformed attempts and does not wait out the floor for a blocked one', async () => {
    const h = harness({limits: TIGHT});
    for (let i = 0; i < 3; i += 1) {
      await handleGuestLookup(
        post({orderNumber: 'x y', email: 'nope'}),
        h.deps,
      );
    }
    h.sleeps.length = 0;
    const blocked = await handleGuestLookup(
      post({orderNumber: 'x y', email: 'nope'}),
      h.deps,
    );
    expect(blocked.status).toBe(429);
    expect(h.sleeps).toEqual([]);
  });

  it('limits per address: another address is not affected', async () => {
    const h = harness({limits: TIGHT});
    for (let i = 0; i < 4; i += 1) {
      await handleGuestLookup(
        post({orderNumber: `${2000 + i}`, email: `p${i}@example.com`}),
        h.deps,
      );
    }
    const other = await handleGuestLookup(
      post(RIGHT, {[ADDRESS_HEADER]: '198.51.100.99'}),
      h.deps,
    );
    expect(other.status).toBe(200);
    expect(other.response.status).toBe('found');
  });

  it('fails closed when the counter store is down: unavailable, no lookup', async () => {
    const failing: RateLimitStore = {
      kind: 'shared',
      hit: () => Promise.reject(new Error('store down')),
    };
    const h = harness({store: failing});
    const result = await handleGuestLookup(post(RIGHT), h.deps);
    expect(result.status).toBe(503);
    expect(result.response.status).toBe('unavailable');
    expect(h.client.calls).toHaveLength(0);
  });

  it('unidentified callers share one stricter bucket', async () => {
    const h = harness({limits: TIGHT});
    const anonymous = (n: number) =>
      new Request(`${ORIGIN}/track-order`, {
        method: 'POST',
        headers: {Origin: ORIGIN},
        body: new URLSearchParams({
          orderNumber: `${3000 + n}`,
          email: `p${n}@example.com`,
        }),
      });
    for (let n = 0; n < 3; n += 1) {
      expect((await handleGuestLookup(anonymous(n), h.deps)).status).toBe(200);
    }
    expect((await handleGuestLookup(anonymous(9), h.deps)).status).toBe(429);
  });
});

describe('who is asking (resolveClientAddress)', () => {
  const headers = (entries: Record<string, string>) => new Headers(entries);

  it('uses only the configured header, from the allow-list', () => {
    expect(
      resolveClientAddress(headers({'x-real-ip': '198.51.100.7'}), 'x-real-ip'),
    ).toEqual({address: '198.51.100.7', source: 'header'});
    expect(
      resolveClientAddress(
        headers({
          'x-real-ip': '198.51.100.7',
          'cf-connecting-ip': '203.0.113.5',
        }),
        'CF-Connecting-IP',
      ),
    ).toEqual({address: '203.0.113.5', source: 'header'});
  });

  it('ignores a header that is not on the allow-list and falls back to the platform default', () => {
    expect(
      resolveClientAddress(
        headers({forwarded: 'for=1.2.3.4', 'oxygen-buyer-ip': '198.51.100.8'}),
        'forwarded',
      ),
    ).toEqual({address: '198.51.100.8', source: 'header'});
    expect(
      resolveClientAddress(headers({forwarded: 'for=1.2.3.4'}), 'forwarded'),
    ).toEqual({address: 'unknown', source: 'none'});
  });

  it('takes the last x-forwarded-for entry, the one the nearest proxy added', () => {
    expect(
      resolveClientAddress(
        headers({'x-forwarded-for': '6.6.6.6, 198.51.100.9'}),
        'x-forwarded-for',
      ),
    ).toEqual({address: '198.51.100.9', source: 'header'});
  });

  it.each([
    [''],
    ['not an address'],
    ['198.51.100.9; DROP'],
    ['a'.repeat(100)],
    ['198.51.100.9\r\nX-Evil: 1'],
    ['fe80::1%eth0'],
  ])('treats %j as unknown', (value) => {
    const h = new Headers();
    h.set('x-real-ip', value.replace(/[\r\n]/g, ''));
    expect(resolveClientAddress(h, 'x-real-ip').address).toBe('unknown');
  });

  it('lower-cases IPv6', () => {
    expect(
      resolveClientAddress(headers({'x-real-ip': '2001:DB8::1'}), 'x-real-ip')
        .address,
    ).toBe('2001:db8::1');
  });

  it('with nothing configured and no platform header, is unknown', () => {
    expect(resolveClientAddress(headers({}), null)).toEqual({
      address: 'unknown',
      source: 'none',
    });
  });
});

describe('logging: codes and counts only (T-05, T-09)', () => {
  function captureLogs(): () => string[] {
    const lines: string[] = [];
    const sink = (line: unknown) => {
      lines.push(String(line));
    };
    vi.spyOn(console, 'warn').mockImplementation(sink);
    vi.spyOn(console, 'error').mockImplementation(sink);
    return () => lines;
  }

  it('logs no order number, email, address, token or message text across every outcome', async () => {
    const logs = captureLogs();
    const scenarios: Harness[] = [
      harness(),
      harness({candidates: []}),
      harness({respond: () => ({status: 'error', reason: 'auth'})}),
      harness({noClient: true}),
      harness({
        limits: {...GENEROUS, perAddress: {limit: 1, windowMs: 60_000}},
      }),
    ];
    for (const h of scenarios) {
      await handleGuestLookup(post(RIGHT), h.deps);
      await handleGuestLookup(post(RIGHT), h.deps);
      await handleGuestLookup(
        post({orderNumber: '#99887766', email: 'someone.else@example.com'}),
        h.deps,
      );
      await handleGuestLookup(
        post(RIGHT, {Origin: 'https://evil.example'}),
        h.deps,
      );
    }
    const text = logs().join('\n');
    expect(text.length).toBeGreaterThan(0);
    for (const secret of [
      '1001',
      '99887766',
      'shopper',
      'someone.else',
      'example.com',
      '198.51.100',
      'Example Freight',
      'TRK1234',
      'Larkmoor',
      'fixture-admin-token',
    ]) {
      expect(text, `log must not contain ${secret}`).not.toContain(secret);
    }
    const events = new Set(
      logs().map((line) => (JSON.parse(line) as {event: string}).event),
    );
    for (const event of events) {
      expect([
        'guest_lookup.completed',
        'guest_lookup.rate_limited',
        'guest_lookup.limiter_failed',
        'guest_lookup.upstream_failed',
        'guest_lookup.unavailable',
        'guest_lookup.rejected',
      ]).toContain(event);
    }
  });
});
