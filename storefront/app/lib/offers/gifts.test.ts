import {describe, expect, it} from 'vitest';
import {
  eligibleGifts,
  evaluateGifts,
  giftRemovals,
  giftSizeOptions,
} from '~/lib/offers/gifts';
import {prepareCart} from '~/lib/offers/lines';
import type {GiftRule, OfferRules} from '~/lib/offers/types';
import {
  GIFT_PILLOWS,
  GIFT_SHEETS,
  PRODUCT,
  RULES,
  VARIANT,
  gift,
  makeCart,
  makeLine,
  mattressA,
} from '~/lib/offers/test-fixtures';

function run(lines: Parameters<typeof makeCart>[0], rules: OfferRules = RULES) {
  return evaluateGifts(prepareCart(makeCart(lines), rules), rules.gifts);
}

const OFFER_PILLOWS = {
  ruleId: 'gift-pillows',
  name: 'Free pillows',
  remainingQuantity: 1,
  sizes: [
    {size: 'Standard', variantId: VARIANT.giftStandard},
    {size: 'King', variantId: VARIANT.giftKing},
  ],
};

// REQ-CART-002 (gift only while a qualifying item is present), REQ-PROMO-001, REQ-PRE-006 (expired gift).
describe('giftSizeOptions (REQ-CART-002)', () => {
  it('lists the sizes in the order the rule gives them', () => {
    expect(giftSizeOptions(GIFT_PILLOWS)).toEqual(OFFER_PILLOWS.sizes);
  });

  it('skips blank sizes and blank variant ids and repeated sizes', () => {
    const rule: GiftRule = {
      ...GIFT_PILLOWS,
      giftVariantIdsBySize: {
        Standard: 'v1',
        ' standard': 'v2',
        King: '',
        '': 'v3',
      },
    };
    expect(giftSizeOptions(rule)).toEqual([
      {size: 'Standard', variantId: 'v1'},
    ]);
  });

  it('offers nothing for an empty rule', () => {
    expect(
      giftSizeOptions({...GIFT_PILLOWS, giftVariantIdsBySize: {}}),
    ).toEqual([]);
  });
});

describe('evaluateGifts: which gifts are offered (REQ-CART-002)', () => {
  it('offers the gift while a qualifying product is in the cart', () => {
    expect(run([mattressA('Queen')]).offers).toEqual([OFFER_PILLOWS]);
  });

  it('offers nothing for an empty cart or non-qualifying products', () => {
    expect(run([]).offers).toEqual([]);
    expect(run([makeLine({id: 'x'})]).offers).toEqual([]);
  });

  it('qualifies by collection', () => {
    const premium = makeLine({
      id: 'm',
      productId: 'p-unknown',
      collectionIds: ['c-premium'],
    });
    expect(run([premium]).offers).toEqual([OFFER_PILLOWS]);
  });

  it('does not qualify on an unrelated collection', () => {
    const line = makeLine({
      id: 'm',
      productId: 'p-unknown',
      collectionIds: ['c-other'],
    });
    expect(run([line]).offers).toEqual([]);
  });

  it('offers each rule whose qualifier is present', () => {
    const lines = [
      mattressA('Queen'),
      makeLine({id: 'b', productId: PRODUCT.mattressB, size: 'Queen'}),
    ];
    expect(
      run(lines).offers.map((offer) => [offer.ruleId, offer.remainingQuantity]),
    ).toEqual([
      ['gift-pillows', 1],
      ['gift-sheets', 2],
    ]);
  });

  it('stops offering once the allowance is used and offers the remainder before that', () => {
    const lines = [
      makeLine({id: 'b', productId: PRODUCT.mattressB, size: 'Queen'}),
      gift(VARIANT.giftSheetsQueen, 'g1'),
    ];
    expect(run(lines).offers).toEqual([
      {
        ruleId: 'gift-sheets',
        name: 'Free sheets',
        remainingQuantity: 1,
        sizes: [{size: 'Queen', variantId: VARIANT.giftSheetsQueen}],
      },
    ]);
    expect(
      run([
        ...lines,
        gift(VARIANT.giftSheetsQueen, 'g2', {attributes: {n: '2'}}),
      ]).offers,
    ).toEqual([]);
  });

  it('a gift line cannot qualify another gift', () => {
    const lines = [
      gift(VARIANT.giftStandard, 'g1', {productId: PRODUCT.mattressA}),
    ];
    expect(run(lines).offers).toEqual([]);
  });

  it('a malformed qualifying line does not qualify', () => {
    expect(run([mattressA('Queen', {quantity: 0})]).offers).toEqual([]);
    expect(run([mattressA('Queen', {quantity: -3})]).offers).toEqual([]);
    expect(run([mattressA('Queen', {quantity: 1.5})]).offers).toEqual([]);
  });

  it.each([-1, 1.5, Number.NaN, 0])(
    'offers nothing from a rule with maxQuantity %s',
    (maxQuantity) => {
      const rules = {...RULES, gifts: [{...GIFT_PILLOWS, maxQuantity}]};
      expect(run([mattressA('Queen')], rules).offers).toEqual([]);
    },
  );
});

describe('evaluateGifts: orphan, duplicate and unknown gifts (REQ-CART-002, REQ-PROMO-001, REQ-PRE-006)', () => {
  it('keeps a gift while its qualifier is present', () => {
    const result = run([mattressA('Queen'), gift(VARIANT.giftStandard, 'g1')]);
    expect(result.corrections).toEqual([]);
    expect(result.offers).toEqual([]); // allowance used
  });

  it('removes the gift when the qualifying line is gone (orphan)', () => {
    expect(run([gift(VARIANT.giftStandard, 'g1')]).corrections).toEqual([
      {type: 'remove-line', lineId: 'g1', reason: 'orphan-gift'},
    ]);
  });

  it('removes the gift when only a non-qualifying line remains', () => {
    expect(
      run([makeLine({id: 'x'}), gift(VARIANT.giftStandard, 'g1')]).corrections,
    ).toEqual([{type: 'remove-line', lineId: 'g1', reason: 'orphan-gift'}]);
  });

  it('removes the gift when its qualifier has a malformed quantity', () => {
    expect(
      run([mattressA('Queen', {quantity: 0}), gift(VARIANT.giftStandard, 'g1')])
        .corrections,
    ).toEqual([{type: 'remove-line', lineId: 'g1', reason: 'orphan-gift'}]);
  });

  it("keeps one qualifier's gift when another qualifier remains", () => {
    const lines = [
      mattressA('Queen'),
      mattressA('King'),
      gift(VARIANT.giftStandard, 'g1'),
    ];
    expect(run(lines).corrections).toEqual([]);
  });

  it('removes only the gift of the rule whose qualifier left', () => {
    const lines = [
      mattressA('Queen'),
      gift(VARIANT.giftStandard, 'g-pillow'),
      gift(VARIANT.giftSheetsQueen, 'g-sheets'),
    ];
    expect(run(lines).corrections).toEqual([
      {type: 'remove-line', lineId: 'g-sheets', reason: 'orphan-gift'},
    ]);
  });

  it('removes a second gift line for one qualifier (two gifts for one qualifier)', () => {
    const lines = [
      mattressA('Queen'),
      gift(VARIANT.giftStandard, 'g1'),
      gift(VARIANT.giftKing, 'g2'),
    ];
    expect(run(lines).corrections).toEqual([
      {type: 'remove-line', lineId: 'g2', reason: 'duplicate-gift'},
    ]);
  });

  it.each([2, 5, Number.MAX_SAFE_INTEGER])(
    'clamps a gift line of %i to the allowance',
    (quantity) => {
      expect(
        run([mattressA('Queen'), gift(VARIANT.giftStandard, 'g1', {quantity})])
          .corrections,
      ).toEqual([
        {
          type: 'set-quantity',
          lineId: 'g1',
          quantity: 1,
          previousQuantity: quantity,
          reason: 'gift-over-limit',
        },
      ]);
    },
  );

  it('shares an allowance of two across lines in cart order', () => {
    const lines = [
      makeLine({id: 'b', productId: PRODUCT.mattressB, size: 'Queen'}),
      gift(VARIANT.giftSheetsQueen, 'g1', {quantity: 1}),
      gift(VARIANT.giftSheetsQueen, 'g2', {quantity: 2, attributes: {n: '2'}}),
    ];
    expect(run(lines).corrections).toEqual([
      {
        type: 'set-quantity',
        lineId: 'g2',
        quantity: 1,
        previousQuantity: 2,
        reason: 'gift-over-limit',
      },
    ]);
  });

  it('removes a gift line that no rule offers any more (expired gift)', () => {
    const expired = gift('v-expired-gift', 'g1');
    expect(run([mattressA('Queen'), expired]).corrections).toEqual([
      {type: 'remove-line', lineId: 'g1', reason: 'gift-not-offered'},
    ]);
  });

  it('removes a gift whose size the rule does not offer', () => {
    // King exists for the pillows rule; this line carries a variant of a size that was dropped from it.
    const rules = {
      ...RULES,
      gifts: [
        {
          ...GIFT_PILLOWS,
          giftVariantIdsBySize: {Standard: VARIANT.giftStandard},
        },
      ],
    };
    const lines = [mattressA('Queen'), gift(VARIANT.giftKing, 'g1')];
    expect(run(lines, rules).corrections).toEqual([
      {type: 'remove-line', lineId: 'g1', reason: 'gift-not-offered'},
    ]);
  });

  it('removes every gift when the promotion is gone from the rules', () => {
    const rules = {...RULES, gifts: []};
    const lines = [mattressA('Queen'), gift(VARIANT.giftStandard, 'g1')];
    // With no rule the variant is unknown, so the role tag alone marks it as a gift to remove.
    expect(run(lines, rules).corrections).toEqual([
      {type: 'remove-line', lineId: 'g1', reason: 'gift-not-offered'},
    ]);
  });

  it('treats an unmarked line with a gift variant as a gift', () => {
    const untagged = makeLine({id: 'g1', variantId: VARIANT.giftStandard});
    expect(run([untagged]).corrections).toEqual([
      {type: 'remove-line', lineId: 'g1', reason: 'orphan-gift'},
    ]);
  });

  it('uses the first qualifying rule when two rules offer the same gift variant', () => {
    const shared: GiftRule = {
      ...GIFT_SHEETS,
      id: 'gift-shared',
      qualifyingProductIds: [PRODUCT.mattressA],
      giftVariantIdsBySize: {Standard: VARIANT.giftStandard},
      maxQuantity: 1,
    };
    const rules = {...RULES, gifts: [GIFT_PILLOWS, shared]};
    const lines = [
      mattressA('Queen'),
      gift(VARIANT.giftStandard, 'g1', {quantity: 2}),
    ];
    // Rule 1 takes one unit, rule 2 is not consulted for the same line: the extra unit is clamped, not doubled.
    expect(run(lines, rules).corrections).toEqual([
      {
        type: 'set-quantity',
        lineId: 'g1',
        quantity: 1,
        previousQuantity: 2,
        reason: 'gift-over-limit',
      },
    ]);
  });

  it('ignores gift lines with malformed quantities (the cart is refused elsewhere)', () => {
    const lines = [
      mattressA('Queen'),
      gift(VARIANT.giftStandard, 'g1', {quantity: -1}),
    ];
    expect(run(lines).corrections).toEqual([]);
  });
});

describe('gift helpers for the cart UI (REQ-CART-002)', () => {
  it('eligibleGifts and giftRemovals agree with the engine', () => {
    const withQualifier = makeCart([mattressA('Queen')]);
    expect(eligibleGifts(withQualifier, RULES)).toEqual([OFFER_PILLOWS]);
    expect(giftRemovals(withQualifier, RULES)).toEqual([]);

    const orphan = makeCart([gift(VARIANT.giftStandard, 'g1')]);
    expect(eligibleGifts(orphan, RULES)).toEqual([]);
    expect(giftRemovals(orphan, RULES)).toEqual([
      {type: 'remove-line', lineId: 'g1', reason: 'orphan-gift'},
    ]);
  });
});
