import {describe, expect, it} from 'vitest';
import {
  MAX_PRICE_POINTS,
  buildPricePointIndex,
  isPricePointName,
  matchPlansToPricePoints,
  parsePricePointName,
  type PricePointVariant,
} from '~/lib/extend/price-points';
import type {ExtendOffer, ExtendPlan} from '~/lib/extend/types';

function plan(id: string, priceCents: number): ExtendPlan {
  return {
    id,
    priceCents,
    title: `Plan ${id}`,
    contract: {
      category: 'mattress',
      coverageIncludes: 'adh',
      coverageStarts: 'immediate',
      deductible: 0,
      termLength: 36,
    },
    url: 'https://example.invalid/terms',
    offerPlanId: null,
    imageUrl: null,
  };
}

function offer(
  adh: ExtendPlan[],
  base: ExtendPlan[] = [],
  recommended: 'adh' | 'base' | null = 'adh',
): ExtendOffer {
  return {
    offerId: 'o1',
    plans: {adh, base, recommended},
    coveredProducts: [
      {productId: '501', quantity: 1, purchasePriceCents: 129900},
    ],
  };
}

function variant(
  priceCents: number,
  id = String(priceCents),
): PricePointVariant {
  const dollars = Math.floor(priceCents / 100);
  const rest = String(priceCents % 100).padStart(2, '0');
  return {
    variantId: `gid://shopify/ProductVariant/${id}`,
    name: `Extend-Protection-Plan-${dollars}.${rest}`,
    priceCents,
  };
}

describe('price-point name parsing (REQ-EXT-002)', () => {
  it.each([
    ['Extend-Protection-Plan-14.99', 1499],
    ['Extend-Protection-Plan-149.99', 14999],
    ['Extend-Protection-Plan-9.5', 950],
    ['Extend-Protection-Plan-20', 2000],
    ['Extend-Protection-Plan-0.99', 99],
    ['Extend-Protection-Plan-99999.99', 9_999_999],
    ['  Extend-Protection-Plan-14.99  ', 1499],
  ])('%j -> %i cents', (name, cents) => {
    expect(parsePricePointName(name)).toEqual({
      status: 'ok',
      priceCents: cents,
    });
    expect(isPricePointName(name)).toBe(true);
  });

  it.each([
    [''],
    ['Extend-Protection-Plan-'],
    ['Extend-Protection-Plan-abc'],
    ['Extend-Protection-Plan--14.99'],
    ['Extend-Protection-Plan-+14.99'],
    ['Extend-Protection-Plan-14.999'],
    ['Extend-Protection-Plan-14.'],
    ['Extend-Protection-Plan-.99'],
    ['Extend-Protection-Plan-014.99'],
    ['Extend-Protection-Plan-1,499.00'],
    ['Extend-Protection-Plan-1e3'],
    ['Extend-Protection-Plan-0'],
    ['Extend-Protection-Plan-0.00'],
    ['Extend-Protection-Plan-100000.00'],
    ['Extend-Protection-Plan-14.99 extra'],
    ['Extend-Protection-Plan-14.99\n<script>'],
    ['extend-protection-plan-14.99'],
    ['Extend Protection Plan 14.99'],
    ['Extend-Protection-Plan14.99'],
    ['Prefix-Extend-Protection-Plan-14.99'],
  ])('rejects the malformed name %j', (name) => {
    expect(parsePricePointName(name)).toEqual({
      status: 'error',
      reason: 'malformed_name',
    });
    expect(isPricePointName(name)).toBe(false);
  });
});

describe('price-point index (REQ-EXT-002, ADR-0009 decision 1)', () => {
  it('indexes valid variants by exact price', () => {
    const index = buildPricePointIndex([variant(1499), variant(7999)]);
    expect([...index.byPriceCents.keys()].sort((a, b) => a - b)).toEqual([
      1499, 7999,
    ]);
    expect(index.rejected).toEqual([]);
  });

  it('rejects entries whose name and real price disagree (a catalog error must never become a wrong charge)', () => {
    const bad: PricePointVariant = {
      variantId: 'v-bad',
      name: 'Extend-Protection-Plan-79.99',
      priceCents: 6999,
    };
    const index = buildPricePointIndex([bad, variant(7999, 'v-ok')]);
    expect(index.rejected).toEqual([
      {variantId: 'v-bad', reason: 'price_mismatch'},
    ]);
    expect(index.byPriceCents.get(7999)?.variantId).toBe(
      'gid://shopify/ProductVariant/v-ok',
    );
    expect(index.byPriceCents.has(6999)).toBe(false);
  });

  it.each([
    [
      {variantId: 'v1', name: 'Extend-Protection-Plan-abc', priceCents: 1000},
      'malformed_name',
    ],
    [
      {variantId: 'v2', name: 'Something else', priceCents: 1000},
      'malformed_name',
    ],
    [
      {variantId: 'v3', name: 'Extend-Protection-Plan-10.00', priceCents: 0},
      'invalid_price',
    ],
    [
      {
        variantId: 'v4',
        name: 'Extend-Protection-Plan-10.00',
        priceCents: -1000,
      },
      'invalid_price',
    ],
    [
      {
        variantId: 'v5',
        name: 'Extend-Protection-Plan-10.00',
        priceCents: 1000.5,
      },
      'invalid_price',
    ],
    [
      {
        variantId: 'v6',
        name: 'Extend-Protection-Plan-10.00',
        priceCents: Number.NaN,
      },
      'invalid_price',
    ],
  ])('rejects %j as %s', (entry, reason) => {
    const index = buildPricePointIndex([entry]);
    expect(index.byPriceCents.size).toBe(0);
    expect(index.rejected).toEqual([{variantId: entry.variantId, reason}]);
  });

  it('keeps one variant per price and reports the duplicate, independent of input order', () => {
    const a = variant(1499, 'a');
    const b = variant(1499, 'b');
    const forward = buildPricePointIndex([a, b]);
    const backward = buildPricePointIndex([b, a]);
    expect(forward.byPriceCents.get(1499)?.variantId).toBe(a.variantId);
    expect(backward.byPriceCents.get(1499)?.variantId).toBe(a.variantId);
    expect(forward.rejected).toEqual([
      {variantId: b.variantId, reason: 'duplicate_price'},
    ]);
  });

  it(`never indexes more than ${MAX_PRICE_POINTS} price points (Extend's documented maximum)`, () => {
    const many = Array.from({length: MAX_PRICE_POINTS + 5}, (_, i) =>
      variant(100 + i, String(1000 + i)),
    );
    const index = buildPricePointIndex(many);
    expect(index.byPriceCents.size).toBe(MAX_PRICE_POINTS);
    expect(
      index.rejected.filter((r) => r.reason === 'over_limit'),
    ).toHaveLength(5);
  });
});

describe('plan matching (REQ-EXT-002: hide an offer unless the price equals a variant price)', () => {
  const index = buildPricePointIndex([
    variant(7999),
    variant(9999),
    variant(5999),
  ]);

  it('returns only plans whose price exactly equals a price-point variant, with the variant to add', () => {
    const result = matchPlansToPricePoints(
      offer(
        [plan('A', 7999), plan('B', 9999), plan('C', 17777)],
        [plan('D', 5999)],
      ),
      index,
    );
    expect(
      result.matched.map((m) => [m.plan.id, m.planType, m.variantId]),
    ).toEqual([
      ['A', 'adh', 'gid://shopify/ProductVariant/7999'],
      ['B', 'adh', 'gid://shopify/ProductVariant/9999'],
      ['D', 'base', 'gid://shopify/ProductVariant/5999'],
    ]);
    expect(result.hidden).toEqual([
      {planId: 'C', priceCents: 17777, reason: 'no_price_point'},
    ]);
  });

  it('marks the recommended family', () => {
    const result = matchPlansToPricePoints(
      offer([plan('A', 7999)], [plan('D', 5999)], 'base'),
      index,
    );
    expect(result.matched.map((m) => [m.plan.id, m.recommended])).toEqual([
      ['A', false],
      ['D', true],
    ]);
  });

  it.each([[7998], [8000], [79], [799_900], [0]])(
    'hides a plan that is %i cents (near misses never match)',
    (price) => {
      const result = matchPlansToPricePoints(offer([plan('X', price)]), index);
      expect(result.matched).toEqual([]);
      expect(result.hidden).toHaveLength(1);
    },
  );

  it('hides everything when the catalog has no valid price points', () => {
    const empty = buildPricePointIndex([]);
    const result = matchPlansToPricePoints(offer([plan('A', 7999)]), empty);
    expect(result.matched).toEqual([]);
    expect(result.hidden).toHaveLength(1);
  });
});
