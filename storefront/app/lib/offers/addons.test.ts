import {describe, expect, it} from 'vitest';
import {matchingAddOnOffers} from '~/lib/offers/addons';
import {prepareCart} from '~/lib/offers/lines';
import type {MatchingAddOnRules} from '~/lib/offers/types';
import {
  PRODUCT,
  RULES,
  VARIANT,
  makeCart,
  makeLine,
  mattressA,
} from '~/lib/offers/test-fixtures';

function offers(
  lines: Parameters<typeof makeCart>[0],
  rules: MatchingAddOnRules = RULES.matchingAddOns,
) {
  return matchingAddOnOffers(prepareCart(makeCart(lines), RULES), rules);
}

// REQ-ADD-001 (size-matched add-ons), REQ-CART-003 (offers match the mattress; none when no rule applies).
describe('matchingAddOnOffers (REQ-ADD-001, REQ-CART-003)', () => {
  it('offers the foundation in the mattress size plus size-independent pillows', () => {
    expect(offers([mattressA('Queen')])).toEqual([
      {
        category: 'foundation',
        mattressLineId: 'mattress-queen',
        mattressProductId: PRODUCT.mattressA,
        size: 'Queen',
        productId: PRODUCT.foundation,
        variantId: VARIANT.foundQueen,
      },
      {
        category: 'pillow',
        mattressLineId: 'mattress-queen',
        mattressProductId: PRODUCT.mattressA,
        size: 'Queen',
        productId: PRODUCT.pillow,
        variantId: VARIANT.pillow,
      },
    ]);
  });

  it('changing the mattress size swaps the offered variant', () => {
    const foundation = offers([mattressA('King')]).find(
      (o) => o.category === 'foundation',
    );
    expect(foundation?.variantId).toBe(VARIANT.foundKing);
  });

  it('offers no sized add-on for a size without a relation', () => {
    expect(offers([mattressA('Twin')]).map((o) => o.category)).toEqual([
      'pillow',
    ]);
  });

  it('matches sizes ignoring case and spacing', () => {
    const line = mattressA('Queen', {size: ' QUEEN '});
    expect(offers([line]).some((o) => o.category === 'foundation')).toBe(true);
  });

  it('offers nothing when no rule applies', () => {
    expect(offers([makeLine({id: 'x'})])).toEqual([]);
    expect(offers([])).toEqual([]);
    expect(
      offers([mattressA('Queen')], {
        foundations: [],
        protectors: [],
        pillows: [],
        bedding: [],
      }),
    ).toEqual([]);
  });

  it('does not offer a variant that is already in the cart', () => {
    const inCart = makeLine({
      id: 'f1',
      variantId: VARIANT.foundQueen,
      productId: PRODUCT.foundation,
    });
    expect(offers([mattressA('Queen'), inCart]).map((o) => o.category)).toEqual(
      ['pillow'],
    );
  });

  it('shares one offer between two mattresses of the same size', () => {
    const second = mattressA('Queen', {id: 'second'});
    expect(
      offers([mattressA('Queen'), second]).map((o) => o.mattressLineId),
    ).toEqual(['mattress-queen', 'mattress-queen']);
  });

  it('offers per size for mattresses of different sizes', () => {
    const variants = offers([mattressA('Queen'), mattressA('King')])
      .filter((o) => o.category === 'foundation')
      .map((o) => o.variantId);
    expect(variants).toEqual([VARIANT.foundQueen, VARIANT.foundKing]);
  });

  it('does not offer a sized add-on for a mattress with no size', () => {
    const line = makeLine({id: 'm', productId: PRODUCT.mattressA, size: null});
    expect(offers([line]).map((o) => o.category)).toEqual(['pillow']);
  });

  it('ignores mattresses with malformed quantities and offer-only lines', () => {
    expect(offers([mattressA('Queen', {quantity: 0})])).toEqual([]);
    expect(offers([mattressA('Queen', {quantity: Number.NaN})])).toEqual([]);
  });

  it('does not treat a gift line as a mattress even if it carries the mattress product id', () => {
    const fake = makeLine({
      id: 'g',
      productId: PRODUCT.mattressA,
      variantId: VARIANT.giftStandard,
      role: 'gift',
      size: 'Queen',
    });
    expect(offers([fake])).toEqual([]);
  });

  it('keeps the category order foundation, protector, pillow, bedding', () => {
    const rules: MatchingAddOnRules = {
      foundations: [],
      protectors: [
        {
          mattressProductId: PRODUCT.mattressA,
          size: null,
          productId: 'p1',
          variantId: 'v-prot',
        },
      ],
      pillows: [
        {
          mattressProductId: PRODUCT.mattressA,
          size: null,
          productId: 'p2',
          variantId: 'v-pil',
        },
      ],
      bedding: [
        {
          mattressProductId: PRODUCT.mattressA,
          size: 'Queen',
          productId: 'p3',
          variantId: 'v-bed',
        },
      ],
    };
    expect(offers([mattressA('Queen')], rules).map((o) => o.category)).toEqual([
      'protector',
      'pillow',
      'bedding',
    ]);
  });
});

// REQ-ADD-001: a size is matched whole, so "Twin" never stands in for "Twin XL" and "Full" never for "Full XL".
describe('matchingAddOnOffers size matching is exact (REQ-ADD-001)', () => {
  const only = (size: string): MatchingAddOnRules => ({
    foundations: [
      {
        mattressProductId: PRODUCT.mattressA,
        size,
        productId: PRODUCT.foundation,
        variantId: VARIANT.foundQueen,
      },
    ],
    protectors: [],
    pillows: [],
    bedding: [],
  });

  it.each([
    ['Twin', 'Twin XL'],
    ['Twin XL', 'Twin'],
    ['Full', 'Full XL'],
    ['Full XL', 'Full'],
  ])('a %s add-on is not offered for a %s mattress', (relation, mattress) => {
    expect(offers([mattressA(mattress)], only(relation))).toEqual([]);
  });

  it.each(['Twin', 'Twin XL', 'Full', 'Full XL'])(
    'a %s add-on is offered for the same size, whatever the case or spacing',
    (size) => {
      expect(
        offers([mattressA(`  ${size.toUpperCase()} `)], only(size)),
      ).toHaveLength(1);
    },
  );
});
