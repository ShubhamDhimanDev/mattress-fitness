import {describe, expect, it} from 'vitest';
import {giftLinesNotFree} from './gift-price';
import {RULES, VARIANT, gift, makeCart, mattressA} from './test-fixtures';

// REQ-PROMO-001 / REQ-CART-002 / T-02: a gift that Shopify does not price at 0 is flagged, whatever the browser says.
describe('giftLinesNotFree', () => {
  const cart = makeCart([mattressA('Queen'), gift(VARIANT.giftStandard, 'g1')]);

  it('does not flag a gift Shopify prices at 0', () => {
    expect(giftLinesNotFree(cart, RULES, new Map([['g1', 0]]))).toEqual([]);
  });

  it.each([
    ['charged in full', 4900],
    ['charged one cent', 1],
    ['a negative total', -1],
    ['a fractional total', 0.5],
  ])('flags a gift with %s', (_name, cents) => {
    expect(giftLinesNotFree(cart, RULES, new Map([['g1', cents]]))).toEqual([
      'g1',
    ]);
  });

  it('flags a gift whose total could not be read (cannot confirm it is free)', () => {
    expect(giftLinesNotFree(cart, RULES, new Map())).toEqual(['g1']);
  });

  it('never looks at ordinary lines, however they are priced', () => {
    expect(
      giftLinesNotFree(
        cart,
        RULES,
        new Map([
          ['mattress-queen', 100000],
          ['g1', 0],
        ]),
      ),
    ).toEqual([]);
  });

  it('with no gift rules and no gift role nothing is a gift, so nothing is flagged', () => {
    const plain = makeCart([
      mattressA('Queen'),
      {id: 'g1', variantId: VARIANT.giftStandard},
    ]);
    expect(
      giftLinesNotFree(plain, {...RULES, gifts: []}, new Map([['g1', 4900]])),
    ).toEqual([]);
  });

  it('flags only the gift lines that are not free', () => {
    const two = makeCart([
      mattressA('Queen'),
      gift(VARIANT.giftStandard, 'g1'),
      gift(VARIANT.giftStandard, 'g2'),
    ]);
    expect(
      giftLinesNotFree(
        two,
        RULES,
        new Map([
          ['g1', 0],
          ['g2', 4900],
        ]),
      ),
    ).toEqual(['g2']);
  });
});
