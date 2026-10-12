// Whole Extend lifecycle through the real library against the local MOCK (ADR-0009, REQ-EXT-001 to REQ-EXT-005).
// Mock-green is NOT evidence of Extend's behaviour: the same suite must pass against the demo host (V-11, P5A-12).

import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import type {ExtendMock} from '../../../../scripts/mocks/extend-mock.mjs';
import {parseExtendConfig} from '~/lib/extend/config';
import {
  fetchOffers,
  quotesFromOffers,
  type OfferItem,
} from '~/lib/extend/offers';
import {listQuoteQueries, type ShopifyOrderLike} from '~/lib/extend/orders';
import {matchPlansToPricePoints} from '~/lib/extend/price-points';
import {reconcile} from '~/lib/extend/reconcile';
import {syncOrder} from '~/lib/extend/sync';
import type {PlanQuote} from '~/lib/extend/types';
import {
  GOOD_PLAN_ID,
  coverageLine,
  makeOrder,
  mattressLine,
} from '~/lib/extend/test-fixtures';
import {
  ELIGIBLE_CATEGORIES,
  STORE_ID,
  TOKEN,
  configFor,
  fixturePricePointIndex,
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

const mattress: OfferItem = {
  category: 'mattress',
  productId: '501',
  purchasePriceCents: 129_900,
  quantity: 1,
};

/** Reconcile the mock's state against Shopify, using real quotes from the mock's Offers API (as production would). */
async function reconcileAgainstMock(orders: ShopifyOrderLike[]) {
  const h = syncHarness(mock);
  const quotes = new Map<string, Map<string, PlanQuote | null>>();
  for (const order of orders) {
    const perLine = new Map<string, PlanQuote | null>();
    for (const {lineId, query} of listQuoteQueries(order)) {
      perLine.set(lineId, await h.deps.lookupQuote(query));
    }
    quotes.set(order.id, perLine);
  }
  return reconcile(orders, mock.state.storedOrders(), {
    storeId: STORE_ID,
    quotesForOrder: (order) => quotes.get(order.id) ?? new Map(),
  });
}

describe('offers through the mock (REQ-EXT-001, REQ-EXT-002, REQ-EXT-005)', () => {
  it('fetches documented-shape offers and keeps only plans with an exact price-point variant', async () => {
    const result = await fetchOffers(
      {config: configFor(mock), fetch: realFetch},
      [{...mattress, purchasePriceCents: 250_000}],
      ELIGIBLE_CATEGORIES,
    );
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.offerCartId).toMatch(/^MOCK-OFFERCART-/);
    const offer = result.offers[0];
    if (offer === undefined) throw new Error('expected an offer');
    // Mock quotes 129.99, 149.99 and 177.77; the catalog fixture has no 177.77 price point.
    expect(offer.plans.adh.map((plan) => plan.priceCents)).toEqual([
      12_999, 14_999, 17_777,
    ]);
    const match = matchPlansToPricePoints(offer, fixturePricePointIndex());
    expect(match.matched.map((m) => m.plan.id)).toEqual([
      'MOCK-MATT-ADH-3Y-D',
      'MOCK-MATT-ADH-5Y-D',
    ]);
    expect(match.hidden).toEqual([
      {
        planId: 'MOCK-MATT-ADH-7Y-D-UNLISTED',
        priceCents: 17_777,
        reason: 'no_price_point',
      },
    ]);
    expect(match.matched.every((m) => m.recommended)).toBe(true);
    expect(match.matched.map((m) => m.variantId)).toEqual([
      'gid://shopify/ProductVariant/9100000008',
      'gid://shopify/ProductVariant/9100000009',
    ]);
  });

  it('every offered plan carries a terms link and id the UI needs (REQ-EXT-004 inputs)', async () => {
    const result = await fetchOffers(
      {config: configFor(mock), fetch: realFetch},
      [mattress],
      ELIGIBLE_CATEGORIES,
    );
    if (result.status !== 'ok') throw new Error('expected ok');
    for (const plan of result.offers.flatMap((o) => [
      ...o.plans.adh,
      ...o.plans.base,
    ])) {
      expect(plan.url).toMatch(/^https:\/\//);
      expect(plan.id).toMatch(/^MOCK-/);
    }
  });

  it('sends only eligible categories to Extend; ineligible products never reach the mock (REQ-EXT-005)', async () => {
    const result = await fetchOffers(
      {config: configFor(mock), fetch: realFetch},
      [mattress, {...mattress, productId: '777', category: 'furniture'}],
      ELIGIBLE_CATEGORIES,
    );
    expect(result).toMatchObject({status: 'ok', ineligibleProductIds: ['777']});
    if (result.status !== 'ok') return;
    expect(result.offers).toHaveLength(1);
    expect(result.offers[0]?.coveredProducts.map((p) => p.productId)).toEqual([
      '501',
    ]);

    const none = await fetchOffers(
      {config: configFor(mock), fetch: realFetch},
      [{...mattress, category: 'furniture'}],
      ELIGIBLE_CATEGORIES,
    );
    expect(none).toMatchObject({status: 'ok', offers: []});
    // Only the first call reached the mock; the ineligible-only call made no request at all.
    expect(
      mock.state.requests.filter((r) => r.path === '/offers'),
    ).toHaveLength(1);
  });

  it('a category the mock has no fixture for yields an empty, valid answer', async () => {
    const result = await fetchOffers(
      {config: configFor(mock), fetch: realFetch},
      [{...mattress, category: 'furniture'}],
      ['furniture'],
    );
    expect(result).toMatchObject({status: 'ok', offers: []});
  });

  it('plan quotes derived from a live response agree with what the mock offered', async () => {
    const result = await fetchOffers(
      {config: configFor(mock), fetch: realFetch},
      [mattress],
      ELIGIBLE_CATEGORIES,
    );
    if (result.status !== 'ok') throw new Error('expected ok');
    const {quotes, conflictingPlanIds} = quotesFromOffers(result.offers);
    expect(conflictingPlanIds).toEqual([]);
    expect(quotes.get(GOOD_PLAN_ID)?.priceCents).toBe(7999);
    expect(quotes.get('MOCK-MATT-BASE-3Y-C')?.priceCents).toBe(5999);
  });
});

describe('order lifecycle through the mock (REQ-EXT-003)', () => {
  const unfulfilled = () => makeOrder();
  const fulfilled = () =>
    makeOrder({
      lineItems: [mattressLine({fulfilledQuantity: 1}), coverageLine()],
    });

  it('create: reports the order, no contract before fulfilment', async () => {
    const h = syncHarness(mock);
    const result = await syncOrder(unfulfilled(), h.deps);
    expect(result).toMatchObject({
      status: 'synced',
      orderId: '7001',
      attempts: 1,
      planIds: [GOOD_PLAN_ID],
    });
    expect(mock.state.eventTypes()).toEqual(['order_created']);
    expect(mock.state.contracts('7001')).toEqual([]);
    expect(putsTo(mock).map((r) => r.status)).toEqual([200]);
  });

  it('create sends the full documented snapshot over the wire', async () => {
    const h = syncHarness(mock);
    await syncOrder(unfulfilled(), h.deps);
    const [stored] = mock.state.storedOrders();
    expect(stored?.snapshot).toMatchObject({
      transactionId: '7001',
      storeId: STORE_ID,
      currency: 'USD',
      total: 137_899,
      lineItems: [
        {
          lineItemTransactionId: '1001',
          quantity: 1,
          fulfilledQuantity: 0,
          product: {
            id: '501',
            category: 'mattress',
            listPrice: 129_900,
            purchasePrice: 129_900,
          },
        },
        {
          type: 'category_contract',
          lineItemTransactionId: '1002-contract',
          plan: {id: GOOD_PLAN_ID, purchasePrice: 7999},
          coveredProducts: [
            {lineItemTransactionId: '1001', productId: '501', quantity: 1},
          ],
        },
      ],
    });
  });

  it('fulfil: issues exactly one contract when fulfilledQuantity goes 0 -> positive', async () => {
    const h = syncHarness(mock);
    await syncOrder(unfulfilled(), h.deps);
    await syncOrder(fulfilled(), h.deps);
    expect(mock.state.eventTypes()).toEqual([
      'order_created',
      'order_updated',
      'contract_created',
    ]);
    expect(mock.state.contracts('7001')).toEqual([
      expect.objectContaining({
        contractId: 'MOCK-CONTRACT-0001',
        planId: GOOD_PLAN_ID,
        status: 'active',
      }),
    ]);
  });

  it('replay: syncing the same state again is a no-op on the provider (idempotent)', async () => {
    const h = syncHarness(mock);
    await syncOrder(fulfilled(), h.deps);
    const eventsAfterFirst = mock.state.eventTypes();
    for (let i = 0; i < 3; i += 1) {
      expect(await syncOrder(fulfilled(), h.deps)).toMatchObject({
        status: 'synced',
      });
    }
    expect(mock.state.eventTypes()).toEqual(eventsAfterFirst);
    expect(mock.state.contracts('7001')).toHaveLength(1);
    expect(putsTo(mock).map((r) => r.noop)).toEqual([false, true, true, true]);
  });

  it('out-of-order delivery converges: late "paid" after "fulfilled" does not undo fulfilment', async () => {
    // Webhooks are only a trigger; each run re-reads the order, so a stale trigger syncs the CURRENT state.
    const h = syncHarness(mock);
    await syncOrder(fulfilled(), h.deps);
    await syncOrder(fulfilled(), h.deps);
    expect(mock.state.contracts('7001')).toHaveLength(1);
    expect(mock.state.storedOrders()[0]?.snapshot).toMatchObject({
      lineItems: [{fulfilledQuantity: 1}, {fulfilledQuantity: 1}],
    });
  });

  it('partial refund: reduces quantity and coveredProducts and updates the contract', async () => {
    const h = syncHarness(mock);
    const two = (extra: Partial<ShopifyOrderLike> = {}, refunded = 0) =>
      makeOrder({
        totalCents: 275_000,
        ...extra,
        lineItems: [
          mattressLine({
            quantity: 2,
            fulfilledQuantity: 2,
            refundedQuantity: refunded,
          }),
          coverageLine({quantity: 2, refundedQuantity: refunded}),
        ],
      });
    await syncOrder(two(), h.deps);
    expect(mock.state.contracts('7001')[0]?.coveredProducts).toEqual([
      expect.objectContaining({quantity: 2}),
    ]);
    const refunded = await syncOrder(two({refundState: 'partial'}, 1), h.deps);
    expect(refunded).toMatchObject({status: 'synced'});
    expect(mock.state.contracts('7001')[0]).toMatchObject({
      status: 'active',
      coveredProducts: [{quantity: 1}],
    });
    expect(mock.state.eventTypes()).toContain('contract_updated');
  });

  it('refunding only the coverage removes the line and cancels its contract; the product stays', async () => {
    const h = syncHarness(mock);
    await syncOrder(fulfilled(), h.deps);
    const coverageRefunded = makeOrder({
      refundState: 'partial',
      lineItems: [
        mattressLine({fulfilledQuantity: 1}),
        coverageLine({refundedQuantity: 1}),
      ],
    });
    // The refunded coverage line is a removal, not an anomaly: the snapshot omits it and nothing is flagged.
    expect(await syncOrder(coverageRefunded, h.deps)).toMatchObject({
      status: 'synced',
      planIds: [],
      flagged: [],
    });
    expect(mock.state.contracts('7001')[0]).toMatchObject({
      status: 'cancelled',
    });
    expect(
      mock.state
        .storedOrders()[0]
        ?.snapshot.lineItems.map((l) => l.lineItemTransactionId),
    ).toEqual(['1001']);
    expect(mock.state.storedOrders()[0]?.snapshot).not.toHaveProperty('status');
  });

  it('full refund: status "refunded" refunds the contract', async () => {
    const h = syncHarness(mock);
    await syncOrder(fulfilled(), h.deps);
    const full = makeOrder({
      refundState: 'full',
      lineItems: [
        mattressLine({fulfilledQuantity: 1, refundedQuantity: 1}),
        coverageLine({refundedQuantity: 1}),
      ],
    });
    expect(await syncOrder(full, h.deps)).toMatchObject({status: 'synced'});
    expect(mock.state.storedOrders()[0]?.snapshot).toMatchObject({
      status: 'refunded',
    });
    expect(mock.state.contracts('7001')[0]).toMatchObject({status: 'refunded'});
    expect(mock.state.eventTypes()).toContain('contract_refunded');
    // Replaying the refund is a no-op, and a stale un-refunded sync cannot resurrect the contract.
    await syncOrder(full, h.deps);
    await syncOrder(fulfilled(), h.deps);
    expect(mock.state.contracts('7001')[0]).toMatchObject({status: 'refunded'});
  });

  it('cancel: a cancelled order is reported as refunded (ASSUMPTION(V-11): no documented cancelled status)', async () => {
    const h = syncHarness(mock);
    await syncOrder(unfulfilled(), h.deps);
    const cancelled = makeOrder({
      cancelledAt: '2026-10-02T08:00:00Z',
      lineItems: [
        mattressLine({refundedQuantity: 1}),
        coverageLine({refundedQuantity: 1}),
      ],
    });
    expect(await syncOrder(cancelled, h.deps)).toMatchObject({
      status: 'synced',
    });
    expect(mock.state.storedOrders()[0]?.snapshot).toMatchObject({
      status: 'refunded',
    });
  });

  it('cancel after fulfilment refunds the issued contract', async () => {
    const h = syncHarness(mock);
    await syncOrder(fulfilled(), h.deps);
    const cancelled = makeOrder({
      cancelledAt: '2026-10-09T08:00:00Z',
      lineItems: [
        mattressLine({fulfilledQuantity: 1, refundedQuantity: 1}),
        coverageLine({refundedQuantity: 1}),
      ],
    });
    await syncOrder(cancelled, h.deps);
    expect(mock.state.contracts('7001')[0]).toMatchObject({status: 'refunded'});
  });

  it('two orders stay independent', async () => {
    const h = syncHarness(mock);
    await syncOrder(fulfilled(), h.deps);
    const other = makeOrder({
      id: '7002',
      lineItems: [
        mattressLine({id: '2001'}),
        coverageLine({id: '2002', parentLineItemId: '2001'}),
      ],
    });
    const quoted = syncHarness(mock);
    await syncOrder(other, quoted.deps);
    expect(
      mock.state
        .storedOrders()
        .map((o) => o.snapshot.transactionId)
        .sort(),
    ).toEqual(['7001', '7002']);
    expect(mock.state.contracts('7001')).toHaveLength(1);
    expect(mock.state.contracts('7002')).toHaveLength(0);
  });
});

describe('cross-check keeps hostile coverage away from Extend (ADR-0009 decision 7, T-06)', () => {
  it('a cheap price-point SKU claiming an expensive plan id is flagged and never sent', async () => {
    const h = syncHarness(mock);
    const attack = makeOrder({
      lineItems: [
        mattressLine(),
        coverageLine({
          sku: 'Extend-Protection-Plan-14.99',
          variantTitle: 'Extend-Protection-Plan-14.99',
          unitPriceCents: 1499,
          paidUnitPriceCents: 1499,
          attributes: {
            _extend_plan_id: 'MOCK-MATT-ADH-5Y-C',
            _extend_covered_product_id: '501',
          },
        }),
      ],
    });
    const result = await syncOrder(attack, h.deps);
    expect(result).toMatchObject({
      status: 'skipped',
      reason: 'all_coverage_flagged',
      flagged: [{lineId: '1002', reason: 'price_mismatch'}],
    });
    expect(mock.state.orders.size).toBe(0);
    expect(putsTo(mock)).toHaveLength(0);
  });

  it('a plan id Extend never offered for the product is flagged against the live Offers API', async () => {
    const h = syncHarness(mock);
    const invented = makeOrder({
      lineItems: [
        mattressLine(),
        coverageLine({
          attributes: {
            _extend_plan_id: 'MADE-UP-PLAN',
            _extend_covered_product_id: '501',
          },
        }),
      ],
    });
    expect(await syncOrder(invented, h.deps)).toMatchObject({
      status: 'skipped',
      flagged: [{lineId: '1002', reason: 'unknown_plan'}],
    });
    expect(mock.state.orders.size).toBe(0);
  });

  it('a plan from another price band (valid plan, wrong product price) is flagged', async () => {
    const h = syncHarness(mock);
    const wrongBand = makeOrder({
      lineItems: [
        mattressLine(),
        coverageLine({
          attributes: {
            _extend_plan_id: 'MOCK-MATT-ADH-3Y-A',
            _extend_covered_product_id: '501',
          },
        }),
      ],
    });
    expect(await syncOrder(wrongBand, h.deps)).toMatchObject({
      status: 'skipped',
      flagged: [{reason: 'unknown_plan'}],
    });
  });

  it('coverage whose covered product is not in the order is flagged and never sent', async () => {
    const h = syncHarness(mock);
    const alone = makeOrder({
      lineItems: [
        mattressLine({id: '1001', productId: '999', category: null}),
        coverageLine({parentLineItemId: null}),
      ],
    });
    const result = await syncOrder(alone, h.deps);
    expect(result).toMatchObject({
      status: 'skipped',
      flagged: [{lineId: '1002'}],
    });
    expect(mock.state.orders.size).toBe(0);
  });

  it('good and bad coverage in one order: only the good line is sent', async () => {
    const h = syncHarness(mock);
    const second = mattressLine({
      id: '1003',
      productId: '503',
      variantId: 'v-2',
    });
    const mixed = makeOrder({
      lineItems: [
        mattressLine(),
        second,
        coverageLine(),
        coverageLine({
          id: '1004',
          parentLineItemId: '1003',
          attributes: {
            _extend_plan_id: 'MADE-UP-PLAN',
            _extend_covered_product_id: '503',
          },
        }),
      ],
    });
    // The mock offers by product id echo, so product 503 at 1299.00 is a legitimate lookup that does not know the plan.
    expect(await syncOrder(mixed, h.deps)).toMatchObject({
      status: 'synced',
      planIds: [GOOD_PLAN_ID],
      flagged: [{lineId: '1004', reason: 'unknown_plan'}],
    });
    const sent = JSON.stringify(mock.state.storedOrders()[0]?.snapshot);
    expect(sent).not.toContain('MADE-UP-PLAN');
    expect(sent).not.toContain('1004');
  });
});

describe('order sync modes (ADR-0009: EXTEND_ORDER_SYNC)', () => {
  it.each([['extend-app'], ['off']])(
    '%s: nothing reaches Extend',
    async (mode) => {
      const h = syncHarness(mock, {env: {EXTEND_ORDER_SYNC: mode}});
      expect(await syncOrder(makeOrder(), h.deps)).toMatchObject({
        status: 'skipped',
      });
      expect(mock.state.requests).toHaveLength(0);
    },
  );

  it('flag off: sync is skipped with the default config, so no request is made (NFR-013)', async () => {
    const h = syncHarness(mock, {env: {PUBLIC_EXTEND_ENABLED: 'false'}});
    expect(await syncOrder(makeOrder(), h.deps)).toMatchObject({
      status: 'skipped',
      reason: 'disabled',
    });
    expect(mock.state.requests).toHaveLength(0);
  });

  it('flag off: sync still runs when the caller opts out of the UI flag, so existing coverage orders are not dropped', async () => {
    const h = syncHarness(mock);
    const config = parseExtendConfig(
      {
        PUBLIC_EXTEND_ENABLED: 'false',
        EXTEND_API_HOST: mock.url,
        EXTEND_STORE_ID: STORE_ID,
        EXTEND_ACCESS_TOKEN: TOKEN,
      },
      {requireFlag: false},
    );
    expect(await syncOrder(makeOrder(), {...h.deps, config})).toMatchObject({
      status: 'synced',
    });
    expect(mock.state.eventTypes()).toEqual(['order_created']);
  });
});

describe("reconciliation against the mock's state (REQ-EXT-003, T-06)", () => {
  it('is clean after a full create, fulfil and refund lifecycle', async () => {
    const h = syncHarness(mock);
    const fulfilledOrder = makeOrder({
      lineItems: [mattressLine({fulfilledQuantity: 1}), coverageLine()],
    });
    await syncOrder(makeOrder(), h.deps);
    await syncOrder(fulfilledOrder, h.deps);
    expect((await reconcileAgainstMock([fulfilledOrder])).clean).toBe(true);
  });

  it('reports a missing sync when an order never reached Extend, and a missing contract when fulfilment did not', async () => {
    const h = syncHarness(mock);
    const fulfilledOrder = makeOrder({
      lineItems: [mattressLine({fulfilledQuantity: 1}), coverageLine()],
    });
    expect(
      (await reconcileAgainstMock([fulfilledOrder])).summary.missing_sync,
    ).toBe(1);
    await syncOrder(makeOrder(), h.deps); // synced while unfulfilled; the fulfilment sync was lost
    const report = await reconcileAgainstMock([fulfilledOrder]);
    expect(report.issues.map((i) => i.kind)).toContain('contract_missing');
    await syncOrder(fulfilledOrder, h.deps); // replay recovers it
    expect((await reconcileAgainstMock([fulfilledOrder])).clean).toBe(true);
  });
});
