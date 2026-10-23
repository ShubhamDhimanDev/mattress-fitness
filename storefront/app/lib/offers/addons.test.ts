import {describe, expect, it} from 'vitest';
import {
  addOnRelationsFor,
  matchingAddOnOffers,
  relationFitsSize,
} from '~/lib/offers/addons';
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

// REQ-ADD-001 (P4-03): the product page asks the same rules, by mattress product, before any size is chosen.
describe('addOnRelationsFor (REQ-ADD-001)', () => {
  it('returns every relation of the mattress product, in category order, for all sizes', () => {
    expect(
      addOnRelationsFor(RULES.matchingAddOns, PRODUCT.mattressA).map(
        ({category, relation}) => [category, relation.variantId],
      ),
    ).toEqual([
      ['foundation', VARIANT.foundQueen],
      ['foundation', VARIANT.foundKing],
      ['pillow', VARIANT.pillow],
    ]);
  });

  it('can be limited to the categories a page offers', () => {
    expect(
      addOnRelationsFor(RULES.matchingAddOns, PRODUCT.mattressA, [
        'foundation',
      ]).map(({relation}) => relation.variantId),
    ).toEqual([VARIANT.foundQueen, VARIANT.foundKing]);
  });

  it.each([
    ['a product with no relation', PRODUCT.mattressB],
    ['a product that is not a mattress', PRODUCT.other],
    ['an empty id', ''],
  ])('offers nothing for %s', (_name, productId) => {
    expect(addOnRelationsFor(RULES.matchingAddOns, productId)).toEqual([]);
  });

  it('offers nothing when no rule is configured at all', () => {
    expect(
      addOnRelationsFor(
        {foundations: [], protectors: [], pillows: [], bedding: []},
        PRODUCT.mattressA,
      ),
    ).toEqual([]);
  });

  it('agrees with the cart engine: the relations that fit a size are exactly the offers for that size', () => {
    for (const size of ['Queen', 'King', 'Twin', 'queen ']) {
      const fromProduct = addOnRelationsFor(
        RULES.matchingAddOns,
        PRODUCT.mattressA,
      )
        .filter(({relation}) => relationFitsSize(relation, size))
        .map(({relation}) => relation.variantId);
      const fromCart = offers([mattressA(size)]).map((o) => o.variantId);
      expect(fromProduct).toEqual(fromCart);
    }
  });
});

describe('relationFitsSize (REQ-ADD-001)', () => {
  const relation = (size: string | null) => ({
    mattressProductId: PRODUCT.mattressA,
    size,
    productId: PRODUCT.foundation,
    variantId: VARIANT.foundQueen,
  });

  it.each([
    ['Queen', 'Queen', true],
    ['Queen', '  QUEEN ', true],
    ['Cal  King', 'cal king', true],
    ['Queen', 'King', false],
    ['Twin', 'Twin XL', false],
    ['Queen', null, false],
    [null, 'Queen', true],
    [null, null, true],
  ])(
    'relation size %j against mattress size %j is %s',
    (wanted, size, fits) => {
      expect(relationFitsSize(relation(wanted), size)).toBe(fits);
    },
  );
});
