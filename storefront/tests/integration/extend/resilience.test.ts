// Failure behaviour against the local MOCK (NFR-013, T-13, REQ-EXT-001, REQ-EXT-003): Extend slow, down, broken or
// refusing us must hide the offer and be retried or reported; it must never throw into, or block, the caller.

import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import type {ExtendMock} from '../../../../scripts/mocks/extend-mock.mjs';
import {createCircuitBreaker} from '~/lib/extend/circuit-breaker';
import type {ExtendLogEvent} from '~/lib/extend/log';
import {fetchOffers, type OfferItem} from '~/lib/extend/offers';
import {syncOrder} from '~/lib/extend/sync';
import {
  coverageLine,
  makeOrder,
  mattressLine,
} from '~/lib/extend/test-fixtures';
import {
  ELIGIBLE_CATEGORIES,
  TOKEN,
  configFor,
  putsTo,
  realFetch,
  startTestMock,
  syncHarness,
} from './support';

let mock: ExtendMock;
beforeEach(async () => {
  mock = await startTestMock();
});
afterEach(async () => {
  await mock.close();
});

const item: OfferItem = {
  category: 'mattress',
  productId: '501',
  purchasePriceCents: 129_900,
  quantity: 1,
};

describe('offers: Extend refuses, stalls or breaks (NFR-013)', () => {
  it('hides the offer on a wrong access token (401), without leaking the token to the log', async () => {
    const logs: ExtendLogEvent[] = [];
    const result = await fetchOffers(
      {
        config: configFor(mock, {
          EXTEND_ACCESS_TOKEN: 'a-token-the-mock-rejects',
        }),
        fetch: realFetch,
        log: (e) => logs.push(e),
      },
      [item],
      ELIGIBLE_CATEGORIES,
    );
    expect(result).toMatchObject({
      status: 'error',
      reason: 'http',
      httpStatus: 401,
    });
    const text = JSON.stringify(logs);
    expect(text).not.toContain('a-token-the-mock-rejects');
    expect(text).not.toContain(TOKEN);
  });

  it('hides the offer on a wrong store id (400 from the provider)', async () => {
    const result = await fetchOffers(
      {
        config: configFor(mock, {EXTEND_STORE_ID: 'someone-elses-store'}),
        fetch: realFetch,
      },
      [item],
      ELIGIBLE_CATEGORIES,
    );
    expect(result).toMatchObject({
      status: 'error',
      reason: 'http',
      httpStatus: 400,
    });
  });

  it('times out a slow provider and leaves the caller free to render without an offer', async () => {
    mock.setFault({path: '/offers', delayMs: 1500});
    const started = Date.now();
    const result = await fetchOffers(
      {config: configFor(mock), fetch: realFetch, timeoutMs: 60},
      [item],
      ELIGIBLE_CATEGORIES,
    );
    expect(result).toMatchObject({status: 'error', reason: 'timeout'});
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it.each([
    ['HTML from a gateway', '<html>502 Bad Gateway</html>'],
    ['an empty body', ''],
    ['JSON of the wrong shape', '{"offers":"none"}'],
    [
      'offers with a non-integer price',
      JSON.stringify({
        offerCartId: 'x',
        storeId: 'store-integration-1',
        currency: 'USD',
        offers: [
          {
            offerId: 'o',
            plans: {
              adh: [
                {
                  id: 'P1',
                  price: 79.99,
                  title: 't',
                  url: 'https://example.invalid/t',
                },
              ],
              base: [],
            },
            coveredProducts: [
              {productId: '501', quantity: 1, purchasePrice: 129900},
            ],
          },
        ],
      }),
    ],
    [
      'offers covering a product we never asked about',
      JSON.stringify({
        offerCartId: 'x',
        storeId: 'store-integration-1',
        currency: 'USD',
        offers: [
          {
            offerId: 'o',
            plans: {
              adh: [
                {
                  id: 'P1',
                  price: 7999,
                  title: 't',
                  url: 'https://example.invalid/t',
                },
              ],
              base: [],
            },
            coveredProducts: [
              {productId: '999', quantity: 1, purchasePrice: 129900},
            ],
          },
        ],
      }),
    ],
  ])(
    'hides the offer when the provider answers 200 with %s',
    async (_label, body) => {
      mock.setFault({path: '/offers', body});
      const result = await fetchOffers(
        {config: configFor(mock), fetch: realFetch},
        [item],
        ELIGIBLE_CATEGORIES,
      );
      expect(result).toMatchObject({status: 'error', reason: 'malformed'});
    },
  );

  it('an empty "offers" array is a valid answer, not a failure', async () => {
    mock.setFault({
      path: '/offers',
      body: JSON.stringify({
        offerCartId: 'x',
        storeId: 'store-integration-1',
        currency: 'USD',
        offers: [],
      }),
    });
    expect(
      await fetchOffers(
        {config: configFor(mock), fetch: realFetch},
        [item],
        ELIGIBLE_CATEGORIES,
      ),
    ).toMatchObject({status: 'ok', offers: []});
  });

  it('survives Extend being completely down (connection refused)', async () => {
    const config = configFor(mock);
    await mock.close();
    const result = await fetchOffers(
      {config, fetch: realFetch, timeoutMs: 500},
      [item],
      ELIGIBLE_CATEGORIES,
    );
    expect(result).toMatchObject({status: 'error', reason: 'network'});
    mock = await startTestMock(); // so afterEach has something to close
  });

  it('never rejects, whatever the provider does', async () => {
    for (const fault of [
      {status: 500},
      {status: 429},
      {body: 'x'},
      {delayMs: 200},
    ]) {
      mock.setFault({path: '/offers', ...fault});
      await expect(
        fetchOffers(
          {config: configFor(mock), fetch: realFetch, timeoutMs: 50},
          [item],
          ELIGIBLE_CATEGORIES,
        ),
      ).resolves.toMatchObject({status: 'error'});
    }
  });
});

describe('offers: circuit breaker against real failures (NFR-013, T-13)', () => {
  it('opens after consecutive failures, stops calling the mock, and closes after a successful probe', async () => {
    const clock = {t: 0};
    const logs: ExtendLogEvent[] = [];
    const breaker = createCircuitBreaker({
      now: () => clock.t,
      failureThreshold: 3,
      openMs: 30_000,
    });
    const deps = {
      config: configFor(mock),
      fetch: realFetch,
      breaker,
      log: (e: ExtendLogEvent) => logs.push(e),
    };
    const ask = () => fetchOffers(deps, [item], ELIGIBLE_CATEGORIES);
    const offerRequests = () =>
      mock.state.requests.filter((r) => r.path === '/offers').length;

    mock.setFault({path: '/offers', status: 503});
    for (let i = 0; i < 3; i += 1)
      expect(await ask()).toMatchObject({reason: 'http', httpStatus: 503});
    expect(offerRequests()).toBe(3);
    expect(logs.filter((e) => e.event === 'offers.circuit_open')).toHaveLength(
      1,
    );

    // Open: the mock is not contacted at all, however many page views arrive.
    for (let i = 0; i < 10; i += 1)
      expect(await ask()).toMatchObject({reason: 'circuit_open'});
    expect(offerRequests()).toBe(3);

    // The provider recovers, but the circuit stays shut until the period ends.
    mock.clearFault();
    clock.t += 29_999;
    expect(await ask()).toMatchObject({reason: 'circuit_open'});

    clock.t += 1;
    expect((await ask()).status).toBe('ok'); // the probe succeeds and closes the circuit
    expect(offerRequests()).toBe(4);
    expect(breaker.snapshot().state).toBe('closed');
    expect((await ask()).status).toBe('ok');
    expect(offerRequests()).toBe(5);
  });

  it('a failed probe re-opens the circuit for a full period', async () => {
    const clock = {t: 0};
    const breaker = createCircuitBreaker({
      now: () => clock.t,
      failureThreshold: 2,
      openMs: 10_000,
    });
    const deps = {config: configFor(mock), fetch: realFetch, breaker};
    mock.setFault({path: '/offers', status: 500});
    await fetchOffers(deps, [item], ELIGIBLE_CATEGORIES);
    await fetchOffers(deps, [item], ELIGIBLE_CATEGORIES);
    clock.t += 10_000;
    expect(await fetchOffers(deps, [item], ELIGIBLE_CATEGORIES)).toMatchObject({
      reason: 'http',
      httpStatus: 500,
    }); // probe
    expect(await fetchOffers(deps, [item], ELIGIBLE_CATEGORIES)).toMatchObject({
      reason: 'circuit_open',
    });
  });

  it('a misconfigured token (401) also opens the circuit instead of hammering Extend with a bad credential', async () => {
    const breaker = createCircuitBreaker({
      now: () => 0,
      failureThreshold: 2,
      openMs: 10_000,
    });
    const deps = {
      config: configFor(mock, {EXTEND_ACCESS_TOKEN: 'bad-token-value'}),
      fetch: realFetch,
      breaker,
    };
    await fetchOffers(deps, [item], ELIGIBLE_CATEGORIES);
    await fetchOffers(deps, [item], ELIGIBLE_CATEGORIES);
    expect(await fetchOffers(deps, [item], ELIGIBLE_CATEGORIES)).toMatchObject({
      reason: 'circuit_open',
    });
    expect(
      mock.state.requests.filter((r) => r.path === '/offers'),
    ).toHaveLength(2);
  });
});

describe('order sync: failures and recovery (REQ-EXT-003, NFR-006)', () => {
  it('retries a transient 503 with backoff and succeeds, delivering the same snapshot once', async () => {
    mock.setFault({path: '/orders', status: 503, remaining: 2});
    const h = syncHarness(mock);
    const result = await syncOrder(makeOrder(), h.deps);
    expect(result).toMatchObject({status: 'synced', attempts: 3});
    expect(h.sleeps).toEqual([500, 1000]);
    expect(putsTo(mock).map((r) => r.status)).toEqual([503, 503, 200]);
    expect(mock.state.eventTypes()).toEqual(['order_created']);
  });

  it('a timeout after Extend applied the request is safe to retry (idempotent): one order, no duplicate contract', async () => {
    const fulfilled = makeOrder({
      lineItems: [mattressLine({fulfilledQuantity: 1}), coverageLine()],
    });
    const h = syncHarness(mock);
    await syncOrder(fulfilled, h.deps);
    // The provider applied it but the client never saw the answer: simulate by re-sending after a timeout.
    mock.setFault({path: '/orders', delayMs: 800, remaining: 1});
    const slow = syncHarness(mock, {timeoutMs: 80});
    expect(await syncOrder(fulfilled, slow.deps)).toMatchObject({
      status: 'synced',
      attempts: 2,
    });
    expect(mock.state.contracts('7001')).toHaveLength(1);
    expect(
      mock.state.eventTypes().filter((t) => t === 'contract_created'),
    ).toHaveLength(1);
  });

  it('gives up after the bounded attempts when Extend stays down, and reports it as retriable', async () => {
    mock.setFault({path: '/orders', status: 500});
    const h = syncHarness(mock);
    const result = await syncOrder(makeOrder(), h.deps);
    // The harness breaker opens after 3 failures, which ends the 4th attempt; the real cause is still reported.
    expect(result).toEqual({
      status: 'failed',
      reason: 'http',
      httpStatus: 500,
      retriable: true,
      orderId: '7001',
      attempts: 3,
    });
    expect(putsTo(mock)).toHaveLength(3);
    expect(h.logs.at(-1)).toMatchObject({
      level: 'error',
      event: 'sync.gave_up',
      reason: 'http',
      httpStatus: 500,
      orderId: '7001',
    });
    expect(mock.state.orders.size).toBe(0);
  });

  it('a later replay recovers a sync that failed (the Shopify webhook retry path)', async () => {
    mock.setFault({path: '/orders', status: 500});
    const h = syncHarness(mock, {maxAttempts: 1});
    expect(await syncOrder(makeOrder(), h.deps)).toMatchObject({
      status: 'failed',
      retriable: true,
    });
    mock.clearFault();
    expect(await syncOrder(makeOrder(), syncHarness(mock).deps)).toMatchObject({
      status: 'synced',
    });
    expect(mock.state.eventTypes()).toEqual(['order_created']);
  });

  it('a wrong token fails at the quote lookup, before any order is sent, is retriable, and logs no secrets', async () => {
    const h = syncHarness(mock, {
      env: {EXTEND_ACCESS_TOKEN: 'bad-token-value'},
    });
    const result = await syncOrder(makeOrder(), h.deps);
    expect(result).toMatchObject({
      status: 'failed',
      reason: 'quote_lookup_failed',
      retriable: true,
      attempts: 0,
    });
    expect(putsTo(mock)).toHaveLength(0);
    expect(JSON.stringify(h.logs)).not.toContain('bad-token-value');
    expect(mock.state.orders.size).toBe(0);
  });

  it('a 401 on PUT /orders fails once without hammering, is retriable after an operator fixes the credential', async () => {
    mock.setFault({path: '/orders', status: 401});
    const h = syncHarness(mock);
    const result = await syncOrder(makeOrder(), h.deps);
    expect(result).toEqual({
      status: 'failed',
      reason: 'http',
      httpStatus: 401,
      retriable: true,
      orderId: '7001',
      attempts: 1,
    });
    expect(putsTo(mock)).toHaveLength(1);
    expect(h.sleeps).toEqual([]);
    expect(JSON.stringify(h.logs)).not.toContain(TOKEN);
  });

  it('a 400 from the provider (a bug on our side) is not retried and is not retriable', async () => {
    const h = syncHarness(mock);
    // A request the provider rejects as invalid: the store id in the snapshot is not this merchant's.
    const result = await syncOrder(makeOrder(), {
      ...h.deps,
      config: configFor(mock, {EXTEND_STORE_ID: 'wrong-store'}),
    });
    expect(result).toMatchObject({
      status: 'failed',
      reason: 'http',
      httpStatus: 400,
      retriable: false,
      attempts: 1,
    });
  });

  it('when offers cannot be asked, sync fails as retriable and sends nothing (an outage is not a verdict)', async () => {
    mock.setFault({path: '/offers', status: 503});
    const h = syncHarness(mock);
    const result = await syncOrder(makeOrder(), h.deps);
    expect(result).toMatchObject({
      status: 'failed',
      reason: 'quote_lookup_failed',
      retriable: true,
    });
    expect(putsTo(mock)).toHaveLength(0);
    expect(mock.state.orders.size).toBe(0);
  });

  it('opens the sync circuit after repeated failures and stops calling Extend', async () => {
    mock.setFault({path: '/orders', status: 503});
    const h = syncHarness(mock, {maxAttempts: 3});
    expect(await syncOrder(makeOrder(), h.deps)).toMatchObject({
      status: 'failed',
      attempts: 3,
    });
    expect(await syncOrder(makeOrder(), h.deps)).toMatchObject({
      status: 'failed',
      reason: 'circuit_open',
      retriable: true,
      attempts: 0,
    });
    expect(putsTo(mock)).toHaveLength(3);
    mock.clearFault();
    h.clock.t += 60_000;
    expect(await syncOrder(makeOrder(), h.deps)).toMatchObject({
      status: 'synced',
    });
  });

  it('a provider that never answers in time makes the sync time out and give up rather than hang', async () => {
    mock.setFault({path: '/orders', delayMs: 600});
    const h = syncHarness(mock, {timeoutMs: 60, maxAttempts: 2});
    const started = Date.now();
    expect(await syncOrder(makeOrder(), h.deps)).toMatchObject({
      status: 'failed',
      reason: 'timeout',
      retriable: true,
      attempts: 2,
    });
    expect(Date.now() - started).toBeLessThan(1500);
  });
});
