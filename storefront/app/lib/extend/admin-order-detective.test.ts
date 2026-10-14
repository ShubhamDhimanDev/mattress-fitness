import {describe, expect, it} from 'vitest';
import {detectOrderViolations} from '~/lib/detective/detect';
import {
  RULES,
  SYNTHETIC_PII,
  ZONE,
  adminDetectiveLineNode as lineNode,
  adminDetectiveOrderNode as orderNode,
} from '~/lib/detective/test-fixtures';
import {
  DETECTIVE_LINE_PAGE_SIZE,
  DETECTIVE_ORDER_BY_ID_QUERY,
  DETECTIVE_ORDERS_PAGE_QUERY,
  DETECTIVE_ORDERS_PAGE_SIZE,
  EXTEND_ORDER_BY_ID_QUERY,
  parseDetectiveOrder,
} from '~/lib/extend/admin-order';

// P5B-05 / T-05 / T-06: the detective reads its own, leaner document (query cost, no personal data) and maps it
// defensively. The Extend document is untouched, so the sync's read cannot change (REQ-EXT-003).

function ok(node: unknown) {
  const result = parseDetectiveOrder(node);
  if (result.status !== 'ok') throw new Error(`expected ok: ${result.reason}`);
  return result.order;
}

describe('P5B-05 detective documents', () => {
  it('are read-only queries that ask for no name, email, phone or street', () => {
    for (const query of [
      DETECTIVE_ORDER_BY_ID_QUERY,
      DETECTIVE_ORDERS_PAGE_QUERY,
    ]) {
      expect(query).not.toMatch(/\bmutation\b/);
      for (const field of [
        'email',
        'phone',
        'address1',
        'address2',
        'city',
        'billingAddress',
        'province',
      ]) {
        expect(query, field).not.toMatch(new RegExp(`\\b${field}\\b`));
      }
      expect(query).toContain('shippingAddress { countryCodeV2 zip }');
      expect(query).toContain('customAttributes { key value }');
      expect(query).toContain('selectedOptions { name value }');
    }
  });

  it('page the orders newest first, so a limit drops the oldest and never the newest', () => {
    expect(DETECTIVE_ORDERS_PAGE_QUERY).toMatch(
      /orders\([^)]*sortKey: CREATED_AT, reverse: true\)/,
    );
  });

  it('keep the requested size bounded and leave the Extend document alone', () => {
    expect(DETECTIVE_LINE_PAGE_SIZE).toBe(50);
    expect(DETECTIVE_ORDERS_PAGE_SIZE).toBe(2);
    expect(DETECTIVE_ORDER_BY_ID_QUERY).toContain(
      `first: ${DETECTIVE_LINE_PAGE_SIZE}`,
    );
    // The Extend read is byte-for-byte what it was: no detective field leaked into it.
    expect(EXTEND_ORDER_BY_ID_QUERY).not.toContain('selectedOptions');
    expect(EXTEND_ORDER_BY_ID_QUERY).toContain('lineItems(first: 100)');
  });
});

describe('P5B-05 parseDetectiveOrder', () => {
  it('maps the order, the shipping ZIP and country, the attributes and the Size option', () => {
    const {order, facts} = ok(orderNode());
    expect(order).toMatchObject({
      id: 'gid://shopify/Order/7001',
      currency: 'USD',
      refundState: 'none',
      cancelledAt: null,
      customer: {
        name: null,
        email: null,
        phone: null,
        billingAddress: null,
        shippingAddress: {
          countryCode: 'US',
          postalCode: '60645',
          address1: null,
        },
      },
    });
    expect(order.lineItems[0]).toMatchObject({
      productId: 'gid://shopify/Product/501',
      variantId: 'gid://shopify/ProductVariant/601',
      category: 'mattress',
      quantity: 1,
      refundedQuantity: 0,
      unitPriceCents: 129_900,
    });
    expect(facts.attributes).toEqual({delivery_choice: 'in-home'});
    expect(facts.sizeByLineId.get('gid://shopify/LineItem/1')).toBe('Queen');
  });

  it('a pickup order has no shipping address and no Size is not a problem', () => {
    const {order, facts} = ok(
      orderNode(
        [
          lineNode({
            variant: {
              id: 'gid://shopify/ProductVariant/9',
              selectedOptions: [],
            },
          }),
          lineNode({
            id: 'gid://shopify/LineItem/2',
            variant: null,
            product: null,
          }),
        ],
        {shippingAddress: null},
      ),
    );
    expect(order.customer.shippingAddress).toBeNull();
    expect(facts.sizeByLineId.get('gid://shopify/LineItem/1')).toBeNull();
    expect(facts.sizeByLineId.get('gid://shopify/LineItem/2')).toBeNull();
    expect(order.lineItems[1]).toMatchObject({
      productId: null,
      variantId: null,
    });
  });

  it('derives the refunded quantity and the order state', () => {
    const {order} = ok(
      orderNode([lineNode({quantity: 5, currentQuantity: 2})], {
        displayFinancialStatus: 'REFUNDED',
        cancelledAt: '2026-10-11T00:00:00Z',
      }),
    );
    expect(order.lineItems[0]?.refundedQuantity).toBe(3);
    expect(order.refundState).toBe('full');
    expect(order.cancelledAt).toBe('2026-10-11T00:00:00Z');
  });

  it('keeps a hostile attribute key from reaching the prototype', () => {
    const {facts} = ok(
      orderNode([lineNode()], {
        customAttributes: JSON.parse(
          '[{"key":"__proto__","value":"x"},{"key":"delivery_choice","value":"pickup"}]',
        ),
      }),
    );
    expect(facts.attributes.delivery_choice).toBe('pickup');
    expect(Object.getPrototypeOf(facts.attributes)).toBe(Object.prototype);
    expect(Object.hasOwn(facts.attributes, '__proto__')).toBe(true);
  });

  it.each([
    ['not an object', null],
    ['no id', orderNode([], {id: ''})],
    ['no total', orderNode([], {totalPriceSet: null})],
    ['no order attributes field', orderNode([], {customAttributes: undefined})],
    [
      'order attributes that are not a list',
      orderNode([], {customAttributes: 'x'}),
    ],
    [
      'a shipping address that is not an object',
      orderNode([], {shippingAddress: 'x'}),
    ],
    ['no line items', orderNode([], {lineItems: null})],
    ['no page info', orderNode([], {lineItems: {nodes: []}})],
    ['a line with no quantity', orderNode([lineNode({quantity: undefined})])],
    [
      'a line with a fractional quantity',
      orderNode([lineNode({quantity: 1.5})]),
    ],
    [
      'a line with no price',
      orderNode([lineNode({originalUnitPriceSet: null})]),
    ],
    [
      'a variant without selectedOptions',
      orderNode([lineNode({variant: {id: 'gid://shopify/ProductVariant/1'}})]),
    ],
    [
      'a selected option that is not an object',
      orderNode([lineNode({variant: {id: 'x', selectedOptions: ['Queen']}})]),
    ],
    [
      'line attributes that are not a list',
      orderNode([lineNode({customAttributes: {}})]),
    ],
  ])('refuses %s', (_name, node) => {
    expect(parseDetectiveOrder(node)).toMatchObject({
      status: 'error',
      reason: 'malformed',
    });
  });

  it('refuses an order with more lines than one page, never judging a sample', () => {
    const more = orderNode([lineNode()], {
      lineItems: {pageInfo: {hasNextPage: true}, nodes: [lineNode()]},
    });
    expect(parseDetectiveOrder(more)).toMatchObject({
      status: 'error',
      reason: 'truncated',
    });
    const many = orderNode(
      Array.from({length: DETECTIVE_LINE_PAGE_SIZE + 1}, (_, i) =>
        lineNode({id: `gid://shopify/LineItem/${i + 1}`}),
      ),
    );
    expect(parseDetectiveOrder(many)).toMatchObject({reason: 'truncated'});
  });

  it('feeds the detective end to end: a haul-away line to an out-of-zone ZIP is flagged, with no ZIP in the result', () => {
    const haul = lineNode({
      id: 'gid://shopify/LineItem/2',
      product: {id: 'gid://shopify/Product/520', metafield: null},
      variant: {
        id: 'gid://shopify/ProductVariant/621',
        selectedOptions: [],
      },
      quantity: 2,
      currentQuantity: 2,
    });
    const node = orderNode([lineNode(), haul], {
      shippingAddress: {countryCodeV2: 'US', zip: '90210'},
    });
    const result = detectOrderViolations(ok(node), RULES, ZONE);
    expect(result.violations).toEqual([
      {code: 'haul-away-outside-zone', lineIds: ['2']},
    ]);
    expect(JSON.stringify(result)).not.toContain('90210');
    expect(JSON.stringify(result)).not.toContain(SYNTHETIC_PII.name);
  });
});
