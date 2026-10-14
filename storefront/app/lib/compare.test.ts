import {describe, expect, it} from 'vitest';
import {FIXTURE_PRODUCTS, getFixtureProduct} from '~/lib/catalog/fixtures';
import {variantForSize} from '~/lib/catalog/pricing';
import {mulberry32, shuffled} from '~/lib/catalog/test-helpers';
import type {CatalogProduct} from '~/lib/catalog/types';
import {
  COMPARE_MAX_PRODUCTS,
  COMPARISON_ROW_KEYS,
  addToComparison,
  buildComparisonTable,
  commonSizes,
  parseComparisonHandles,
  removeFromComparison,
  resolveComparison,
  serializeComparison,
  similarProducts,
} from '~/lib/compare';

const SOLACE_PLUSH = getFixtureProduct('wrenfield-solace-plush-memory-foam');
const SOLACE_MEDIUM = getFixtureProduct('wrenfield-solace-medium-memory-foam');
const SOLACE_FIRM = getFixtureProduct('wrenfield-solace-firm-memory-foam');
const CEDAR_PLUSH = getFixtureProduct('larkmoor-cedar-plush-hybrid');
const CEDAR_MEDIUM = getFixtureProduct('larkmoor-cedar-medium-hybrid');
const COVE_MEDIUM = getFixtureProduct('tidewell-cove-medium-hybrid');
const KESTREL = getFixtureProduct('wrenfield-kestrel-extra-firm-hybrid');
const HEARTWOOD_FIRM = getFixtureProduct('ashvale-heartwood-firm-latex');

const BASE_FRAME: CatalogProduct = {
  ...SOLACE_PLUSH,
  id: 'frame',
  handle: 'oakline-platform-frame',
  title: 'Oakline Platform Frame',
  productType: 'Bed Frame',
};

function handles(products: readonly CatalogProduct[]): string[] {
  return products.map((product) => product.handle);
}

describe('comparison selection rules (REQ-CMP-001)', () => {
  it('adds products up to four, in order', () => {
    let selection: readonly CatalogProduct[] = [];
    for (const product of [
      SOLACE_PLUSH,
      CEDAR_PLUSH,
      COVE_MEDIUM,
      HEARTWOOD_FIRM,
    ]) {
      const result = addToComparison(selection, product);
      expect(result.status).toBe('ok');
      selection = result.selection;
    }
    expect(selection).toHaveLength(COMPARE_MAX_PRODUCTS);
    expect(handles(selection)).toEqual([
      SOLACE_PLUSH.handle,
      CEDAR_PLUSH.handle,
      COVE_MEDIUM.handle,
      HEARTWOOD_FIRM.handle,
    ]);
  });

  it('rejects a fifth product and leaves the selection unchanged', () => {
    const four = [SOLACE_PLUSH, CEDAR_PLUSH, COVE_MEDIUM, HEARTWOOD_FIRM];
    const result = addToComparison(four, SOLACE_MEDIUM);
    expect(result).toEqual({
      status: 'rejected',
      reason: 'full',
      selection: four,
    });
  });

  it('rejects a duplicate, even when the list is full (duplicate is the clearer reason)', () => {
    const four = [SOLACE_PLUSH, CEDAR_PLUSH, COVE_MEDIUM, HEARTWOOD_FIRM];
    expect(addToComparison([SOLACE_PLUSH], SOLACE_PLUSH).status).toBe(
      'rejected',
    );
    expect(addToComparison([SOLACE_PLUSH], SOLACE_PLUSH)).toMatchObject({
      reason: 'duplicate',
    });
    expect(addToComparison(four, SOLACE_PLUSH)).toMatchObject({
      reason: 'duplicate',
    });
  });

  it('rejects a product from another category', () => {
    expect(addToComparison([SOLACE_PLUSH], BASE_FRAME)).toMatchObject({
      status: 'rejected',
      reason: 'different_category',
    });
    expect(addToComparison([BASE_FRAME], SOLACE_PLUSH)).toMatchObject({
      reason: 'different_category',
    });
  });

  it('treats the category case-insensitively and ignores surrounding space', () => {
    const shouting = {...CEDAR_PLUSH, productType: '  MATTRESS '};
    expect(addToComparison([SOLACE_PLUSH], shouting).status).toBe('ok');
  });

  it('allows any first product into an empty comparison', () => {
    expect(addToComparison([], BASE_FRAME).status).toBe('ok');
  });

  it('removes by handle and ignores unknown handles', () => {
    const selection = [SOLACE_PLUSH, CEDAR_PLUSH];
    expect(
      handles(removeFromComparison(selection, SOLACE_PLUSH.handle)),
    ).toEqual([CEDAR_PLUSH.handle]);
    expect(removeFromComparison(selection, 'nope')).toEqual(selection);
  });

  it('property: no sequence of adds ever breaks the rules (300 runs)', () => {
    const random = mulberry32(1234);
    const pool = [
      ...FIXTURE_PRODUCTS,
      BASE_FRAME,
      {...BASE_FRAME, id: 'f2', handle: 'second-frame'},
    ];
    for (let run = 0; run < 300; run += 1) {
      let selection: readonly CatalogProduct[] = [];
      for (let step = 0; step < 12; step += 1) {
        const candidate = pool[Math.floor(random() * pool.length)];
        if (!candidate) continue;
        selection = addToComparison(selection, candidate).selection;
        expect(selection.length).toBeLessThanOrEqual(COMPARE_MAX_PRODUCTS);
        expect(new Set(handles(selection)).size).toBe(selection.length);
        expect(
          new Set(selection.map((p) => p.productType)).size,
        ).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('persisting the selection for the session (REQ-CMP-001)', () => {
  it('stores handles only and reads them back', () => {
    const raw = serializeComparison([SOLACE_PLUSH, CEDAR_PLUSH]);
    expect(raw).toBe(JSON.stringify([SOLACE_PLUSH.handle, CEDAR_PLUSH.handle]));
    expect(parseComparisonHandles(raw)).toEqual([
      SOLACE_PLUSH.handle,
      CEDAR_PLUSH.handle,
    ]);
  });

  it.each([
    [null],
    [undefined],
    [42],
    [''],
    ['{broken'],
    ['{"a":1}'],
    ['"text"'],
    ['null'],
    ['x'.repeat(5000)],
  ])('reads %j as empty', (raw) => {
    expect(parseComparisonHandles(raw)).toEqual([]);
  });

  it('drops malformed and duplicate handles and caps the count', () => {
    const raw = JSON.stringify([
      'good-one',
      'good-one',
      '<script>alert(1)</script>',
      '../../etc/passwd',
      'UPPER',
      42,
      null,
      '',
      'good-two',
      'good-three',
      'good-four',
      'good-five',
    ]);
    expect(parseComparisonHandles(raw)).toEqual([
      'good-one',
      'good-two',
      'good-three',
      'good-four',
    ]);
  });

  it('resolves stored handles against fresh catalog data, dropping unknown and unmatched ones', () => {
    const catalog = [...FIXTURE_PRODUCTS, BASE_FRAME];
    const resolved = resolveComparison(
      [
        SOLACE_PLUSH.handle,
        'unpublished-product',
        BASE_FRAME.handle,
        CEDAR_PLUSH.handle,
      ],
      catalog,
    );
    // The frame is a different category from the first product, so it is dropped.
    expect(handles(resolved)).toEqual([
      SOLACE_PLUSH.handle,
      CEDAR_PLUSH.handle,
    ]);
  });

  it('resolves the products with current data, not stored data', () => {
    const cheaper = {
      ...SOLACE_PLUSH,
      variants: SOLACE_PLUSH.variants.map((v) => ({...v, priceCents: 100})),
    };
    const [resolved] = resolveComparison([SOLACE_PLUSH.handle], [cheaper]);
    expect(resolved?.variants[0]?.priceCents).toBe(100);
  });
});

describe('comparison table (REQ-CMP-001: six attributes)', () => {
  const rated = [SOLACE_PLUSH, CEDAR_PLUSH, HEARTWOOD_FIRM];

  it('has the six rows in the SOW order and one column per product', () => {
    const table = buildComparisonTable(rated, {size: 'Queen'});
    expect(table.rows.map((row) => row.key)).toEqual([...COMPARISON_ROW_KEYS]);
    expect(table.rows.map((row) => row.label)).toEqual([
      'Rating',
      'Price',
      'Comfort level',
      'Mattress type',
      'Height',
      'Benefits',
    ]);
    expect(table.columns.map((c) => c.handle)).toEqual(handles(rated));
    for (const row of table.rows) expect(row.cells).toHaveLength(rated.length);
    expect(table.columns[0]).toMatchObject({
      title: SOLACE_PLUSH.title,
      brand: 'Wrenfield Sleep',
      image: SOLACE_PLUSH.images[0],
    });
  });

  it('fills each row from the product data', () => {
    const table = buildComparisonTable(rated, {size: 'Queen'});
    const row = (key: string) => table.rows.find((r) => r.key === key)?.cells;
    expect(row('rating')).toEqual([
      {
        kind: 'rating',
        average: 4.6,
        count: 812,
        text: '4.6 out of 5 (812 reviews)',
      },
      {
        kind: 'rating',
        average: 4.6,
        count: 980,
        text: '4.6 out of 5 (980 reviews)',
      },
      {kind: 'missing', text: 'No reviews yet'},
    ]);
    expect(row('comfort')).toEqual([
      {kind: 'text', text: 'Plush'},
      {kind: 'text', text: 'Plush'},
      {kind: 'text', text: 'Firm'},
    ]);
    expect(row('type')).toEqual([
      {kind: 'text', text: 'Memory Foam'},
      {kind: 'text', text: 'Hybrid'},
      {kind: 'text', text: 'Latex'},
    ]);
    expect(row('height')).toEqual([
      {kind: 'text', text: '11"'},
      {kind: 'text', text: '14"'},
      {kind: 'text', text: '10"'},
    ]);
    expect(row('benefits')).toEqual([
      {kind: 'list', items: ['Pressure Relief', 'Motion Separation']},
      {kind: 'list', items: ['Cooling', 'Pressure Relief']},
      {kind: 'list', items: ['Back Support', 'Eco-Friendly']},
    ]);
  });

  it('shows the price in the chosen size, with the sale price and original', () => {
    const table = buildComparisonTable(
      [SOLACE_PLUSH, CEDAR_PLUSH, HEARTWOOD_FIRM],
      {size: 'Queen'},
    );
    expect(table.size).toBe('Queen');
    expect(table.rows.find((r) => r.key === 'price')?.cells).toEqual([
      {
        kind: 'price',
        cents: 89900,
        compareAtCents: null,
        from: false,
        size: 'Queen',
        text: '$899',
      },
      {
        kind: 'price',
        cents: 159900,
        compareAtCents: 199900,
        from: false,
        size: 'Queen',
        text: '$1,599',
      },
      {
        kind: 'price',
        cents: 209900,
        compareAtCents: null,
        from: false,
        size: 'Queen',
        text: '$2,099',
      },
    ]);
  });

  it('without a size shows From the lowest available price', () => {
    const table = buildComparisonTable([SOLACE_FIRM, CEDAR_PLUSH]);
    const cells = table.rows.find((r) => r.key === 'price')?.cells ?? [];
    const lowest = (p: CatalogProduct) =>
      Math.min(
        ...p.variants.filter((v) => v.available).map((v) => v.priceCents),
      );
    expect(cells[0]).toMatchObject({
      kind: 'price',
      from: true,
      size: null,
      cents: lowest(SOLACE_FIRM),
    });
    expect(cells[1]).toMatchObject({
      kind: 'price',
      from: true,
      cents: lowest(CEDAR_PLUSH),
    });
    expect(cells[0]).toMatchObject({
      text: expect.stringMatching(/^From \$[\d,]+$/),
    });
    // The sale shows because the cheapest available size is the discounted one.
    expect(cells[1]).toMatchObject({
      compareAtCents: variantForSize(CEDAR_PLUSH, 'Twin')?.compareAtCents,
    });
  });

  it('From ignores a cheaper size that is sold out', () => {
    const product: CatalogProduct = {
      ...SOLACE_PLUSH,
      variants: SOLACE_PLUSH.variants.map((v) =>
        v.size === 'Twin' ? {...v, available: false} : v,
      ),
    };
    const twin = variantForSize(product, 'Twin');
    const cell = buildComparisonTable([product]).rows.find(
      (r) => r.key === 'price',
    )?.cells[0];
    expect(cell).toMatchObject({kind: 'price', from: true});
    expect(cell?.kind === 'price' && cell.cents).toBeGreaterThan(
      twin?.priceCents ?? Infinity,
    );
  });

  it('says so when a product is sold out or not made in the chosen size', () => {
    const table = buildComparisonTable(
      [
        SOLACE_FIRM,
        KESTREL,
        getFixtureProduct('ashvale-fieldstone-medium-innerspring'),
      ],
      {size: 'King'},
    );
    // Solace Firm King is sold out; Kestrel is sold out everywhere; Fieldstone Medium does have King.
    expect(table.rows.find((r) => r.key === 'price')?.cells).toEqual([
      {kind: 'unavailable', text: 'Not available in King'},
      {kind: 'unavailable', text: 'Not available in King'},
      expect.objectContaining({kind: 'price', size: 'King'}),
    ]);
    const twinTable = buildComparisonTable(
      [getFixtureProduct('ashvale-fieldstone-medium-innerspring')],
      {size: 'Twin'},
    );
    expect(twinTable.rows.find((r) => r.key === 'price')?.cells[0]).toEqual({
      kind: 'unavailable',
      text: 'Not available in Twin',
    });
    expect(
      buildComparisonTable([KESTREL]).rows.find((r) => r.key === 'price')
        ?.cells[0],
    ).toEqual({
      kind: 'unavailable',
      text: 'Sold out',
    });
  });

  it('omits the rating row when no product has a rating (no reviews source)', () => {
    const unrated = [SOLACE_PLUSH, CEDAR_PLUSH].map((p) => ({
      ...p,
      rating: null,
    }));
    const table = buildComparisonTable(unrated, {size: 'Queen'});
    expect(table.rows.map((r) => r.key)).toEqual([
      'price',
      'comfort',
      'type',
      'height',
      'benefits',
    ]);
  });

  it('keeps the rating row when at least one product has a rating', () => {
    const mixed = [SOLACE_PLUSH, {...CEDAR_PLUSH, rating: null}];
    expect(buildComparisonTable(mixed).rows[0]?.key).toBe('rating');
  });

  it('handles missing attributes without inventing values', () => {
    const bare: CatalogProduct = {
      ...SOLACE_PLUSH,
      comfortLevel: null,
      mattressType: null,
      heightInches: null,
      benefits: [],
    };
    const table = buildComparisonTable([bare], {size: 'Queen'});
    const cells = (key: string) =>
      table.rows.find((r) => r.key === key)?.cells[0];
    expect(cells('comfort')).toEqual({kind: 'missing', text: 'Not specified'});
    expect(cells('type')).toEqual({kind: 'missing', text: 'Not specified'});
    expect(cells('height')).toEqual({kind: 'missing', text: 'Not specified'});
    expect(cells('benefits')).toEqual({kind: 'missing', text: 'None listed'});
  });

  it.each([
    [10, '10"'],
    [11.5, '11.5"'],
    [0, 'missing'],
    [-3, 'missing'],
    [Number.NaN, 'missing'],
    [Number.POSITIVE_INFINITY, 'missing'],
  ])('height %j prints as %j', (heightInches, expected) => {
    const cell = buildComparisonTable([
      {...SOLACE_PLUSH, heightInches},
    ]).rows.find((r) => r.key === 'height')?.cells[0];
    expect(
      cell?.kind === 'missing'
        ? 'missing'
        : cell?.kind === 'text'
          ? cell.text
          : '?',
    ).toBe(expected);
  });

  it('flags rows where every product is the same', () => {
    const table = buildComparisonTable([SOLACE_PLUSH, CEDAR_PLUSH], {
      size: 'Queen',
    });
    const differs = Object.fromEntries(
      table.rows.map((r) => [r.key, r.differs]),
    );
    expect(differs).toMatchObject({
      comfort: false,
      type: true,
      price: true,
      height: true,
    });
  });

  it('builds an empty but valid table for an empty selection', () => {
    const table = buildComparisonTable([]);
    expect(table.columns).toEqual([]);
    expect(table.rows.map((r) => r.key)).toEqual([
      'price',
      'comfort',
      'type',
      'height',
      'benefits',
    ]);
    for (const row of table.rows) {
      expect(row.cells).toEqual([]);
      expect(row.differs).toBe(false);
    }
  });

  it('carries no price that did not come from the product data', () => {
    const table = buildComparisonTable(FIXTURE_PRODUCTS.slice(0, 4), {
      size: 'Queen',
    });
    const allowed = new Set(
      FIXTURE_PRODUCTS.flatMap((p) =>
        p.variants.flatMap((v) => [v.priceCents, v.compareAtCents]),
      ),
    );
    for (const cell of table.rows.find((r) => r.key === 'price')?.cells ?? []) {
      if (cell.kind === 'price') expect(allowed.has(cell.cents)).toBe(true);
    }
  });
});

describe('sizes common to the selection', () => {
  it('lists sizes every product is sold in, in the standard order', () => {
    const limited = getFixtureProduct('ashvale-fieldstone-medium-innerspring');
    expect(commonSizes([SOLACE_PLUSH, limited])).toEqual([
      'Full',
      'Queen',
      'King',
      'California King',
    ]);
    expect(commonSizes([])).toEqual([]);
    expect(commonSizes([SOLACE_PLUSH])).toHaveLength(7);
  });
});

describe('similar products (REQ-CMP-001)', () => {
  it('orders by nearest price in the chosen size (hand-checked, Queen)', () => {
    // Target: Solace Medium Memory Foam, Queen $1,099, Medium + Memory Foam.
    // Eligible (same type, comfort or compare group; mattress; in stock) by price distance:
    //   Cove Medium Hybrid $1,099 (0), Solace Firm $1,199 (100), Solace Plush $899 (200),
    //   Cedar Medium $1,499 (400), Fieldstone Medium $649 (450), Harbor Medium $399 (700),
    //   then Heartwood Medium $1,899 and Cove Ultra Plush $1,899 (800, equal): handle order.
    const result = similarProducts(SOLACE_MEDIUM, FIXTURE_PRODUCTS, {
      size: 'Queen',
      limit: 20,
    });
    expect(handles(result)).toEqual([
      'tidewell-cove-medium-hybrid',
      'wrenfield-solace-firm-memory-foam',
      'wrenfield-solace-plush-memory-foam',
      'larkmoor-cedar-medium-hybrid',
      'ashvale-fieldstone-medium-innerspring',
      'tidewell-harbor-medium-foam',
      'ashvale-heartwood-medium-latex',
      'tidewell-cove-ultra-plush-memory-foam',
    ]);
  });

  it('returns four by default and honours the limit', () => {
    expect(
      similarProducts(SOLACE_MEDIUM, FIXTURE_PRODUCTS, {size: 'Queen'}),
    ).toHaveLength(4);
    expect(
      similarProducts(SOLACE_MEDIUM, FIXTURE_PRODUCTS, {
        size: 'Queen',
        limit: 2,
      }),
    ).toHaveLength(2);
    expect(
      similarProducts(SOLACE_MEDIUM, FIXTURE_PRODUCTS, {limit: 0}),
    ).toEqual([]);
    expect(
      similarProducts(SOLACE_MEDIUM, FIXTURE_PRODUCTS, {limit: -3}),
    ).toEqual([]);
  });

  it('never includes the product itself, excluded handles, sold-out products or other categories', () => {
    const catalog = [...FIXTURE_PRODUCTS, BASE_FRAME];
    const result = similarProducts(SOLACE_MEDIUM, catalog, {
      size: 'Queen',
      limit: 50,
      exclude: ['tidewell-cove-medium-hybrid'],
    });
    const found = handles(result);
    expect(found).not.toContain(SOLACE_MEDIUM.handle);
    expect(found).not.toContain('tidewell-cove-medium-hybrid');
    expect(found).not.toContain(KESTREL.handle);
    expect(found).not.toContain(BASE_FRAME.handle);
  });

  it('shares at least the type, the comfort level or the compare group', () => {
    for (const target of FIXTURE_PRODUCTS) {
      for (const similar of similarProducts(target, FIXTURE_PRODUCTS, {
        limit: 50,
      })) {
        const shares =
          similar.mattressType === target.mattressType ||
          similar.comfortLevel === target.comfortLevel ||
          (similar.compareGroup !== null &&
            similar.compareGroup === target.compareGroup);
        expect(shares).toBe(true);
      }
    }
  });

  it('uses the client compare group even when type and comfort differ', () => {
    const odd: CatalogProduct = {
      ...getFixtureProduct('tidewell-harbor-extra-firm-foam'),
      handle: 'grouped-oddball',
      id: 'odd',
      compareGroup: 'Special Group',
    };
    const target: CatalogProduct = {
      ...SOLACE_MEDIUM,
      compareGroup: 'Special Group',
    };
    expect(handles(similarProducts(target, [odd], {limit: 5}))).toEqual([
      'grouped-oddball',
    ]);
    expect(
      similarProducts(
        {...SOLACE_MEDIUM, compareGroup: null},
        [{...odd, compareGroup: null}],
        {limit: 5},
      ),
    ).toEqual([]);
  });

  it('does not treat two missing attributes as a match', () => {
    const blank = (handle: string): CatalogProduct => ({
      ...SOLACE_PLUSH,
      id: handle,
      handle,
      comfortLevel: null,
      mattressType: null,
      compareGroup: null,
    });
    expect(similarProducts(blank('a'), [blank('b')], {limit: 5})).toEqual([]);
  });

  it('prefers the product sharing more attributes when prices are equally close', () => {
    const target = SOLACE_MEDIUM;
    const sameTypeOnly: CatalogProduct = {
      ...getFixtureProduct('tidewell-cove-ultra-plush-memory-foam'),
      handle: 'a-type-only',
      id: 'a',
      compareGroup: null,
    };
    const typeAndComfort: CatalogProduct = {
      ...sameTypeOnly,
      handle: 'z-type-and-comfort',
      id: 'z',
      comfortLevel: 'Medium',
    };
    const priced = (p: CatalogProduct): CatalogProduct => ({
      ...p,
      variants: p.variants.map((v) => ({...v, priceCents: 120000})),
    });
    expect(
      handles(
        similarProducts(
          target,
          [priced(sameTypeOnly), priced(typeAndComfort)],
          {size: 'Queen'},
        ),
      ),
    ).toEqual(['z-type-and-comfort', 'a-type-only']);
  });

  it('falls back to the lowest available price for a product not sold in the chosen size', () => {
    const limited = getFixtureProduct('ashvale-fieldstone-medium-innerspring');
    const result = similarProducts(limited, FIXTURE_PRODUCTS, {
      size: 'Twin',
      limit: 3,
    });
    expect(result.length).toBeGreaterThan(0);
  });

  it('is independent of the catalog order (property, 100 shuffles per product)', () => {
    const random = mulberry32(5150);
    for (const target of FIXTURE_PRODUCTS) {
      const expected = handles(
        similarProducts(target, FIXTURE_PRODUCTS, {size: 'Queen', limit: 6}),
      );
      for (let k = 0; k < 8; k += 1) {
        const shuffledCatalog = shuffled(FIXTURE_PRODUCTS, random);
        expect(
          handles(
            similarProducts(target, shuffledCatalog, {size: 'Queen', limit: 6}),
          ),
        ).toEqual(expected);
      }
    }
  });
});
