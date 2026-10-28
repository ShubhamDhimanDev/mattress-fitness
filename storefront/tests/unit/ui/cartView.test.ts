import {describe, expect, it} from 'vitest';
import {
  coverageTermMonths,
  deliverySummary,
  freeDeliveryView,
  freeGiftValue,
  isCoverageLine,
  isFreeGiftLine,
  itemCountText,
  moneyText,
  totalView,
} from '~/components/cart/cart-view';

// CR-31 cart redesign: the pure display decisions. REQ-CART-001 (lines), REQ-CART-004 (free-delivery progress),
// REQ-PROMO-001 (gift at zero), REQ-EXT-002 (protection linked to its item). None of these computes a price.

const usd = (amount: string) => ({amount, currencyCode: 'USD'});
const named = [
  {
    targetType: 'LINE_ITEM',
    title: 'Free pillow',
    discountedAmount: usd('59.00'),
  },
];

describe('isCoverageLine (REQ-EXT-002)', () => {
  it.each([
    ['a server-written plan id', [{key: '_extend_plan_id', value: 'P1'}], true],
    ['no attributes', [], false],
    ['an empty plan id', [{key: '_extend_plan_id', value: ''}], false],
    ['an unrelated attribute', [{key: 'Engraving', value: 'x'}], false],
  ])('%s', (_name, attributes, expected) => {
    expect(isCoverageLine({attributes})).toBe(expected);
    expect(isCoverageLine({})).toBe(false);
  });
});

describe('coverageTermMonths', () => {
  it.each([
    ['36', 36],
    ['6', 6],
    ['0', null],
    ['-12', null],
    ['12.5', null],
    ['abc', null],
    ['<script>', null],
    ['1000', null],
  ])('reads %j as %j', (value, expected) => {
    expect(
      coverageTermMonths({attributes: [{key: '_extend_term', value}]}),
    ).toBe(expected);
  });
  it('is null without the attribute', () => {
    expect(coverageTermMonths({attributes: []})).toBeNull();
  });
});

describe('isFreeGiftLine and freeGiftValue (REQ-PROMO-001)', () => {
  const free = {
    cost: {totalAmount: usd('0.0'), subtotalAmount: usd('59.0')},
    discountAllocations: named,
  };

  it('labels a zero-priced line that a named line discount emptied', () => {
    expect(isFreeGiftLine(free)).toBe(true);
    expect(freeGiftValue(free)).toEqual(usd('59.0'));
  });

  it.each([
    [
      'a paid line',
      {...free, cost: {totalAmount: usd('59.0'), subtotalAmount: usd('59.0')}},
    ],
    [
      'a zero line with no discount (not a promotion)',
      {...free, discountAllocations: []},
    ],
    ['an optimistic line with no cost yet', {discountAllocations: named}],
    ['an unreadable amount', {...free, cost: {totalAmount: usd('free')}}],
    [
      'a coverage line, even at zero',
      {...free, attributes: [{key: '_extend_plan_id', value: 'P1'}]},
    ],
    [
      'an order-level allocation',
      {
        ...free,
        discountAllocations: [{...named[0], targetType: 'ORDER'}],
      },
    ],
  ])('does not label %s as a gift', (_name, line) => {
    expect(isFreeGiftLine(line)).toBe(false);
    expect(freeGiftValue(line)).toBeNull();
  });

  it('shows no struck-through value when Shopify reports none above zero', () => {
    expect(
      freeGiftValue({
        ...free,
        cost: {totalAmount: usd('0.0'), subtotalAmount: usd('0.0')},
      }),
    ).toBeNull();
  });
});

describe('freeDeliveryView and deliverySummary (REQ-CART-004)', () => {
  const open = {
    enabled: true,
    thresholdCents: 99900,
    subtotalCents: 69900,
    remainingCents: 30000,
    reached: false,
    percent: 69,
  } as const;
  const reached = {
    ...open,
    subtotalCents: 120000,
    remainingCents: 0,
    reached: true,
    percent: 100,
  } as const;

  it('is off without progress or when the admin switched it off', () => {
    expect(freeDeliveryView(null)).toEqual({status: 'off'});
    expect(freeDeliveryView(undefined)).toEqual({status: 'off'});
    expect(freeDeliveryView({enabled: false})).toEqual({status: 'off'});
  });

  it('names the threshold from the admin figure and the remaining amount', () => {
    expect(freeDeliveryView(open)).toEqual({
      status: 'open',
      message: 'You are $300 away from free delivery.',
      percent: 69,
      threshold: '$999',
    });
  });

  it('is reached at the threshold', () => {
    const view = freeDeliveryView(reached);
    expect(view.status).toBe('reached');
    expect(view.status === 'reached' && view.percent).toBe(100);
  });

  it('says Free only once reached; otherwise Shopify decides at checkout', () => {
    expect(deliverySummary(reached)).toEqual({text: 'Free', free: true});
    expect(deliverySummary(open)).toEqual({
      text: 'Calculated at checkout',
      free: false,
    });
    expect(deliverySummary(null).free).toBe(false);
    expect(deliverySummary({enabled: false}).free).toBe(false);
  });
});

describe('totalView (RS-02 states for the estimated total)', () => {
  it.each([
    ['no cart', null],
    ['no cost', {}],
    ['a first optimistic add', {isOptimistic: true}],
    [
      'an empty amount',
      {cost: {totalAmount: {amount: '', currencyCode: 'USD'}}},
    ],
    ['no currency', {cost: {totalAmount: {amount: '1.0'}}}],
  ])('is pending for %s, never a value', (_name, cart) => {
    expect(totalView(cart)).toEqual({status: 'pending'});
  });

  it('shows Shopify total as returned, flagged while a change is in flight', () => {
    const total = usd('2497.0');
    expect(totalView({cost: {totalAmount: total}})).toEqual({
      status: 'ready',
      amount: total,
      updating: false,
    });
    expect(totalView({isOptimistic: true, cost: {totalAmount: total}})).toEqual(
      {
        status: 'ready',
        amount: total,
        updating: true,
      },
    );
  });
});

describe('small formatters', () => {
  it.each([
    [0, '0 items'],
    [1, '1 item'],
    [3, '3 items'],
    [-2, '0 items'],
    [1.5, '0 items'],
    [null, '0 items'],
    [undefined, '0 items'],
  ])('counts %j as %j', (count, expected) => {
    expect(itemCountText(count)).toBe(expected);
  });

  it('formats a USD amount and drops one the money helper rejects', () => {
    expect(moneyText(usd('1999.0'))).toBe('$1,999.00');
    expect(moneyText(usd('abc'))).toBeNull();
    expect(moneyText({amount: '5.00', currencyCode: 'EUR'})).toBeNull();
    expect(moneyText(null)).toBeNull();
  });
});
