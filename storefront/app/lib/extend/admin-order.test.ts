import {describe, expect, it} from 'vitest';
import {
  EXTEND_ORDER_BY_ID_QUERY,
  EXTEND_ORDERS_PAGE_QUERY,
  ORDER_LINE_PAGE_SIZE,
  parseAdminOrder,
} from '~/lib/extend/admin-order';
import {buildOrderSnapshot} from '~/lib/extend/orders';
import {
  GOOD_PLAN_ID,
  SYNTHETIC_PII,
  adminCoverageNode,
  adminMattressNode,
  adminOrderNode,
} from '~/lib/extend/test-fixtures';

// REQ-EXT-003 / P5A-08: the order is always read from the Admin API and mapped defensively; the webhook body is only a trigger.

function ok(node: unknown) {
  const result = parseAdminOrder(node);
  if (result.status !== 'ok') throw new Error(`expected ok: ${result.reason}`);
  return result.order;
}

describe('REQ-EXT-003 Admin order mapping', () => {
  it('maps an order with a mattress and a coverage line', () => {
    const order = ok(adminOrderNode());
    expect(order).toMatchObject({
      id: 'gid://shopify/Order/7001',
      currency: 'USD',
      totalCents: 137_899,
      refundState: 'none',
      cancelledAt: null,
    });
    const [mattress, coverage] = order.lineItems;
    expect(mattress).toMatchObject({
      productId: 'gid://shopify/Product/501',
      category: 'mattress',
      unitPriceCents: 129_900,
      paidUnitPriceCents: 129_900,
      fulfilledQuantity: 0,
      refundedQuantity: 0,
      parentLineItemId: null,
    });
    expect(coverage).toMatchObject({
      category: null,
      unitPriceCents: 7999,
      attributes: {
        _extend_plan_id: GOOD_PLAN_ID,
        _extend_covered_product_id: '501',
      },
    });
    expect(order.customer).toMatchObject({
      email: SYNTHETIC_PII.email,
      name: SYNTHETIC_PII.name,
      shippingAddress: {
        postalCode: SYNTHETIC_PII.postalCode,
        countryCode: 'US',
        province: 'CA',
      },
    });
  });

  it('the mapped order produces a snapshot once the quote is verified (the pure parts end to end)', () => {
    const order = ok(adminOrderNode());
    const built = buildOrderSnapshot(order, {
      storeId: 'store-1',
      quotesByLineId: new Map([
        ['1002', {planId: GOOD_PLAN_ID, priceCents: 7999}],
      ]),
    });
    expect(built.status).toBe('ok');
    if (built.status !== 'ok') return;
    expect(built.flagged).toEqual([]);
    expect(built.contractLineCount).toBe(1);
  });

  it('derives refunded and fulfilled quantities from currentQuantity and unfulfilledQuantity', () => {
    const order = ok(
      adminOrderNode([
        adminMattressNode({
          quantity: 3,
          currentQuantity: 2,
          unfulfilledQuantity: 1,
        }),
      ]),
    );
    expect(order.lineItems[0]).toMatchObject({
      quantity: 3,
      refundedQuantity: 1,
      fulfilledQuantity: 1,
    });
  });

  it('never reports more fulfilled units than remain, and never a negative number', () => {
    const order = ok(
      adminOrderNode([
        adminMattressNode({
          quantity: 2,
          currentQuantity: 0,
          unfulfilledQuantity: 2,
        }),
        adminCoverageNode({
          quantity: 1,
          currentQuantity: 1,
          unfulfilledQuantity: 5,
        }),
      ]),
    );
    expect(order.lineItems.map((line) => line.fulfilledQuantity)).toEqual([
      0, 0,
    ]);
  });

  it.each([
    ['REFUNDED', 'full'],
    ['PARTIALLY_REFUNDED', 'partial'],
    ['PAID', 'none'],
    [null, 'none'],
  ])('maps financial status %s to %s', (status, expected) => {
    expect(
      ok(adminOrderNode(undefined, {displayFinancialStatus: status}))
        .refundState,
    ).toBe(expected);
  });

  it('keeps the cancellation time', () => {
    expect(
      ok(adminOrderNode(undefined, {cancelledAt: '2026-10-02T00:00:00Z'}))
        .cancelledAt,
    ).toBe('2026-10-02T00:00:00Z');
  });

  it('refuses an order with more lines than one page: a partial snapshot is never built', () => {
    const node = adminOrderNode();
    node.lineItems.pageInfo.hasNextPage = true;
    expect(parseAdminOrder(node)).toMatchObject({
      status: 'error',
      reason: 'truncated',
    });
  });

  it('refuses a page that is bigger than the page size', () => {
    const many = Array.from({length: ORDER_LINE_PAGE_SIZE + 1}, (_, index) =>
      adminMattressNode({id: `gid://shopify/LineItem/${index + 1}`}),
    );
    expect(parseAdminOrder(adminOrderNode(many))).toMatchObject({
      status: 'error',
      reason: 'truncated',
    });
  });

  it.each([
    ['not an object', 'order'],
    ['null', null],
    ['missing total', {...adminOrderNode(), totalPriceSet: null}],
    [
      'float-looking money',
      {...adminOrderNode(), totalPriceSet: {shopMoney: {amount: '1e3'}}},
    ],
    ['negative quantity', adminOrderNode([adminMattressNode({quantity: -1})])],
    ['string quantity', adminOrderNode([adminMattressNode({quantity: '1'})])],
    [
      'non-array attributes',
      adminOrderNode([adminMattressNode({customAttributes: 'x'})]),
    ],
    ['line is not an object', adminOrderNode(['nope'])],
    ['no line items', {...adminOrderNode(), lineItems: null}],
    [
      'missing pageInfo',
      {...adminOrderNode(), lineItems: {nodes: [adminMattressNode()]}},
    ],
  ])('treats %s as malformed', (_name, node) => {
    expect(parseAdminOrder(node)).toMatchObject({
      status: 'error',
      reason: 'malformed',
    });
  });

  it('a hostile attribute key such as __proto__ becomes an own property and pollutes nothing', () => {
    const order = ok(
      adminOrderNode([
        adminMattressNode({
          customAttributes: [{key: '__proto__', value: 'polluted'}],
        }),
      ]),
    );
    const attributes = order.lineItems[0]?.attributes ?? {};
    expect(Object.keys(attributes)).toEqual(['__proto__']);
    expect(Reflect.get({}, 'polluted')).toBeUndefined();
  });

  it('treats a blank category as not eligible', () => {
    const order = ok(
      adminOrderNode([
        adminMattressNode({
          product: {id: 'gid://shopify/Product/501', metafield: {value: '  '}},
        }),
      ]),
    );
    expect(order.lineItems[0]?.category).toBeNull();
  });

  it('passes a non-USD currency through so the snapshot builder can refuse it', () => {
    const order = ok(adminOrderNode(undefined, {currencyCode: 'CAD'}));
    expect(order.currency).toBe('CAD');
    expect(
      buildOrderSnapshot(order, {storeId: 's', quotesByLineId: new Map()}),
    ).toMatchObject({status: 'error', reason: 'unsupported_currency'});
  });
});

describe('Admin documents', () => {
  it('are read-only queries, not mutations, and are not tagged for the Storefront codegen', () => {
    for (const query of [EXTEND_ORDER_BY_ID_QUERY, EXTEND_ORDERS_PAGE_QUERY]) {
      expect(query).not.toMatch(/\bmutation\b/);
      expect(query).not.toContain('#graphql');
      expect(query).toContain('fragment ExtendOrder on Order');
    }
  });
});
