import {describe, expect, it} from 'vitest';
import cartFixture from '../../fixtures/shopify/cart.json';
import {toCartLike, type CartSource} from '~/lib/shopify/cart-mapper';
import {isCartActionResult, readCartMessages} from '~/lib/cart/messages';
import {
  linePromotions,
  visibleLineProperties,
  visibleOptions,
} from '~/lib/cart/lines';
import {evaluateOffers} from '~/lib/offers/evaluate';
import {EMPTY_OFFER_RULES} from '~/lib/offers/types';

// REQ-CART-001 / P4-02: the cart mapper feeds the offer engine; messages surface cart errors.
const recorded = cartFixture.cartCreate.cart;

describe('toCartLike', () => {
  it('maps a recorded cart (bedding.mock.shop)', () => {
    const cart = toCartLike(recorded);
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]).toEqual({
      id: 'gid://shopify/CartLine/60639',
      variantId: 'gid://shopify/ProductVariant/17581',
      productId: 'gid://shopify/Product/3208',
      quantity: 2,
      attributes: {'Gift note': 'Fixture'},
      size: 'Twin',
      parentLineId: null,
    });
    expect(cart.attributes).toEqual({delivery_choice: 'in-home'});
    expect(cart.subtotalCents).toBe(15000);
  });

  it('leaves roles unset so the server decides them', () => {
    expect('role' in toCartLike(recorded).lines[0]).toBe(false);
  });

  it('handles a missing cart and an empty cart', () => {
    expect(toCartLike(null)).toEqual({
      lines: [],
      attributes: {},
      subtotalCents: 0,
    });
    expect(toCartLike(undefined).lines).toEqual([]);
    expect(toCartLike({lines: {nodes: []}}).subtotalCents).toBe(0);
  });

  it('reads the nested-line parent, size case-insensitively, and skips lines without a variant', () => {
    const source: CartSource = {
      lines: {
        nodes: [
          {
            id: 'child',
            quantity: 1,
            attributes: [{key: 'k', value: null}],
            merchandise: {
              id: 'v2',
              product: {id: 'p2'},
              selectedOptions: [{name: 'size', value: 'King'}],
            },
            parentRelationship: {parent: {id: 'parent'}},
          },
          {id: 'gone', quantity: 1, merchandise: null},
          {id: 'no-product', quantity: 1, merchandise: {id: 'v3'}},
        ],
      },
      cost: {subtotalAmount: {amount: 'garbage'}},
    };
    const cart = toCartLike(source);
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]).toMatchObject({
      parentLineId: 'parent',
      size: 'King',
      attributes: {},
    });
    expect(cart.subtotalCents).toBe(0);
  });

  it('is accepted by the offer engine (shape check)', () => {
    const evaluation = evaluateOffers(toCartLike(recorded), EMPTY_OFFER_RULES, {
      zip: null,
      deliveryChoice: null,
      zone: null,
      protectionEligibleLineIds: [],
    });
    expect(evaluation.violations).toEqual([]);
    expect(evaluation.corrections).toEqual([]);
  });
});

describe('cart messages (userErrors and warnings)', () => {
  const result = (extra: Record<string, unknown>) => ({
    cart: null,
    analytics: {cartId: 'c'},
    ...extra,
  });

  it('collects errors then warnings, cleaned and de-duplicated', () => {
    const messages = readCartMessages(
      result({
        errors: [
          {message: 'Only 1 left in stock', code: 'X'},
          {message: 'Only 1 left in stock'},
        ],
        warnings: [
          {
            message: '  Quantity <b>reduced</b> ',
            code: 'MERCHANDISE_NOT_ENOUGH_STOCK',
          },
        ],
      }),
    );
    expect(messages).toEqual([
      {kind: 'error', text: 'Only 1 left in stock'},
      {kind: 'warning', text: 'Quantity reduced'},
    ]);
  });

  it('ignores data that is not a cart action result or has no messages', () => {
    expect(readCartMessages(undefined)).toEqual([]);
    expect(readCartMessages({q: 'x', result: {}})).toEqual([]);
    expect(
      readCartMessages(result({errors: 'boom', warnings: [1, null, {}]})),
    ).toEqual([]);
    expect(isCartActionResult({cart: null})).toBe(false);
    expect(isCartActionResult(result({}))).toBe(true);
  });

  it('bounds the number and length of messages', () => {
    const many = Array.from({length: 20}, (_, i) => ({message: `m${i}`}));
    expect(readCartMessages(result({errors: many}))).toHaveLength(5);
    const long = readCartMessages(
      result({errors: [{message: 'x'.repeat(1000)}]}),
    );
    expect(long[0].text).toHaveLength(240);
  });
});

describe('line display helpers', () => {
  it('shows properties except hidden (underscore) ones', () => {
    expect(
      visibleLineProperties([
        {key: 'Gift note', value: 'For Sam'},
        {key: '_offer_link', value: 'abc'},
        {key: 'Empty', value: ''},
        {key: 'Nullish', value: null},
      ]),
    ).toEqual([{label: 'Gift note', value: 'For Sam'}]);
    expect(visibleLineProperties(null)).toEqual([]);
  });

  it('hides the placeholder option of single-variant products', () => {
    expect(
      visibleOptions([
        {name: 'Title', value: 'Default Title'},
        {name: 'Size', value: 'Queen'},
      ]),
    ).toEqual([{name: 'Size', value: 'Queen'}]);
  });
});

// REQ-PROMO-001 / REQ-PROMO-002: the promotion Shopify applied to a line is shown with its name and Shopify's amount.
describe('linePromotions', () => {
  it('lists a named line-level discount with the amount Shopify took off', () => {
    expect(
      linePromotions([
        {
          targetType: 'LINE_ITEM',
          title: 'Free pillow',
          discountedAmount: {amount: '49.00'},
        },
      ]),
    ).toEqual([{title: 'Free pillow', amount: '$49.00'}]);
  });

  it.each([
    [
      'a shipping allocation',
      {
        targetType: 'SHIPPING_LINE',
        title: 'A',
        discountedAmount: {amount: '5.00'},
      },
    ],
    [
      'an unnamed discount',
      {
        targetType: 'LINE_ITEM',
        title: null,
        discountedAmount: {amount: '5.00'},
      },
    ],
    [
      'a zero amount',
      {targetType: 'LINE_ITEM', title: 'A', discountedAmount: {amount: '0.00'}},
    ],
    [
      'an unreadable amount',
      {targetType: 'LINE_ITEM', title: 'A', discountedAmount: {amount: 'abc'}},
    ],
    [
      'a missing amount',
      {targetType: 'LINE_ITEM', title: 'A', discountedAmount: null},
    ],
  ])('drops %s', (_name, allocation) => {
    expect(linePromotions([allocation])).toEqual([]);
  });

  it('adds the amounts of two allocations with the same title, so the title is a unique key', () => {
    const same = {
      targetType: 'LINE_ITEM',
      title: 'Sleep set saving',
      discountedAmount: {amount: '10.50'},
    };
    expect(linePromotions([same, same])).toEqual([
      {title: 'Sleep set saving', amount: '$21.00'},
    ]);
  });

  it('shows nothing for a line without allocations (an optimistic line)', () => {
    expect(linePromotions(undefined)).toEqual([]);
    expect(linePromotions(null)).toEqual([]);
  });

  it('strips markup from a title (it is text, never HTML)', () => {
    expect(
      linePromotions([
        {
          targetType: 'LINE_ITEM',
          title: '<b>Gift</b>',
          discountedAmount: {amount: '5.00'},
        },
      ])[0]?.title,
    ).not.toContain('<');
  });
});
