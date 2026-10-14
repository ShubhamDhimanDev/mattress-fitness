import {describe, expect, it} from 'vitest';
import {createCircuitBreaker} from '~/lib/extend/circuit-breaker';
import {parseExtendConfig} from '~/lib/extend/config';
import type {ExtendLogEvent} from '~/lib/extend/log';
import type {ShopifyOrderLike} from '~/lib/extend/orders';
import {
  DEFAULT_RETRY_POLICY,
  backoffDelayMs,
  syncOrder,
  type QuoteLookup,
  type SyncDeps,
} from '~/lib/extend/sync';
import {
  GOOD_PLAN_ID,
  SYNTHETIC_PII,
  coverageLine,
  makeOrder,
  mattressLine,
} from '~/lib/extend/test-fixtures';
import type {FetchInit, FetchLike, PlanQuote} from '~/lib/extend/types';

const TOKEN = 'tok_fixture_sync_0001';

type Step =
  {status: number; headers?: Record<string, string>} | 'network' | 'hang';

function harness(
  options: {
    steps?: Step[];
    orderSync?: string;
    lookup?: QuoteLookup;
    retry?: Partial<typeof DEFAULT_RETRY_POLICY>;
    withBreaker?: boolean;
  } = {},
) {
  const calls: Array<{url: string; init: FetchInit}> = [];
  const sleeps: number[] = [];
  const logs: ExtendLogEvent[] = [];
  const clock = {t: 0};
  const steps = [...(options.steps ?? [])];

  const fetchFn: FetchLike = (url, init) => {
    calls.push({url, init});
    const step = steps.shift() ?? {status: 200};
    if (step === 'network')
      return Promise.reject(new TypeError('fetch failed'));
    if (step === 'hang') return new Promise<Response>(() => {});
    return Promise.resolve(
      new Response('{}', {status: step.status, headers: step.headers}),
    );
  };

  const config = parseExtendConfig(
    {
      PUBLIC_EXTEND_ENABLED: 'true',
      EXTEND_API_HOST: 'https://api-demo.helloextend.com',
      EXTEND_STORE_ID: 'store-fixture-1',
      EXTEND_ACCESS_TOKEN: TOKEN,
      ...(options.orderSync === undefined
        ? {}
        : {EXTEND_ORDER_SYNC: options.orderSync}),
    },
    {production: false},
  );
  const lookups: unknown[] = [];
  const defaultLookup: QuoteLookup = (query) => {
    lookups.push(query);
    return {planId: query.planId, priceCents: 7999};
  };

  const breaker = options.withBreaker
    ? createCircuitBreaker({
        now: () => clock.t,
        failureThreshold: 2,
        openMs: 60_000,
      })
    : undefined;

  const deps: SyncDeps = {
    config,
    fetch: fetchFn,
    sleep: (ms) => {
      sleeps.push(ms);
      clock.t += ms;
      return Promise.resolve();
    },
    now: () => clock.t,
    lookupQuote: options.lookup ?? defaultLookup,
    log: (event) => logs.push(event),
    random: () => 1, // full backoff, so delays are exact
    retry: {timeoutMs: 20, ...options.retry},
    ...(breaker === undefined ? {} : {breaker}),
  };
  return {deps, calls, sleeps, logs, lookups, clock, breaker};
}

function bodyOf(call: {init: FetchInit} | undefined): unknown {
  return JSON.parse(call?.init.body ?? 'null');
}

describe('syncOrder: happy path (REQ-EXT-003)', () => {
  it('PUTs one full snapshot to /orders with the documented headers and returns the plan ids', async () => {
    const h = harness();
    const result = await syncOrder(makeOrder(), h.deps);
    expect(result).toEqual({
      status: 'synced',
      orderId: '7001',
      attempts: 1,
      planIds: [GOOD_PLAN_ID],
      flagged: [],
      warnings: [],
    });
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]?.url).toBe('https://api-demo.helloextend.com/orders');
    expect(h.calls[0]?.init.method).toBe('PUT');
    expect(h.calls[0]?.init.redirect).toBe('error');
    expect(h.calls[0]?.init.headers['X-Extend-Access-Token']).toBe(TOKEN);
    expect(h.calls[0]?.init.headers.Accept).toBe(
      'application/json;version=2022-02-01',
    );
    expect(bodyOf(h.calls[0])).toMatchObject({
      transactionId: '7001',
      storeId: 'store-fixture-1',
      currency: 'USD',
      total: 137_899,
    });
    expect(h.lookups).toEqual([
      {
        planId: GOOD_PLAN_ID,
        coveredProductId: '501',
        category: 'mattress',
        coveredUnitPriceCents: 129_900,
      },
    ]);
  });

  it('is idempotent by construction: syncing the same order twice sends byte-identical bodies', async () => {
    const h = harness();
    await syncOrder(makeOrder(), h.deps);
    await syncOrder(makeOrder(), h.deps);
    expect(h.calls).toHaveLength(2);
    expect(h.calls[0]?.init.body).toBe(h.calls[1]?.init.body);
  });

  it('sends the fulfilled state when the order is later fulfilled (same ids, new fulfilledQuantity)', async () => {
    const h = harness();
    await syncOrder(makeOrder(), h.deps);
    await syncOrder(
      makeOrder({
        lineItems: [mattressLine({fulfilledQuantity: 1}), coverageLine()],
      }),
      h.deps,
    );
    expect(bodyOf(h.calls[0])).toMatchObject({
      lineItems: [
        {lineItemTransactionId: '1001', fulfilledQuantity: 0},
        {lineItemTransactionId: '1002-contract', fulfilledQuantity: 0},
      ],
    });
    expect(bodyOf(h.calls[1])).toMatchObject({
      lineItems: [
        {lineItemTransactionId: '1001', fulfilledQuantity: 1},
        {lineItemTransactionId: '1002-contract', fulfilledQuantity: 1},
      ],
    });
  });
});

describe('syncOrder: modes (ADR-0009: EXTEND_ORDER_SYNC guards against double reporting)', () => {
  it.each([
    ['extend-app', 'order_sync_extend_app'],
    ['off', 'order_sync_off'],
  ])('mode %s skips without any lookup or request', async (mode, reason) => {
    const h = harness({orderSync: mode});
    expect(await syncOrder(makeOrder(), h.deps)).toEqual({
      status: 'skipped',
      reason,
      orderId: '7001',
      flagged: [],
    });
    expect(h.calls).toHaveLength(0);
    expect(h.lookups).toHaveLength(0);
  });

  it('mode self (and the default) sends', async () => {
    for (const mode of [undefined, 'self']) {
      const h = harness({orderSync: mode});
      expect((await syncOrder(makeOrder(), h.deps)).status).toBe('synced');
    }
  });

  it('skips when Extend is disabled or unconfigured', async () => {
    const h = harness();
    const disabled = {
      ...h.deps,
      config: parseExtendConfig({}, {production: false}),
    };
    expect(await syncOrder(makeOrder(), disabled)).toMatchObject({
      status: 'skipped',
      reason: 'disabled',
    });
    expect(h.calls).toHaveLength(0);
  });

  it('skips an order with no coverage at all: nothing for Extend, no customer data sent', async () => {
    const h = harness();
    const result = await syncOrder(
      makeOrder({lineItems: [mattressLine()]}),
      h.deps,
    );
    expect(result).toMatchObject({
      status: 'skipped',
      reason: 'no_coverage_lines',
    });
    expect(h.calls).toHaveLength(0);
  });
});

describe('syncOrder: cross-check keeps bad coverage away from Extend (ADR-0009 decision 7, T-06)', () => {
  it('sends the valid lines and returns the flagged one when only some coverage is bad', async () => {
    const h = harness();
    const second = mattressLine({
      id: '1003',
      productId: '503',
      variantId: 'v-2',
      unitPriceCents: 89_900,
      paidUnitPriceCents: 89_900,
    });
    const order = makeOrder({
      lineItems: [
        mattressLine(),
        second,
        coverageLine(),
        // Claims an expensive plan on the other mattress but is a bare SKU with the wrong price.
        coverageLine({
          id: '1004',
          parentLineItemId: '1003',
          unitPriceCents: 1499,
          paidUnitPriceCents: 1499,
          sku: 'Extend-Protection-Plan-14.99',
          variantTitle: 'Extend-Protection-Plan-14.99',
          attributes: {
            _extend_plan_id: 'MOCK-MATT-ADH-3Y-B',
            _extend_covered_product_id: '503',
          },
        }),
      ],
    });
    const lookup: QuoteLookup = (query) => ({
      planId: query.planId,
      priceCents: query.planId === GOOD_PLAN_ID ? 7999 : 4999,
    });
    const result = await syncOrder(order, {...h.deps, lookupQuote: lookup});
    expect(result).toMatchObject({
      status: 'synced',
      planIds: [GOOD_PLAN_ID],
      flagged: [{lineId: '1004', reason: 'price_mismatch'}],
    });
    expect(bodyOf(h.calls[0])).toMatchObject({
      lineItems: [
        {lineItemTransactionId: '1001'},
        {lineItemTransactionId: '1003'},
        {lineItemTransactionId: '1002-contract'},
      ],
    });
    expect(JSON.stringify(bodyOf(h.calls[0]))).not.toContain(
      'MOCK-MATT-ADH-3Y-B',
    );
  });

  it('sends nothing when every coverage line is flagged', async () => {
    const h = harness();
    const order = makeOrder({
      lineItems: [
        mattressLine(),
        coverageLine({parentLineItemId: null, attributes: {}}),
      ],
    });
    const result = await syncOrder(order, h.deps);
    expect(result).toMatchObject({
      status: 'skipped',
      reason: 'all_coverage_flagged',
      flagged: [{lineId: '1002', reason: 'invalid_plan_id'}],
    });
    expect(h.calls).toHaveLength(0);
    expect(h.logs.map((e) => e.event)).toContain('sync.coverage_flagged');
  });

  it.each<[string, PlanQuote | null]>([
    ['null (plan not offered)', null],
    // Type-valid but not a usable price: the runtime guard must treat it as "not verified", never as a match.
    [
      'a quote with a NaN price',
      {planId: GOOD_PLAN_ID, priceCents: Number.NaN},
    ],
    [
      'a quote with a fractional price',
      {planId: GOOD_PLAN_ID, priceCents: 79.99},
    ],
    ['a quote for a different plan', {planId: 'OTHER', priceCents: 7999}],
    [
      'a quote at a different price',
      {planId: GOOD_PLAN_ID, priceCents: 14_999},
    ],
  ])('flags the line when the lookup returns %s', async (_label, answer) => {
    const h = harness({lookup: () => answer});
    const result = await syncOrder(makeOrder(), h.deps);
    expect(result).toMatchObject({
      status: 'skipped',
      reason: 'all_coverage_flagged',
    });
    expect(h.calls).toHaveLength(0);
  });

  it('reports quantity warnings but still syncs', async () => {
    const h = harness();
    const order = makeOrder({
      lineItems: [mattressLine(), coverageLine({quantity: 2})],
    });
    const result = await syncOrder(order, h.deps);
    expect(result).toMatchObject({
      status: 'synced',
      warnings: [{lineId: '1002', reason: 'quantity_mismatch'}],
    });
    expect(h.logs.map((e) => e.event)).toContain('sync.coverage_warning');
  });

  it('fails as retriable, without sending, when the lookup cannot answer (Extend down is not a verdict)', async () => {
    const h = harness({
      lookup: () => {
        throw new Error('offers unavailable');
      },
    });
    const result = await syncOrder(makeOrder(), h.deps);
    expect(result).toEqual({
      status: 'failed',
      reason: 'quote_lookup_failed',
      retriable: true,
      orderId: '7001',
      attempts: 0,
    });
    expect(h.calls).toHaveLength(0);
    expect(h.logs).toEqual([
      {
        level: 'warn',
        event: 'sync.quote_lookup_failed',
        lineIds: ['1002'],
        planIds: [GOOD_PLAN_ID],
        orderId: '7001',
      },
    ]);
  });

  it('fails as retriable when the lookup rejects asynchronously', async () => {
    const h = harness({lookup: () => Promise.reject(new Error('boom'))});
    expect(await syncOrder(makeOrder(), h.deps)).toMatchObject({
      status: 'failed',
      reason: 'quote_lookup_failed',
      retriable: true,
    });
  });
});

describe('syncOrder: invalid input', () => {
  it.each([
    ['non-USD order', {currency: 'CAD'}, 'unsupported_currency'],
    ['unparseable order', {createdAt: 'nope'}, 'invalid_order'],
    [
      'bad quantity',
      {lineItems: [mattressLine({quantity: -3}), coverageLine()]},
      'invalid_order',
    ],
  ])(
    '%s fails permanently and sends nothing',
    async (_label, overrides: Partial<ShopifyOrderLike>, reason) => {
      const h = harness();
      expect(await syncOrder(makeOrder(overrides), h.deps)).toMatchObject({
        status: 'failed',
        reason,
        retriable: false,
      });
      expect(h.calls).toHaveLength(0);
    },
  );

  it('handles an order with an unusable id without throwing', async () => {
    const h = harness();
    const result = await syncOrder(makeOrder({id: 'garbage'}), h.deps);
    expect(result).toMatchObject({
      status: 'failed',
      reason: 'invalid_order',
      orderId: null,
    });
  });
});

describe('syncOrder: retries and failure handling (NFR-006, T-13)', () => {
  it('retries transient failures with exponential backoff and then succeeds, resending the same snapshot', async () => {
    const h = harness({steps: [{status: 503}, 'network', {status: 200}]});
    const result = await syncOrder(makeOrder(), h.deps);
    expect(result).toMatchObject({status: 'synced', attempts: 3});
    expect(h.sleeps).toEqual([500, 1000]);
    expect(new Set(h.calls.map((c) => c.init.body)).size).toBe(1);
  });

  it('honours Retry-After (capped) when it is longer than the backoff', async () => {
    const h = harness({
      steps: [{status: 429, headers: {'Retry-After': '3'}}, {status: 200}],
    });
    await syncOrder(makeOrder(), h.deps);
    expect(h.sleeps).toEqual([3000]);
  });

  it('times out a hanging request, retries, and gives up after the bounded attempts', async () => {
    const h = harness({steps: ['hang', 'hang', 'hang', 'hang', 'hang']});
    const result = await syncOrder(makeOrder(), h.deps);
    expect(result).toEqual({
      status: 'failed',
      reason: 'timeout',
      retriable: true,
      orderId: '7001',
      attempts: 4,
    });
    expect(h.calls).toHaveLength(4);
    expect(h.sleeps).toEqual([500, 1000, 2000]);
  });

  it('caps the backoff at maxDelayMs', async () => {
    const h = harness({
      steps: Array.from({length: 8}, () => ({status: 500})),
      retry: {
        maxAttempts: 8,
        baseDelayMs: 1000,
        maxDelayMs: 3000,
        maxTotalMs: 10 ** 9,
      },
    });
    await syncOrder(makeOrder(), h.deps);
    expect(h.sleeps).toEqual([1000, 2000, 3000, 3000, 3000, 3000, 3000]);
  });

  it('stops retrying when the total time budget would be exceeded', async () => {
    const h = harness({
      steps: Array.from({length: 8}, () => ({status: 500})),
      retry: {maxAttempts: 8, maxTotalMs: 2000},
    });
    const result = await syncOrder(makeOrder(), h.deps);
    expect(result).toMatchObject({status: 'failed', retriable: true});
    expect(h.calls.length).toBeLessThan(8);
    expect(h.clock.t).toBeLessThanOrEqual(2000);
  });

  it.each([
    [400, false],
    [404, false],
    [409, false],
    [422, false],
    [401, true],
    [403, true],
  ])(
    'does not hammer on HTTP %i (one attempt, retriable later: %s)',
    async (status, retriable) => {
      const h = harness({steps: [{status}]});
      const result = await syncOrder(makeOrder(), h.deps);
      expect(result).toEqual({
        status: 'failed',
        reason: 'http',
        retriable,
        orderId: '7001',
        attempts: 1,
        httpStatus: status,
      });
      expect(h.calls).toHaveLength(1);
      expect(h.sleeps).toEqual([]);
    },
  );

  it.each([[500], [502], [503], [504], [408], [429]])(
    'retries HTTP %i',
    async (status) => {
      const h = harness({steps: [{status}, {status: 200}]});
      expect(await syncOrder(makeOrder(), h.deps)).toMatchObject({
        status: 'synced',
        attempts: 2,
      });
    },
  );

  it('never throws, whatever the transport does', async () => {
    const h = harness({steps: ['network', 'network', 'network', 'network']});
    await expect(syncOrder(makeOrder(), h.deps)).resolves.toMatchObject({
      status: 'failed',
      reason: 'network',
      retriable: true,
    });
  });
});

describe('syncOrder: circuit breaker (NFR-013)', () => {
  it('stops calling Extend while the circuit is open and resumes after a successful probe', async () => {
    const h = harness({
      withBreaker: true,
      retry: {maxAttempts: 1},
      steps: [{status: 503}, {status: 503}],
    });
    expect(await syncOrder(makeOrder(), h.deps)).toMatchObject({
      status: 'failed',
      reason: 'http',
    });
    expect(await syncOrder(makeOrder(), h.deps)).toMatchObject({
      status: 'failed',
      reason: 'http',
    });
    expect(h.calls).toHaveLength(2);

    expect(await syncOrder(makeOrder(), h.deps)).toEqual({
      status: 'failed',
      reason: 'circuit_open',
      retriable: true,
      orderId: '7001',
      attempts: 0,
    });
    expect(h.calls).toHaveLength(2);

    h.clock.t += 60_000;
    expect((await syncOrder(makeOrder(), h.deps)).status).toBe('synced');
    expect(h.calls).toHaveLength(3);
    expect(h.breaker?.snapshot().state).toBe('closed');
  });
});

describe('syncOrder: own retries open the circuit (NFR-013)', () => {
  it('reports the real cause, not "circuit_open", when its own failed attempts opened the circuit', async () => {
    const h = harness({
      withBreaker: true, // threshold 2
      retry: {maxAttempts: 4},
      steps: Array.from({length: 4}, () => ({status: 500})),
    });
    const result = await syncOrder(makeOrder(), h.deps);
    expect(result).toEqual({
      status: 'failed',
      reason: 'http',
      httpStatus: 500,
      retriable: true,
      orderId: '7001',
      attempts: 2,
    });
    expect(h.calls).toHaveLength(2);
    expect(h.logs.at(-1)).toMatchObject({
      level: 'error',
      event: 'sync.gave_up',
      reason: 'http',
      httpStatus: 500,
      attempt: 3,
    });
  });
});

describe('syncOrder: logging (T-05)', () => {
  it('logs ids and reasons only: no names, emails, phones, addresses or tokens, on success or failure', async () => {
    const scenarios: Step[][] = [
      [{status: 200}],
      [{status: 500}, {status: 500}, {status: 500}, {status: 500}],
    ];
    for (const steps of scenarios) {
      const h = harness({steps});
      await syncOrder(makeOrder(), h.deps);
      await syncOrder(
        makeOrder({
          lineItems: [
            mattressLine(),
            coverageLine({parentLineItemId: null, attributes: {}}),
          ],
        }),
        h.deps,
      );
      const text = JSON.stringify(h.logs);
      expect(h.logs.length).toBeGreaterThan(0);
      for (const secret of [
        TOKEN,
        SYNTHETIC_PII.name,
        SYNTHETIC_PII.email,
        SYNTHETIC_PII.phone,
        SYNTHETIC_PII.billingStreet,
        SYNTHETIC_PII.shippingStreet,
        SYNTHETIC_PII.postalCode,
      ]) {
        expect(text).not.toContain(secret);
      }
      for (const event of h.logs) {
        expect(
          Object.keys(event).every((key) =>
            [
              'level',
              'event',
              'orderId',
              'lineIds',
              'planIds',
              'reason',
              'httpStatus',
              'attempt',
              'count',
            ].includes(key),
          ),
        ).toBe(true);
      }
    }
  });

  it('logs the success with order and plan ids', async () => {
    const h = harness();
    await syncOrder(makeOrder(), h.deps);
    expect(h.logs).toEqual([
      {
        level: 'info',
        event: 'sync.succeeded',
        planIds: [GOOD_PLAN_ID],
        attempt: 1,
        orderId: '7001',
      },
    ]);
  });
});

describe('backoffDelayMs', () => {
  const policy = {...DEFAULT_RETRY_POLICY, baseDelayMs: 500, maxDelayMs: 8000};

  it.each([
    [1, 1, 500],
    [2, 1, 1000],
    [3, 1, 2000],
    [4, 1, 4000],
    [5, 1, 8000],
    [9, 1, 8000],
    [1, 0, 250],
    [3, 0, 1000],
    [2, 0.5, 750],
  ])('attempt %i, random %d -> %i ms', (attempt, random, expected) => {
    expect(backoffDelayMs(attempt, policy, () => random)).toBe(expected);
  });

  it('stretches to Retry-After but never beyond the cap', () => {
    expect(backoffDelayMs(1, policy, () => 1, 3000)).toBe(3000);
    expect(backoffDelayMs(1, policy, () => 1, 600_000)).toBe(8000);
    expect(backoffDelayMs(3, policy, () => 1, 100)).toBe(2000);
  });
});
