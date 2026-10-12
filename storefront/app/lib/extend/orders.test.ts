import {describe, expect, it} from 'vitest';
import {
  buildOrderSnapshot,
  crossCheckCoverage,
  isCoverageOrderLine,
  listQuoteQueries,
  type ShopifyOrderLike,
} from '~/lib/extend/orders';
import {
  GOOD_PLAN_ID,
  SYNTHETIC_CUSTOMER,
  SYNTHETIC_PII,
  coverageLine,
  goodQuotes,
  makeOrder,
  mattressLine,
} from '~/lib/extend/test-fixtures';
import type {PlanQuote} from '~/lib/extend/types';

const STORE = 'store-fixture-1';
const CREATED = Date.parse('2026-10-01T12:00:00Z');

function build(order: ShopifyOrderLike, quotes = goodQuotes()) {
  return buildOrderSnapshot(order, {storeId: STORE, quotesByLineId: quotes});
}

function ok(order: ShopifyOrderLike, quotes = goodQuotes()) {
  const result = build(order, quotes);
  if (result.status !== 'ok')
    throw new Error(`expected ok, got ${result.detail}`);
  return result;
}

describe('order snapshot: documented shape (REQ-EXT-003)', () => {
  it('builds a full Category Orders snapshot for a new, unfulfilled order', () => {
    const result = ok(makeOrder());
    expect(result.snapshot).toEqual({
      transactionId: '7001',
      storeId: STORE,
      currency: 'USD',
      transactionDate: CREATED,
      total: 137_899,
      customer: {
        name: SYNTHETIC_PII.name,
        email: SYNTHETIC_PII.email,
        phone: SYNTHETIC_PII.phone,
        billingAddress: {
          address1: SYNTHETIC_PII.billingStreet,
          city: SYNTHETIC_PII.city,
          countryCode: 'US',
          postalCode: SYNTHETIC_PII.postalCode,
          province: 'CA',
        },
        shippingAddress: {
          address1: SYNTHETIC_PII.shippingStreet,
          address2: 'Unit 4',
          city: SYNTHETIC_PII.city,
          countryCode: 'US',
          postalCode: SYNTHETIC_PII.postalCode,
          province: 'CA',
        },
      },
      lineItems: [
        {
          lineItemTransactionId: '1001',
          product: {
            id: '501',
            title: 'Test Hybrid Mattress',
            category: 'mattress',
            listPrice: 129_900,
            purchasePrice: 129_900,
            purchaseDate: CREATED,
          },
          quantity: 1,
          fulfilledQuantity: 0,
        },
        {
          type: 'category_contract',
          lineItemTransactionId: '1002-contract',
          quantity: 1,
          fulfilledQuantity: 0,
          plan: {id: GOOD_PLAN_ID, purchasePrice: 7999, purchaseDate: CREATED},
          coveredProducts: [
            {lineItemTransactionId: '1001', productId: '501', quantity: 1},
          ],
        },
      ],
    });
    expect(result.snapshot).not.toHaveProperty('status');
    expect(result).toMatchObject({
      flagged: [],
      warnings: [],
      coverageLineCount: 1,
      contractLineCount: 1,
      planIds: [GOOD_PLAN_ID],
    });
  });

  it('reports the paid price as purchasePrice and the pre-discount price as listPrice', () => {
    const result = ok(
      makeOrder({
        lineItems: [
          mattressLine({paidUnitPriceCents: 109_900}),
          coverageLine({paidUnitPriceCents: 6399}),
        ],
      }),
    );
    const [product, contract] = result.snapshot.lineItems;
    expect(product).toMatchObject({
      product: {listPrice: 129_900, purchasePrice: 109_900},
    });
    // A discounted coverage line is NOT a price mismatch: the variant price is compared, and the plan price is reported.
    expect(contract).toMatchObject({plan: {purchasePrice: 7999}});
    expect(result.flagged).toEqual([]);
  });

  it('keeps ids stable and the whole snapshot deterministic across lifecycle states', () => {
    const created = ok(makeOrder());
    const fulfilled = ok(
      makeOrder({
        lineItems: [mattressLine({fulfilledQuantity: 1}), coverageLine()],
      }),
    );
    const ids = (r: typeof created) =>
      r.snapshot.lineItems.map((l) => l.lineItemTransactionId);
    expect(ids(fulfilled)).toEqual(ids(created));
    expect(JSON.stringify(ok(makeOrder()).snapshot)).toBe(
      JSON.stringify(created.snapshot),
    );
  });

  it('derives ids from the numeric tail of Shopify GIDs and accepts bare numbers', () => {
    const result = ok(
      makeOrder({
        id: '7001',
        lineItems: [
          mattressLine({id: '1001', productId: '501'}),
          coverageLine({id: '1002', parentLineItemId: '1001'}),
        ],
      }),
    );
    expect(result.snapshot.transactionId).toBe('7001');
    expect(
      result.snapshot.lineItems.map((l) => l.lineItemTransactionId),
    ).toEqual(['1001', '1002-contract']);
  });
});

describe('order snapshot: lifecycle (REQ-EXT-003)', () => {
  it('fulfilment sets fulfilledQuantity on the product and starts the contract line', () => {
    const {snapshot} = ok(
      makeOrder({
        lineItems: [mattressLine({fulfilledQuantity: 1}), coverageLine()],
      }),
    );
    expect(snapshot.lineItems[0]).toMatchObject({fulfilledQuantity: 1});
    expect(snapshot.lineItems[1]).toMatchObject({fulfilledQuantity: 1});
  });

  it('a partly fulfilled quantity still starts the contract (first covered product fulfilled)', () => {
    const {snapshot} = ok(
      makeOrder({
        lineItems: [
          mattressLine({quantity: 2, fulfilledQuantity: 1}),
          coverageLine({quantity: 2}),
        ],
      }),
    );
    expect(snapshot.lineItems[0]).toMatchObject({
      quantity: 2,
      fulfilledQuantity: 1,
    });
    expect(snapshot.lineItems[1]).toMatchObject({
      fulfilledQuantity: 1,
      plan: {purchasePrice: 15_998},
      coveredProducts: [{quantity: 2}],
    });
  });

  it('partial refund reduces quantity and the matching coveredProducts', () => {
    const {snapshot} = ok(
      makeOrder({
        refundState: 'partial',
        lineItems: [
          mattressLine({quantity: 2, refundedQuantity: 1}),
          coverageLine({quantity: 2, refundedQuantity: 1}),
        ],
      }),
    );
    expect(snapshot.lineItems[0]).toMatchObject({quantity: 1});
    expect(snapshot.lineItems[1]).toMatchObject({
      plan: {purchasePrice: 7999},
      coveredProducts: [{lineItemTransactionId: '1001', quantity: 1}],
    });
    expect(snapshot).not.toHaveProperty('status');
  });

  it('refunding only the coverage line removes it (omitted) and keeps the product', () => {
    const result = ok(
      makeOrder({
        refundState: 'partial',
        lineItems: [mattressLine(), coverageLine({refundedQuantity: 1})],
      }),
    );
    expect(result.snapshot.lineItems).toHaveLength(1);
    expect(result.snapshot.lineItems[0]).toMatchObject({
      lineItemTransactionId: '1001',
    });
    expect(result.flagged).toEqual([]);
    expect(result.coverageLineCount).toBe(1); // still an order Extend must hear about
    expect(result.contractLineCount).toBe(0);
  });

  it('a fully refunded order is status "refunded" and keeps the original quantities', () => {
    const {snapshot} = ok(
      makeOrder({
        refundState: 'full',
        lineItems: [
          mattressLine({refundedQuantity: 1, fulfilledQuantity: 1}),
          coverageLine({refundedQuantity: 1}),
        ],
      }),
    );
    expect(snapshot.status).toBe('refunded');
    expect(snapshot.lineItems).toHaveLength(2);
    expect(snapshot.lineItems[0]).toMatchObject({quantity: 1});
  });

  it('a cancelled order is reported as refunded (ASSUMPTION(V-11): no documented cancelled status)', () => {
    const {snapshot} = ok(
      makeOrder({
        cancelledAt: '2026-10-02T08:00:00Z',
        lineItems: [
          mattressLine({refundedQuantity: 1}),
          coverageLine({refundedQuantity: 1}),
        ],
      }),
    );
    expect(snapshot.status).toBe('refunded');
    expect(snapshot.lineItems).toHaveLength(2);
  });

  it('omits a fully refunded product line (removal)', () => {
    const other = mattressLine({
      id: '1003',
      productId: '503',
      unitPriceCents: 5000,
      paidUnitPriceCents: 5000,
    });
    const {snapshot} = ok(
      makeOrder({
        refundState: 'partial',
        lineItems: [
          mattressLine({refundedQuantity: 1}),
          other,
          coverageLine({refundedQuantity: 1}),
        ],
      }),
    );
    expect(snapshot.lineItems.map((l) => l.lineItemTransactionId)).toEqual([
      '1003',
    ]);
  });

  it('never reports more fulfilled than ordered', () => {
    const {snapshot} = ok(
      makeOrder({
        lineItems: [
          mattressLine({quantity: 1, fulfilledQuantity: 5}),
          coverageLine(),
        ],
      }),
    );
    expect(snapshot.lineItems[0]).toMatchObject({fulfilledQuantity: 1});
  });

  it('omits lines whose product is outside the eligible categories', () => {
    const throwPillow = mattressLine({
      id: '1005',
      productId: '505',
      category: null,
    });
    const {snapshot} = ok(
      makeOrder({lineItems: [mattressLine(), throwPillow, coverageLine()]}),
    );
    expect(snapshot.lineItems.map((l) => l.lineItemTransactionId)).toEqual([
      '1001',
      '1002-contract',
    ]);
  });
});

describe('order snapshot: customer data goes only into the customer block', () => {
  it('omits empty and null fields and trims text', () => {
    const {snapshot} = ok(
      makeOrder({
        customer: {
          name: '  Pat Sample  ',
          email: null,
          phone: '',
          billingAddress: {
            address1: null,
            address2: null,
            city: null,
            countryCode: null,
            postalCode: null,
            province: null,
          },
          shippingAddress: {
            address1: ' 3 Test Ln ',
            address2: null,
            city: 'Testville',
            countryCode: 'US',
            postalCode: '99999',
            province: null,
          },
        },
      }),
    );
    expect(snapshot.customer).toEqual({
      name: 'Pat Sample',
      shippingAddress: {
        address1: '3 Test Ln',
        city: 'Testville',
        countryCode: 'US',
        postalCode: '99999',
      },
    });
  });

  it('keeps personal data out of every other part of the snapshot', () => {
    const {snapshot} = ok(makeOrder());
    const {customer: _customer, ...rest} = snapshot;
    const text = JSON.stringify(rest);
    for (const value of [
      SYNTHETIC_PII.name,
      SYNTHETIC_PII.email,
      SYNTHETIC_PII.phone,
      SYNTHETIC_PII.billingStreet,
      SYNTHETIC_PII.postalCode,
    ]) {
      expect(text).not.toContain(value);
    }
    expect(SYNTHETIC_CUSTOMER.email).toBe(SYNTHETIC_PII.email);
  });
});

describe('order snapshot: invalid input never produces a payload', () => {
  const cases: Array<[string, Partial<ShopifyOrderLike>, string]> = [
    ['bad order id', {id: 'abc'}, 'invalid_order'],
    ['order id with injection', {id: '1; DROP TABLE'}, 'invalid_order'],
    [
      'non-USD currency (US only, NFR-008)',
      {currency: 'CAD'},
      'unsupported_currency',
    ],
    ['unparseable date', {createdAt: 'last tuesday'}, 'invalid_order'],
    ['negative total', {totalCents: -1}, 'invalid_order'],
    [
      'fractional total (floats are not cents)',
      {totalCents: 10.5},
      'invalid_order',
    ],
    [
      'duplicate line ids',
      {lineItems: [mattressLine(), mattressLine()]},
      'invalid_order',
    ],
    [
      'line with bad id',
      {lineItems: [mattressLine({id: 'x'})]},
      'invalid_order',
    ],
    [
      'fractional quantity',
      {lineItems: [mattressLine({quantity: 1.5})]},
      'invalid_order',
    ],
    [
      'negative refunded quantity',
      {lineItems: [mattressLine({refundedQuantity: -1})]},
      'invalid_order',
    ],
    [
      'absurd quantity',
      {lineItems: [mattressLine({quantity: 10 ** 9})]},
      'invalid_order',
    ],
    [
      'fractional price',
      {lineItems: [mattressLine({unitPriceCents: 99.5})]},
      'invalid_order',
    ],
    [
      'eligible product with no usable product id',
      {lineItems: [mattressLine({productId: null})]},
      'invalid_order',
    ],
    [
      'too many lines',
      {
        lineItems: Array.from({length: 501}, (_, i) =>
          mattressLine({id: String(2000 + i)}),
        ),
      },
      'invalid_order',
    ],
  ];

  it.each(cases)('%s', (_label, overrides, reason) => {
    expect(build(makeOrder(overrides))).toMatchObject({
      status: 'error',
      reason,
    });
  });

  it('reports a detail that names ids, not customer data', () => {
    const result = build(
      makeOrder({lineItems: [mattressLine({quantity: 1.5})]}),
    );
    expect(result).toMatchObject({
      status: 'error',
      detail: 'line 1001: quantity',
    });
    expect(JSON.stringify(result)).not.toContain(SYNTHETIC_PII.email);
  });
});

describe('coverage cross-check (ADR-0009 decision 7, T-06)', () => {
  it('passes a coverage line whose quoted price equals the price charged and whose covered product is in the order', () => {
    expect(crossCheckCoverage(makeOrder(), goodQuotes())).toEqual({
      ok: true,
      warnings: [],
    });
  });

  it('flags a cheap price-point SKU carrying an expensive plan id, and never puts it in the snapshot', () => {
    // The attack in ADR-0009: pay 14.99 for the cheapest SKU but claim the 149.99 plan.
    const order = makeOrder({
      lineItems: [
        mattressLine(),
        coverageLine({
          sku: 'Extend-Protection-Plan-14.99',
          variantTitle: 'Extend-Protection-Plan-14.99',
          unitPriceCents: 1499,
          paidUnitPriceCents: 1499,
        }),
      ],
    });
    const quotes = goodQuotes('1002', {
      planId: GOOD_PLAN_ID,
      priceCents: 14_999,
    });
    expect(crossCheckCoverage(order, quotes)).toEqual({
      ok: false,
      flagged: [{lineId: '1002', reason: 'price_mismatch'}],
      warnings: [],
    });
    const built = ok(order, quotes);
    expect(
      built.snapshot.lineItems.map((l) => l.lineItemTransactionId),
    ).toEqual(['1001']);
    expect(JSON.stringify(built.snapshot)).not.toContain(GOOD_PLAN_ID);
    expect(built.contractLineCount).toBe(0);
    expect(built.coverageLineCount).toBe(1);
  });

  it.each([
    [
      'plan not offered for this product (lookup says null)',
      goodQuotes('1002', null),
    ],
    ['no lookup result at all', new Map<string, PlanQuote | null>()],
    [
      'lookup answered for a different plan id',
      goodQuotes('1002', {planId: 'SOME-OTHER-PLAN', priceCents: 7999}),
    ],
  ])('flags unknown_plan: %s', (_label, quotes) => {
    expect(crossCheckCoverage(makeOrder(), quotes)).toMatchObject({
      ok: false,
      flagged: [{lineId: '1002', reason: 'unknown_plan'}],
    });
  });

  it.each([
    [
      'coverage with no parent and no covered product in the order',
      {lineItems: [coverageLine({parentLineItemId: null})]},
      'covered_product_missing',
    ],
    [
      'coverage pointing at a parent that is not in the order',
      {lineItems: [mattressLine(), coverageLine({parentLineItemId: '9999'})]},
      'covered_product_missing',
    ],
    [
      'covered product id names a different product than the parent',
      {
        lineItems: [
          mattressLine(),
          coverageLine({
            attributes: {
              ...coverageLine().attributes,
              _extend_covered_product_id: '502',
            },
          }),
        ],
      },
      'covered_product_mismatch',
    ],
    [
      'covered product id names a product that is not in the order (no parent id)',
      {
        lineItems: [
          mattressLine(),
          coverageLine({
            parentLineItemId: null,
            attributes: {
              ...coverageLine().attributes,
              _extend_covered_product_id: '502',
            },
          }),
        ],
      },
      'covered_product_missing',
    ],
    [
      'covered item was refunded away entirely',
      {
        lineItems: [mattressLine({refundedQuantity: 1}), coverageLine()],
        refundState: 'partial' as const,
      },
      'covered_product_missing',
    ],
    [
      'covered item is outside the eligible categories',
      {lineItems: [mattressLine({category: null}), coverageLine()]},
      'covered_product_ineligible',
    ],
    [
      'plan id missing',
      {
        lineItems: [
          mattressLine(),
          coverageLine({attributes: {_extend_covered_product_id: '501'}}),
        ],
      },
      'invalid_plan_id',
    ],
    [
      'plan id is markup',
      {
        lineItems: [
          mattressLine(),
          coverageLine({
            attributes: {
              ...coverageLine().attributes,
              _extend_plan_id: '<script>',
            },
          }),
        ],
      },
      'invalid_plan_id',
    ],
    [
      'covered product id missing',
      {
        lineItems: [
          mattressLine(),
          coverageLine({attributes: {_extend_plan_id: GOOD_PLAN_ID}}),
        ],
      },
      'invalid_covered_product_id',
    ],
    [
      'a bare price-point SKU with no attributes (coverage added alone through the API)',
      {lineItems: [mattressLine(), coverageLine({attributes: {}})]},
      'invalid_plan_id',
    ],
  ])('flags %s', (_label, overrides, reason) => {
    const result = crossCheckCoverage(makeOrder(overrides), goodQuotes());
    expect(result).toMatchObject({
      ok: false,
      flagged: [{lineId: '1002', reason}],
    });
  });

  it('refuses to guess between two lines of the same product when the nested parent was not preserved', () => {
    const order = makeOrder({
      lineItems: [
        mattressLine({id: '1001', variantId: 'queen'}),
        mattressLine({id: '1003', variantId: 'king'}),
        coverageLine({parentLineItemId: null}),
      ],
    });
    expect(crossCheckCoverage(order, goodQuotes())).toMatchObject({
      ok: false,
      flagged: [{lineId: '1002', reason: 'covered_product_ambiguous'}],
    });
    // With the parent relationship available the same order is unambiguous.
    const withParent = makeOrder({
      lineItems: [
        mattressLine({id: '1001', variantId: 'queen'}),
        mattressLine({id: '1003', variantId: 'king'}),
        coverageLine({parentLineItemId: '1003'}),
      ],
    });
    expect(crossCheckCoverage(withParent, goodQuotes())).toEqual({
      ok: true,
      warnings: [],
    });
    expect(ok(withParent).snapshot.lineItems[2]).toMatchObject({
      coveredProducts: [{lineItemTransactionId: '1003'}],
    });
  });

  it('falls back to the covered product id when the order has no parent relationship', () => {
    const order = makeOrder({
      lineItems: [mattressLine(), coverageLine({parentLineItemId: null})],
    });
    expect(crossCheckCoverage(order, goodQuotes())).toEqual({
      ok: true,
      warnings: [],
    });
  });

  it('keeps the first coverage line on an item and flags the duplicate', () => {
    const second = coverageLine({
      id: '1003',
      sku: 'Extend-Protection-Plan-99.99',
      variantTitle: 'Extend-Protection-Plan-99.99',
      unitPriceCents: 9999,
      paidUnitPriceCents: 9999,
    });
    const quotes = new Map<string, PlanQuote | null>([
      ['1002', {planId: GOOD_PLAN_ID, priceCents: 7999}],
      ['1003', {planId: GOOD_PLAN_ID, priceCents: 9999}],
    ]);
    const order = makeOrder({
      lineItems: [mattressLine(), coverageLine(), second],
    });
    expect(crossCheckCoverage(order, quotes)).toMatchObject({
      ok: false,
      flagged: [{lineId: '1003', reason: 'duplicate_coverage'}],
    });
    const built = ok(order, quotes);
    expect(built.snapshot.lineItems.filter((l) => 'type' in l)).toHaveLength(1);
  });

  it('warns, but still reports the covered quantity, when coverage and item quantities differ', () => {
    const order = makeOrder({
      lineItems: [mattressLine({quantity: 1}), coverageLine({quantity: 2})],
    });
    const result = crossCheckCoverage(order, goodQuotes());
    expect(result).toEqual({
      ok: true,
      warnings: [{lineId: '1002', reason: 'quantity_mismatch'}],
    });
    expect(ok(order).snapshot.lineItems[1]).toMatchObject({
      plan: {purchasePrice: 7999},
      coveredProducts: [{quantity: 1}],
    });
  });

  it('reports every flagged line in order-line order', () => {
    const order = makeOrder({
      lineItems: [
        mattressLine(),
        coverageLine({id: '1004', attributes: {}}),
        coverageLine({id: '1002', parentLineItemId: '9999'}),
      ],
    });
    const result = crossCheckCoverage(order, goodQuotes());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.flagged.map((f) => f.lineId)).toEqual(['1004', '1002']);
    }
  });

  it('flags nothing about a fully removed coverage line (removal is not an anomaly)', () => {
    const order = makeOrder({
      refundState: 'partial',
      lineItems: [
        mattressLine(),
        coverageLine({refundedQuantity: 1, attributes: {}}),
      ],
    });
    expect(crossCheckCoverage(order, goodQuotes())).toEqual({
      ok: true,
      warnings: [],
    });
  });

  it('reports an invalid order instead of throwing', () => {
    expect(
      crossCheckCoverage(makeOrder({currency: 'CAD'}), goodQuotes()),
    ).toEqual({
      ok: false,
      flagged: [],
      warnings: [],
      invalidOrder: 'currency must be USD',
    });
  });
});

describe('quote queries (inputs for the injected lookup)', () => {
  it('asks about each structurally valid coverage line with the covered item and its list price', () => {
    expect(listQuoteQueries(makeOrder())).toEqual([
      {
        lineId: '1002',
        query: {
          planId: GOOD_PLAN_ID,
          coveredProductId: '501',
          category: 'mattress',
          coveredUnitPriceCents: 129_900,
        },
      },
    ]);
  });

  it('does not ask about lines that already fail the structural checks, or about invalid orders', () => {
    expect(listQuoteQueries(makeOrder({lineItems: [coverageLine()]}))).toEqual(
      [],
    );
    expect(listQuoteQueries(makeOrder({currency: 'EUR'}))).toEqual([]);
  });
});

describe('coverage line detection', () => {
  it.each([
    [coverageLine(), true],
    [
      coverageLine({
        sku: null,
        variantTitle: null,
        title: 'Extend-Protection-Plan-79.99',
        attributes: {},
      }),
      true,
    ],
    [
      coverageLine({
        sku: 'Extend-Protection-Plan-79.99',
        variantTitle: null,
        attributes: {},
      }),
      true,
    ],
    [mattressLine({attributes: {_extend_plan_id: 'X'}}), true],
    [mattressLine(), false],
    [
      mattressLine({
        sku: 'Extend-Protection-Plan-abc',
        title: 'Extend-Protection-Plan-',
        variantTitle: null,
      }),
      false,
    ],
  ])('line %# -> %s', (line, expected) => {
    expect(isCoverageOrderLine(line)).toBe(expected);
  });
});
