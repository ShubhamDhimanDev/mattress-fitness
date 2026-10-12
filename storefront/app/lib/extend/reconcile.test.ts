import {describe, expect, it} from 'vitest';
import {normalizeShopifyId} from '~/lib/extend/ids';
import {
  buildOrderSnapshot,
  isCoverageOrderLine,
  type ExtendContractLine,
  type ExtendOrderSnapshot,
  type ShopifyOrderLike,
} from '~/lib/extend/orders';
import {
  reconcile,
  type ExtendStoredOrder,
  type ReconcileKind,
} from '~/lib/extend/reconcile';
import {
  GOOD_PLAN_ID,
  SYNTHETIC_PII,
  coverageLine,
  goodQuotes,
  makeOrder,
  mattressLine,
} from '~/lib/extend/test-fixtures';
import type {PlanQuote} from '~/lib/extend/types';

const STORE = 'store-fixture-1';

const options = {
  storeId: STORE,
  quotesForOrder: (): ReadonlyMap<string, PlanQuote | null> => goodQuotes(),
};

/** A legitimate quote for every coverage line of an order: its own plan id at the price on the line. */
function legitimateQuotes(
  order: ShopifyOrderLike,
): Map<string, PlanQuote | null> {
  const quotes = new Map<string, PlanQuote | null>();
  for (const line of order.lineItems) {
    const key = normalizeShopifyId(line.id);
    if (key !== null && isCoverageOrderLine(line)) {
      quotes.set(key, {planId: GOOD_PLAN_ID, priceCents: line.unitPriceCents});
    }
  }
  return quotes;
}

function snapshotOf(order: ShopifyOrderLike): ExtendOrderSnapshot {
  const built = buildOrderSnapshot(order, {
    storeId: STORE,
    quotesByLineId: legitimateQuotes(order),
  });
  if (built.status !== 'ok') throw new Error('fixture order invalid');
  return built.snapshot;
}

/** What Extend would hold after accepting `order`: its snapshot, plus a contract once a contract line is fulfilled. */
function extendHolds(order: ShopifyOrderLike): ExtendStoredOrder {
  const snapshot = snapshotOf(order);
  const contracts = snapshot.lineItems
    .filter((line): line is ExtendContractLine => 'type' in line)
    .filter(
      (line) => line.fulfilledQuantity > 0 && snapshot.status !== 'refunded',
    )
    .map((line) => ({
      lineItemTransactionId: line.lineItemTransactionId,
      contractId: `C-${line.lineItemTransactionId}`,
    }));
  return {snapshot, contracts};
}

function kinds(report: ReturnType<typeof reconcile>): ReconcileKind[] {
  return report.issues.map((issue) => issue.kind);
}

function contractLine(stored: ExtendStoredOrder): ExtendContractLine {
  const line = stored.snapshot.lineItems.find(
    (candidate): candidate is ExtendContractLine => 'type' in candidate,
  );
  if (line === undefined) throw new Error('fixture has no contract line');
  return line;
}

describe('reconciliation: Shopify versus Extend (REQ-EXT-003, T-06)', () => {
  it('is clean when Extend holds exactly what Shopify reports (unfulfilled, fulfilled, refunded)', () => {
    const orders = [
      makeOrder({id: '7001'}),
      makeOrder({
        id: '7002',
        lineItems: [
          mattressLine({id: '2001', fulfilledQuantity: 1}),
          coverageLine({id: '2002', parentLineItemId: '2001'}),
        ],
      }),
      makeOrder({
        id: '7003',
        refundState: 'full',
        lineItems: [
          mattressLine({id: '3001', refundedQuantity: 1, fulfilledQuantity: 1}),
          coverageLine({
            id: '3002',
            parentLineItemId: '3001',
            refundedQuantity: 1,
          }),
        ],
      }),
    ];
    const report = reconcile(orders, orders.map(extendHolds), {
      storeId: STORE,
      quotesForOrder: legitimateQuotes,
    });
    expect(report).toEqual({
      checkedOrders: 3,
      issues: [],
      clean: true,
      summary: expect.objectContaining({missing_sync: 0, contract_missing: 0}),
    });
  });

  it('ignores Shopify orders that have no coverage and are not in Extend', () => {
    const plain = makeOrder({
      id: '7010',
      lineItems: [mattressLine({id: '4001'})],
    });
    expect(reconcile([plain], [], options).clean).toBe(true);
  });

  describe('mismatches', () => {
    it('missing sync: a Shopify order with coverage that Extend has never received', () => {
      const report = reconcile([makeOrder()], [], options);
      expect(kinds(report)).toEqual(['missing_sync']);
      expect(report.issues[0]).toMatchObject({orderId: '7001'});
      expect(report.clean).toBe(false);
      expect(report.summary.missing_sync).toBe(1);
    });

    it('missing sync: Extend has the order but not the coverage line', () => {
      const stored = extendHolds(makeOrder());
      const withoutContract: ExtendStoredOrder = {
        ...stored,
        snapshot: {
          ...stored.snapshot,
          lineItems: stored.snapshot.lineItems.filter(
            (line) => !('type' in line),
          ),
        },
      };
      const report = reconcile([makeOrder()], [withoutContract], options);
      expect(report.issues).toEqual([
        expect.objectContaining({
          kind: 'missing_sync',
          orderId: '7001',
          lineId: '1002',
          planId: GOOD_PLAN_ID,
        }),
      ]);
    });

    it('orphan coverage: Extend holds a coverage line Shopify no longer reports', () => {
      const stored = extendHolds(makeOrder());
      const shopify = makeOrder({
        refundState: 'partial',
        lineItems: [mattressLine(), coverageLine({refundedQuantity: 1})],
      });
      const report = reconcile([shopify], [stored], options);
      expect(kinds(report)).toEqual(['orphan_coverage']);
      expect(report.issues[0]).toMatchObject({
        lineId: '1002',
        planId: GOOD_PLAN_ID,
      });
    });

    it('orphan coverage: Shopify has coverage with no covered product in the order', () => {
      const shopify = makeOrder({
        lineItems: [coverageLine({parentLineItemId: null})],
      });
      const report = reconcile([shopify], [], options);
      expect(kinds(report)).toEqual(['orphan_coverage']);
      expect(report.issues[0]).toMatchObject({
        lineId: '1002',
        detail: 'coverage line flagged: covered_product_missing',
      });
    });

    it('price mismatch: the plan or price Extend holds differs from what was paid', () => {
      const stored = extendHolds(makeOrder());
      const line = contractLine(stored);
      const tampered: ExtendStoredOrder = {
        ...stored,
        snapshot: {
          ...stored.snapshot,
          lineItems: stored.snapshot.lineItems.map((item) =>
            item === line
              ? {...line, plan: {...line.plan, purchasePrice: 14_999}}
              : item,
          ),
        },
      };
      const report = reconcile([makeOrder()], [tampered], options);
      expect(kinds(report)).toEqual(['price_mismatch']);
      expect(report.issues[0]?.detail).toContain('7999');
      expect(report.issues[0]?.detail).toContain('14999');
    });

    it('price mismatch: a coverage line paid at a different price than its plan quote (flagged by the cross-check)', () => {
      const shopify = makeOrder({
        lineItems: [
          mattressLine(),
          coverageLine({unitPriceCents: 1499, paidUnitPriceCents: 1499}),
        ],
      });
      const report = reconcile([shopify], [], {
        storeId: STORE,
        quotesForOrder: () => goodQuotes(),
      });
      expect(kinds(report)).toEqual(['price_mismatch']);
    });

    it('quantity mismatch: Extend covers a different number of units', () => {
      const shopify = makeOrder({
        refundState: 'partial',
        lineItems: [
          mattressLine({quantity: 2, refundedQuantity: 1}),
          coverageLine({quantity: 2, refundedQuantity: 1}),
        ],
      });
      const before = makeOrder({
        lineItems: [mattressLine({quantity: 2}), coverageLine({quantity: 2})],
      });
      const report = reconcile([shopify], [extendHolds(before)], options);
      expect(report.issues.map((i) => i.kind)).toContain('quantity_mismatch');
      expect(report.issues.map((i) => i.kind)).toContain('price_mismatch'); // plan total also changed with the quantity
    });

    it('quantity mismatch: coverage and covered item quantities differ in Shopify itself', () => {
      const shopify = makeOrder({
        lineItems: [mattressLine({quantity: 1}), coverageLine({quantity: 3})],
      });
      const report = reconcile([shopify], [extendHolds(shopify)], options);
      expect(kinds(report)).toEqual(['quantity_mismatch']);
      expect(report.issues[0]).toMatchObject({lineId: '1002'});
    });

    it('contract missing: the covered item is fulfilled in Shopify but Extend issued no contract', () => {
      const shopify = makeOrder({
        lineItems: [mattressLine({fulfilledQuantity: 1}), coverageLine()],
      });
      const stored = extendHolds(shopify);
      const report = reconcile(
        [shopify],
        [{...stored, contracts: []}],
        options,
      );
      expect(kinds(report)).toEqual(['contract_missing']);
      expect(report.issues[0]).toMatchObject({
        lineId: '1002',
        planId: GOOD_PLAN_ID,
      });
    });

    it("contract missing: Shopify shows fulfilment that Extend's snapshot has not caught up with", () => {
      const unfulfilled = makeOrder();
      const fulfilled = makeOrder({
        lineItems: [mattressLine({fulfilledQuantity: 1}), coverageLine()],
      });
      const report = reconcile(
        [fulfilled],
        [extendHolds(unfulfilled)],
        options,
      );
      // The stale snapshot is the visible symptom; the missing contract is the consequence staff care about.
      expect(report.issues.map((i) => i.kind)).toContain('contract_missing');
      expect(report.clean).toBe(false);
    });

    it('does not expect a contract for a refunded order', () => {
      const refunded = makeOrder({
        refundState: 'full',
        lineItems: [
          mattressLine({refundedQuantity: 1, fulfilledQuantity: 1}),
          coverageLine({refundedQuantity: 1}),
        ],
      });
      expect(
        reconcile([refunded], [extendHolds(refunded)], options).clean,
      ).toBe(true);
    });

    it('status mismatch: Shopify refunded or cancelled the order but Extend still has it active', () => {
      const active = makeOrder();
      const cancelled = makeOrder({
        cancelledAt: '2026-10-02T08:00:00Z',
        lineItems: [
          mattressLine({refundedQuantity: 1}),
          coverageLine({refundedQuantity: 1}),
        ],
      });
      const report = reconcile([cancelled], [extendHolds(active)], options);
      expect(report.issues.map((i) => i.kind)).toContain('status_mismatch');
      expect(
        report.issues.find((i) => i.kind === 'status_mismatch')?.detail,
      ).toBe('Shopify says refunded, Extend says active');
    });

    it('unexpected Extend order: Extend has an order Shopify did not list', () => {
      const report = reconcile([], [extendHolds(makeOrder())], options);
      expect(kinds(report)).toEqual(['unexpected_extend_order']);
      expect(report.issues[0]?.orderId).toBe('7001');
    });

    it('invalid order: reported once, and its Extend copy is not also called unexpected', () => {
      const broken = makeOrder({createdAt: 'nope'});
      const report = reconcile([broken], [extendHolds(makeOrder())], options);
      expect(kinds(report)).toEqual(['invalid_order']);
      expect(report.issues[0]).toMatchObject({
        orderId: '7001',
        detail: 'createdAt',
      });
    });

    it('invalid order with an unusable id is reported as "unknown"', () => {
      const report = reconcile([makeOrder({id: 'garbage'})], [], options);
      expect(report.issues).toEqual([
        expect.objectContaining({kind: 'invalid_order', orderId: 'unknown'}),
      ]);
    });

    it('flagged coverage: a bare price-point SKU with no plan id is surfaced for staff', () => {
      const shopify = makeOrder({
        lineItems: [mattressLine(), coverageLine({attributes: {}})],
      });
      expect(kinds(reconcile([shopify], [], options))).toEqual([
        'flagged_coverage',
      ]);
    });
  });

  describe('report', () => {
    it('summarises counts per kind and sorts issues by order, kind and line', () => {
      const a = makeOrder({
        id: '7002',
        lineItems: [
          mattressLine({id: '2001'}),
          coverageLine({id: '2002', parentLineItemId: '2001'}),
        ],
      });
      const b = makeOrder({
        id: '7001',
        lineItems: [coverageLine({id: '1002', parentLineItemId: null})],
      });
      const report = reconcile(
        [a, b],
        [
          extendHolds(
            makeOrder({
              id: '7009',
              lineItems: [
                mattressLine({id: '9001'}),
                coverageLine({id: '9002', parentLineItemId: '9001'}),
              ],
            }),
          ),
        ],
        {
          storeId: STORE,
          quotesForOrder: (order) =>
            order.id === '7002' ? goodQuotes('2002') : goodQuotes('1002'),
        },
      );
      expect(report.issues.map((i) => [i.orderId, i.kind])).toEqual([
        ['7001', 'orphan_coverage'],
        ['7002', 'missing_sync'],
        ['7009', 'unexpected_extend_order'],
      ]);
      expect(report.summary).toEqual({
        missing_sync: 1,
        unexpected_extend_order: 1,
        orphan_coverage: 1,
        price_mismatch: 0,
        quantity_mismatch: 0,
        status_mismatch: 0,
        contract_missing: 0,
        flagged_coverage: 0,
        invalid_order: 0,
      });
      expect(report.checkedOrders).toBe(2);
    });

    it('is deterministic whatever order the inputs arrive in', () => {
      const orders = [
        makeOrder({
          id: '7002',
          lineItems: [
            mattressLine({id: '2001'}),
            coverageLine({id: '2002', parentLineItemId: '2001'}),
          ],
        }),
        makeOrder({id: '7001'}),
      ];
      const quotesForOrder = (order: ShopifyOrderLike) =>
        order.id === '7002' ? goodQuotes('2002') : goodQuotes('1002');
      const forward = reconcile(orders, [], {storeId: STORE, quotesForOrder});
      const backward = reconcile([...orders].reverse(), [], {
        storeId: STORE,
        quotesForOrder,
      });
      expect(backward.issues).toEqual(forward.issues);
    });

    it('carries no personal data: ids, plan ids and short reasons only (T-05)', () => {
      const shopify = makeOrder({
        lineItems: [
          mattressLine({fulfilledQuantity: 1}),
          coverageLine({quantity: 2}),
        ],
      });
      const stored = extendHolds(shopify);
      const report = reconcile(
        [shopify],
        [{...stored, contracts: []}],
        options,
      );
      expect(report.issues.length).toBeGreaterThan(0);
      const text = JSON.stringify(report);
      for (const value of Object.values(SYNTHETIC_PII))
        expect(text).not.toContain(value);
      for (const issue of report.issues) {
        expect(
          Object.keys(issue).every((key) =>
            ['kind', 'orderId', 'lineId', 'planId', 'detail'].includes(key),
          ),
        ).toBe(true);
      }
    });

    it('does not mutate its inputs', () => {
      const shopify = [makeOrder()];
      const extend = [extendHolds(makeOrder())];
      const before = JSON.stringify([shopify, extend]);
      reconcile(shopify, extend, options);
      expect(JSON.stringify([shopify, extend])).toBe(before);
    });
  });
});
