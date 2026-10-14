import {describe, expect, it} from 'vitest';
import {
  BENEFITS,
  COMFORT_LEVELS,
  MATTRESS_TYPES,
  SIZES,
  SLEEP_POSITIONS,
  isSize,
  matchCanonical,
  toSlug,
} from '~/lib/catalog/attributes';
import {buildVariants} from '~/lib/catalog/builders';
import {FIXTURE_PRODUCTS, getFixtureProduct} from '~/lib/catalog/fixtures';
import {
  availableVariants,
  isOnSale,
  isSoldOut,
  lowestAvailablePriceCents,
  savingsCents,
  sizesInOrder,
  variantForSize,
} from '~/lib/catalog/pricing';

// Real brands the fixtures must never use (the data is synthetic by rule).
const REAL_BRAND_FRAGMENTS = [
  'tempur',
  'sealy',
  'serta',
  'purple',
  'casper',
  'saatva',
  'nectar',
  'helix',
  'leesa',
  'tuft',
  'beautyrest',
  'simmons',
  'sleep number',
  'stearns',
  'kingsdown',
  'brooklyn',
  'avocado',
  'birch',
  'dreamcloud',
  'layla',
  'zinus',
  'nolah',
  'amerisleep',
  'winkbed',
  'ghostbed',
  'malouf',
  'corsicana',
  'spring air',
  'restonic',
  'mattress firm',
];

describe('attribute vocabularies (REQ-COL-002, REQ-QZ-003)', () => {
  it('holds exactly the value lists the SOW and data model name', () => {
    expect(SIZES).toEqual([
      'Twin',
      'Twin XL',
      'Full',
      'Queen',
      'King',
      'California King',
      'Split California King',
    ]);
    expect(COMFORT_LEVELS).toEqual([
      'Ultra Plush',
      'Plush',
      'Medium',
      'Firm',
      'Extra Firm',
    ]);
    expect(MATTRESS_TYPES).toEqual([
      'Memory Foam',
      'Hybrid',
      'Innerspring',
      'Foam',
      'Latex',
    ]);
    expect(BENEFITS).toEqual([
      'Cooling',
      'Pressure Relief',
      'Motion Separation',
      'Back Support',
      'Eco-Friendly',
    ]);
    expect(SLEEP_POSITIONS).toEqual(['Back', 'Side', 'Stomach']);
  });

  it('has no two values in one list that share a slug', () => {
    for (const list of [
      SIZES,
      COMFORT_LEVELS,
      MATTRESS_TYPES,
      BENEFITS,
      SLEEP_POSITIONS,
    ]) {
      const slugs = list.map((value) => toSlug(value));
      expect(new Set(slugs).size).toBe(list.length);
    }
  });

  it.each([
    ['memory foam', 'Memory Foam'],
    ['Memory-Foam', 'Memory Foam'],
    ['  MEMORY   FOAM ', 'Memory Foam'],
    ['MEMORY_FOAM', 'Memory Foam'],
    ['hybrid', 'Hybrid'],
  ])('matchCanonical maps %j to %j', (raw, expected) => {
    expect(matchCanonical(MATTRESS_TYPES, raw)).toBe(expected);
  });

  it.each([
    ['waterbed'],
    [''],
    ['   '],
    ['<script>'],
    ['x'.repeat(500)],
    [null],
    [undefined],
    [42],
    [{toString: () => 'Hybrid'}],
  ])('matchCanonical rejects %j', (raw) => {
    expect(matchCanonical(MATTRESS_TYPES, raw)).toBeNull();
  });

  it('isSize accepts only exact canonical labels', () => {
    expect(isSize('Queen')).toBe(true);
    expect(isSize('queen')).toBe(false);
    expect(isSize(undefined)).toBe(false);
  });
});

describe('catalog fixtures (REQ-COL-002, REQ-QZ-003 test data)', () => {
  it('has at least 14 products with unique ids, handles and variant ids', () => {
    expect(FIXTURE_PRODUCTS.length).toBeGreaterThanOrEqual(14);
    const handles = FIXTURE_PRODUCTS.map((p) => p.handle);
    expect(new Set(handles).size).toBe(handles.length);
    const ids = FIXTURE_PRODUCTS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    const variantIds = FIXTURE_PRODUCTS.flatMap((p) =>
      p.variants.map((v) => v.id),
    );
    expect(new Set(variantIds).size).toBe(variantIds.length);
  });

  it('uses only fictional brands and never a real one', () => {
    const brands = new Set(FIXTURE_PRODUCTS.map((p) => p.brand));
    expect(brands.size).toBeGreaterThanOrEqual(4);
    for (const text of FIXTURE_PRODUCTS.flatMap((p) => [p.brand, p.title])) {
      const lower = text.toLowerCase();
      for (const real of REAL_BRAND_FRAGMENTS) {
        expect(lower).not.toContain(real);
      }
    }
  });

  it('only uses values from the vocabularies and valid shapes', () => {
    for (const product of FIXTURE_PRODUCTS) {
      expect(COMFORT_LEVELS).toContain(product.comfortLevel);
      expect(MATTRESS_TYPES).toContain(product.mattressType);
      expect(product.sleepPositions.length).toBeGreaterThan(0);
      for (const position of product.sleepPositions) {
        expect(SLEEP_POSITIONS).toContain(position);
      }
      for (const benefit of product.benefits) {
        expect(BENEFITS).toContain(benefit);
      }
      expect(product.heightInches).toBeGreaterThan(0);
      expect(product.images.length).toBeGreaterThan(0);
      expect(product.variants.length).toBeGreaterThan(0);
    }
  });

  it('covers every comfort level and every mattress type', () => {
    expect(new Set(FIXTURE_PRODUCTS.map((p) => p.comfortLevel))).toEqual(
      new Set(COMFORT_LEVELS),
    );
    expect(new Set(FIXTURE_PRODUCTS.map((p) => p.mattressType))).toEqual(
      new Set(MATTRESS_TYPES),
    );
  });

  it('has realistic prices: integer cents, whole dollars, larger sizes cost more', () => {
    for (const product of FIXTURE_PRODUCTS) {
      let previous = 0;
      for (const variant of product.variants) {
        expect(Number.isInteger(variant.priceCents)).toBe(true);
        expect(variant.priceCents % 100).toBe(0);
        expect(variant.priceCents).toBeGreaterThan(0);
        if (variant.size !== 'California King') {
          expect(variant.priceCents).toBeGreaterThanOrEqual(previous);
          previous = variant.priceCents;
        }
      }
    }
    const prices = FIXTURE_PRODUCTS.map(
      (p) => variantForSize(p, 'Queen')?.priceCents ?? 0,
    );
    expect(Math.min(...prices)).toBeLessThan(50000);
    expect(Math.max(...prices)).toBeGreaterThan(200000);
  });

  it('has exactly one product on sale, with compare-at above price on every variant', () => {
    const onSale = FIXTURE_PRODUCTS.filter((p) =>
      p.variants.some((v) => isOnSale(v)),
    );
    expect(onSale.map((p) => p.handle)).toEqual([
      'larkmoor-cedar-plush-hybrid',
    ]);
    for (const variant of onSale[0]?.variants ?? []) {
      expect(isOnSale(variant)).toBe(true);
      expect(savingsCents(variant)).toBeGreaterThan(0);
    }
  });

  it('has products sold out in some sizes, one sold out everywhere, and one with missing sizes', () => {
    const firm = getFixtureProduct('wrenfield-solace-firm-memory-foam');
    expect(variantForSize(firm, 'King')?.available).toBe(false);
    expect(variantForSize(firm, 'Queen')?.available).toBe(true);
    expect(isSoldOut(firm)).toBe(false);

    expect(
      isSoldOut(getFixtureProduct('wrenfield-kestrel-extra-firm-hybrid')),
    ).toBe(true);

    const limited = getFixtureProduct('ashvale-fieldstone-medium-innerspring');
    expect(variantForSize(limited, 'Twin')).toBeNull();
    expect(limited.variants).toHaveLength(4);
  });

  it('has a rating on most products and null on at least one', () => {
    const rated = FIXTURE_PRODUCTS.filter((p) => p.rating !== null);
    expect(rated.length).toBeGreaterThan(10);
    expect(FIXTURE_PRODUCTS.some((p) => p.rating === null)).toBe(true);
    for (const product of rated) {
      expect(product.rating?.average).toBeGreaterThanOrEqual(1);
      expect(product.rating?.average).toBeLessThanOrEqual(5);
      expect(product.rating?.count).toBeGreaterThan(0);
    }
  });

  it('getFixtureProduct throws on an unknown handle', () => {
    expect(() => getFixtureProduct('nope')).toThrow(/Unknown fixture/);
  });
});

describe('catalog pricing helpers (REQ-CAT-002 price rules)', () => {
  it('From-price is the lowest AVAILABLE variant price, not the lowest overall', () => {
    const product = {
      ...getFixtureProduct('wrenfield-solace-plush-memory-foam'),
      variants: [
        {
          id: 'a',
          size: 'Twin' as const,
          sku: null,
          dimensions: null,
          priceCents: 50000,
          compareAtCents: null,
          available: false,
        },
        {
          id: 'b',
          size: 'Queen' as const,
          sku: null,
          dimensions: null,
          priceCents: 90000,
          compareAtCents: null,
          available: true,
        },
      ],
    };
    expect(lowestAvailablePriceCents(product)).toBe(90000);
    expect(availableVariants(product)).toHaveLength(1);
  });

  it('returns null when nothing is available', () => {
    expect(
      lowestAvailablePriceCents(
        getFixtureProduct('wrenfield-kestrel-extra-firm-hybrid'),
      ),
    ).toBeNull();
  });

  it.each([
    [10000, 12000, true, 2000],
    [10000, 10000, false, 0],
    [10000, 9000, false, 0],
    [10000, null, false, 0],
  ])(
    'price %i compare-at %j gives sale=%j savings=%i',
    (priceCents, compareAtCents, sale, savings) => {
      const variant = {
        id: 'v',
        size: 'Queen' as const,
        sku: null,
        dimensions: null,
        priceCents,
        compareAtCents,
        available: true,
      };
      expect(isOnSale(variant)).toBe(sale);
      expect(savingsCents(variant)).toBe(savings);
    },
  );

  it('orders sizes Twin-first whatever order the variants arrive in', () => {
    const base = getFixtureProduct('larkmoor-cedar-medium-hybrid');
    const reversed = {...base, variants: [...base.variants].reverse()};
    expect(sizesInOrder(reversed)).toEqual(sizesInOrder(base));
    expect(sizesInOrder(base)[0]).toBe('Twin');
  });

  it('buildVariants derives sale price from the regular price', () => {
    const variants = buildVariants('x', 1999, {saleOffPercent: 20});
    const queen = variants.find((v) => v.size === 'Queen');
    expect(queen?.compareAtCents).toBe(199900);
    expect(queen?.priceCents).toBe(159900);
  });
});
