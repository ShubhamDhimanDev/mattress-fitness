import {describe, expect, it} from 'vitest';
import {
  BENEFITS,
  COMFORT_LEVELS,
  MATTRESS_TYPES,
  SIZES,
  SLEEP_POSITIONS,
} from '~/lib/catalog/attributes';
import {mulberry32, randomSubset, shuffled} from '~/lib/catalog/test-helpers';
import type {
  FilterDimension,
  FilterSelection,
  FilterState,
  FilterVocabulary,
} from '~/lib/filters';
import {
  FILTER_DIMENSIONS,
  MAX_FILTER_PRICE_DOLLARS,
  SORT_KEYS,
  buildProductFilters,
  clearFilters,
  countActiveFilters,
  countsFromShopifyFilters,
  emptyFilterState,
  hasActiveFilters,
  isSelectionActive,
  listFilterOptions,
  normalizeFilterState,
  parseFilterParams,
  selectionFromShopifyInput,
  serializeFilterParams,
  toCollectionSort,
  toggleSelection,
  toSearchSort,
  withCursor,
  withPriceRange,
  withSort,
} from '~/lib/filters';

function parse(query: string, vocabulary?: FilterVocabulary): FilterState {
  return parseFilterParams(new URLSearchParams(query), vocabulary);
}

const PARAM_NAMES = [
  'size',
  'brand',
  'product_type',
  'comfort',
  'mattress_type',
  'benefit',
  'position',
  'product_line',
  'price_min',
  'price_max',
  'sort',
  'cursor',
];

const OPEN_VALUES = [
  'Larkmoor',
  'Wrenfield Sleep',
  'Ashvale Home',
  "O'Neil & Sons",
  'Café Nuit (US)',
  'A/B 2.0',
  'Tidewell',
];

function randomState(random: () => number): FilterState {
  const pick = (max: number) => Math.floor(random() * max);
  const minDollars = pick(3) === 0 ? 0 : 1 + pick(2500);
  const maxDollars = pick(3) === 0 ? 0 : minDollars + pick(3000) + 1;
  return normalizeFilterState({
    selected: {
      size: randomSubset(SIZES, 4, random),
      brand: randomSubset(OPEN_VALUES, 3, random),
      productType: randomSubset(['Mattress', 'Adjustable Base'], 2, random),
      comfortLevel: randomSubset(COMFORT_LEVELS, 3, random),
      mattressType: randomSubset(MATTRESS_TYPES, 3, random),
      benefit: randomSubset(BENEFITS, 3, random),
      sleepPosition: randomSubset(SLEEP_POSITIONS, 2, random),
      productLine: randomSubset(['Cedar Series', 'Solace Series'], 2, random),
    },
    priceMinCents: minDollars * 100,
    priceMaxCents: maxDollars * 100,
    sort: SORT_KEYS[pick(SORT_KEYS.length)],
    cursor: pick(2) === 0 ? null : `eyJsYXN0X2lk${pick(99999)}==`,
  });
}

describe('filter URL codec (REQ-COL-002, REQ-SRCH-002)', () => {
  it('reads an empty URL as the empty state', () => {
    expect(parse('')).toEqual(emptyFilterState());
  });

  it('reads every supported parameter', () => {
    const state = parse(
      'size=queen&size=king&brand=Larkmoor&product_type=Mattress' +
        '&comfort=medium&comfort=firm&mattress_type=memory-foam' +
        '&benefit=cooling&benefit=pressure-relief&position=side' +
        '&product_line=Cedar+Series&price_min=500&price_max=1500' +
        '&sort=price-asc&cursor=abc123',
    );
    expect(state).toEqual({
      selected: {
        size: ['Queen', 'King'],
        brand: ['Larkmoor'],
        productType: ['Mattress'],
        comfortLevel: ['Medium', 'Firm'],
        mattressType: ['Memory Foam'],
        benefit: ['Cooling', 'Pressure Relief'],
        sleepPosition: ['Side'],
        productLine: ['Cedar Series'],
      },
      priceMinCents: 50000,
      priceMaxCents: 150000,
      sort: 'price-asc',
      cursor: 'abc123',
    });
  });

  it('writes parameters in a fixed order using readable slugs', () => {
    const state = normalizeFilterState({
      selected: {
        size: ['King', 'Queen'],
        comfortLevel: ['Ultra Plush'],
        benefit: ['Eco-Friendly'],
      },
      priceMaxCents: 200000,
      sort: 'price-desc',
    });
    expect(serializeFilterParams(state).toString()).toBe(
      'size=queen&size=king&comfort=ultra-plush&benefit=eco-friendly' +
        '&price_max=2000&sort=price-desc',
    );
  });

  it('omits the default sort and empty values so equal states give equal URLs', () => {
    expect(serializeFilterParams(emptyFilterState()).toString()).toBe('');
    expect(
      serializeFilterParams(
        normalizeFilterState({sort: 'featured'}),
      ).toString(),
    ).toBe('');
  });

  it('accepts a label or a slug, in any case, and writes the canonical slug back', () => {
    const state = parse(
      'comfort=Ultra%20Plush&comfort=EXTRA-FIRM&size=Split+California+King',
    );
    expect(state.selected.comfortLevel).toEqual(['Ultra Plush', 'Extra Firm']);
    expect(state.selected.size).toEqual(['Split California King']);
    expect(serializeFilterParams(state).toString()).toBe(
      'size=split-california-king&comfort=ultra-plush&comfort=extra-firm',
    );
  });

  it('sorts values into the standard order and removes duplicates', () => {
    const state = parse('size=king&size=twin&size=king&size=QUEEN');
    expect(state.selected.size).toEqual(['Twin', 'Queen', 'King']);
  });

  it('keeps unrelated parameters such as the search term and does not mutate the base', () => {
    const base = new URLSearchParams(
      'q=cooling+mattress&size=twin&sort=newest',
    );
    const next = serializeFilterParams(
      normalizeFilterState({selected: {size: ['Queen']}}),
      base,
    );
    expect(next.toString()).toBe('q=cooling+mattress&size=queen');
    expect(base.toString()).toBe('q=cooling+mattress&size=twin&sort=newest');
  });

  describe('hostile and invalid values are dropped, never trusted (T-07)', () => {
    it.each([
      ['size=gigantic'],
      ['size='],
      ['size=%00'],
      ['size=queen%00'],
      ['comfort=<script>alert(1)</script>'],
      ['mattress_type=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E'],
      ['benefit=cooling%27%20OR%201%3D1'],
      ['position=__proto__'],
      ['position=constructor'],
      ['benefit=' + 'a'.repeat(5000)],
      ['size=' + '%F0%9F%98%80'.repeat(100)],
    ])('ignores %s', (query) => {
      expect(parse(query)).toEqual(emptyFilterState());
    });

    it.each([
      ['brand=<b>x</b>'],
      ['brand=a%00b'],
      ['brand=%22quoted%22'],
      ['brand=semi;colon'],
      ['brand=back%5Cslash'],
      ['brand=' + 'b'.repeat(81)],
      ['brand=%20%20'],
      ['product_line=javascript:alert(1)'],
    ])(
      'rejects the open-list value in %s when no allow-list is given',
      (query) => {
        expect(parse(query).selected).toEqual(emptyFilterState().selected);
      },
    );

    it('limits how many repeated values are looked at', () => {
      const query = Array.from(
        {length: 5000},
        (_, i) => `brand=Brand${i}`,
      ).join('&');
      const state = parse(query);
      expect(state.selected.brand.length).toBeLessThanOrEqual(12);
    });

    it('drops prototype-style names from open lists', () => {
      const state = parse('brand=__proto__&brand=constructor&brand=toString');
      expect(state.selected.brand).toEqual(['constructor', 'toString']);
      const counts = countsFromShopifyFilters([
        {values: [{count: 1, input: {productVendor: '__proto__'}}]},
      ]);
      expect(counts.brand).toEqual({});
    });
  });

  describe('open lists with an allow-list from the catalog', () => {
    const vocabulary: FilterVocabulary = {
      brand: ['Larkmoor', 'Wrenfield Sleep'],
      productType: ['Mattress'],
      productLine: ['Cedar Series'],
    };

    it('matches case-insensitively and returns the catalog spelling', () => {
      const state = parse(
        'brand=larkmoor&brand=WRENFIELD+SLEEP&product_type=mattress&product_line=cedar-series',
        vocabulary,
      );
      expect(state.selected.brand).toEqual(['Larkmoor', 'Wrenfield Sleep']);
      expect(state.selected.productType).toEqual(['Mattress']);
      expect(state.selected.productLine).toEqual(['Cedar Series']);
    });

    it('drops values that are not in the allow-list even when they look harmless', () => {
      const state = parse('brand=Tidewell&brand=Larkmoor', vocabulary);
      expect(state.selected.brand).toEqual(['Larkmoor']);
    });
  });

  describe('price', () => {
    it.each([
      ['price_min=500', 50000, null],
      ['price_max=1500', null, 150000],
      ['price_min=500&price_max=1500', 50000, 150000],
      ['price_min=1500&price_max=500', 50000, 150000],
      ['price_min=0', null, null],
      ['price_max=0', null, null],
      ['price_min=abc&price_max=-5', null, null],
      ['price_min=12.5', null, null],
      ['price_min=1e3', null, null],
      ['price_min=%20500', null, null],
      ['price_min=1,500', null, null],
      ['price_min=99999999', null, null],
      [
        `price_max=${MAX_FILTER_PRICE_DOLLARS}`,
        null,
        MAX_FILTER_PRICE_DOLLARS * 100,
      ],
      [`price_max=${MAX_FILTER_PRICE_DOLLARS + 1}`, null, null],
    ])('%s gives min %j and max %j cents', (query, min, max) => {
      const state = parse(query);
      expect(state.priceMinCents).toBe(min);
      expect(state.priceMaxCents).toBe(max);
    });

    it('rounds cents outward to whole dollars so the range never shrinks', () => {
      const state = normalizeFilterState({
        priceMinCents: 50050,
        priceMaxCents: 100001,
      });
      expect(state.priceMinCents).toBe(50000);
      expect(state.priceMaxCents).toBe(100100);
    });

    it.each([Number.NaN, Number.POSITIVE_INFINITY, -100, 0])(
      'ignores a non-usable price %j passed from code',
      (value) => {
        const state = normalizeFilterState({
          priceMinCents: value,
          priceMaxCents: value,
        });
        expect(state.priceMinCents).toBeNull();
        expect(state.priceMaxCents).toBeNull();
      },
    );
  });

  describe('sort and cursor', () => {
    it.each(SORT_KEYS)('accepts sort %s', (sort) => {
      expect(parse(`sort=${sort}`).sort).toBe(sort);
    });

    it.each(['', 'random', 'PRICE', 'price-asc;drop', 'newest%00'])(
      'falls back to the default for sort %j',
      (sort) => {
        expect(parse(`sort=${sort}`).sort).toBe('featured');
      },
    );

    it('uses only the first sort when it is repeated', () => {
      expect(parse('sort=newest&sort=price-asc').sort).toBe('newest');
    });

    it.each([
      ['eyJsYXN0X2lkIjo0NTY3fQ==', 'eyJsYXN0X2lkIjo0NTY3fQ=='],
      ['abc-DEF_123', 'abc-DEF_123'],
      ['<script>', null],
      ['has space', null],
      ['a'.repeat(513), null],
      ['', null],
    ])('cursor %j becomes %j', (cursor, expected) => {
      const params = new URLSearchParams();
      params.set('cursor', cursor);
      expect(parseFilterParams(params).cursor).toBe(expected);
    });
  });

  describe('state changes used by the UI', () => {
    const base = normalizeFilterState({
      selected: {comfortLevel: ['Medium']},
      sort: 'newest',
      cursor: 'page2',
    });

    it('toggling a value adds it, removes it again, and resets pagination', () => {
      const added = toggleSelection(base, {
        kind: 'value',
        dimension: 'size',
        value: 'Queen',
      });
      expect(added.selected.size).toEqual(['Queen']);
      expect(added.cursor).toBeNull();
      expect(added.sort).toBe('newest');
      const removed = toggleSelection(added, {
        kind: 'value',
        dimension: 'size',
        value: 'Queen',
      });
      expect(removed.selected.size).toEqual([]);
    });

    it('ignores a toggle of a value outside the vocabulary', () => {
      const next = toggleSelection(base, {
        kind: 'value',
        dimension: 'size',
        value: 'Gigantic',
      });
      expect(next.selected.size).toEqual([]);
    });

    it('toggles a price range on and off', () => {
      const range: FilterSelection = {
        kind: 'price',
        minCents: 0,
        maxCents: 100000,
      };
      const on = toggleSelection(base, range);
      expect(on.priceMaxCents).toBe(100000);
      expect(isSelectionActive(on, range)).toBe(true);
      const off = toggleSelection(on, range);
      expect(off.priceMaxCents).toBeNull();
      expect(isSelectionActive(off, range)).toBe(false);
    });

    it('clearFilters keeps only the sort', () => {
      const cleared = clearFilters(withPriceRange(base, 10000, 90000));
      expect(cleared).toEqual({...emptyFilterState(), sort: 'newest'});
    });

    it('reports active filters', () => {
      expect(hasActiveFilters(emptyFilterState())).toBe(false);
      expect(hasActiveFilters(base)).toBe(true);
      expect(countActiveFilters(withPriceRange(base, 10000, null))).toBe(2);
    });

    it('withSort resets the cursor and rejects unknown sorts', () => {
      expect(withSort(base, 'price-desc')).toMatchObject({
        sort: 'price-desc',
        cursor: null,
      });
      expect(withCursor(base, 'nope nope').cursor).toBeNull();
    });
  });

  describe('property: round trip (REQ-COL-002 "shareable, back-button safe")', () => {
    it('parse(serialize(state)) equals state for 400 random states', () => {
      const random = mulberry32(20261012);
      for (let i = 0; i < 400; i += 1) {
        const state = randomState(random);
        const url = serializeFilterParams(state);
        expect(parseFilterParams(new URLSearchParams(url.toString()))).toEqual(
          state,
        );
      }
    });

    it('serializing is stable: a second pass produces the same URL', () => {
      const random = mulberry32(7);
      for (let i = 0; i < 200; i += 1) {
        const state = randomState(random);
        const once = serializeFilterParams(state).toString();
        const twice = serializeFilterParams(
          parseFilterParams(new URLSearchParams(once)),
        ).toString();
        expect(twice).toBe(once);
      }
    });

    it('does not depend on the order values arrive in', () => {
      const random = mulberry32(99);
      for (let i = 0; i < 100; i += 1) {
        const state = randomState(random);
        const entries = [...serializeFilterParams(state).entries()];
        const shuffledParams = new URLSearchParams(shuffled(entries, random));
        const reparsed = parseFilterParams(shuffledParams);
        // Repeated values of one parameter keep their relative order; the
        // codec sorts them, so the state is identical either way.
        expect(reparsed).toEqual(state);
      }
    });

    it('survives 500 random hostile query strings without throwing and stays canonical', () => {
      const random = mulberry32(31337);
      const alphabet = [
        'a',
        'Z',
        ' ',
        '-',
        '_',
        '%',
        '0',
        '9',
        '<',
        '>',
        '\u0000',
        'é',
        '😀',
        '&',
        '=',
        ';',
        '"',
      ];
      for (let i = 0; i < 500; i += 1) {
        const params = new URLSearchParams();
        for (let k = 0; k < 6; k += 1) {
          const length = Math.floor(random() * 40);
          let value = '';
          for (let c = 0; c < length; c += 1) {
            value += alphabet[Math.floor(random() * alphabet.length)];
          }
          const name = PARAM_NAMES[Math.floor(random() * PARAM_NAMES.length)];
          params.append(name ?? 'size', value);
        }
        const state = parseFilterParams(params);
        expect(normalizeFilterState(state)).toEqual(state);
        for (const size of state.selected.size) expect(SIZES).toContain(size);
        for (const c of state.selected.comfortLevel)
          expect(COMFORT_LEVELS).toContain(c);
        for (const t of state.selected.mattressType)
          expect(MATTRESS_TYPES).toContain(t);
        for (const b of state.selected.benefit) expect(BENEFITS).toContain(b);
        for (const p of state.selected.sleepPosition)
          expect(SLEEP_POSITIONS).toContain(p);
      }
    });
  });
});

describe('Storefront API ProductFilter mapping (REQ-COL-002) ASSUMPTION(V-04)', () => {
  it('builds no filters for the empty state', () => {
    expect(buildProductFilters(emptyFilterState())).toEqual([]);
  });

  it('maps each dimension to the right filter input', () => {
    const state = normalizeFilterState({
      selected: {
        size: ['Queen', 'King'],
        brand: ['Larkmoor'],
        productType: ['Mattress'],
        comfortLevel: ['Medium'],
        mattressType: ['Hybrid'],
        benefit: ['Cooling'],
        sleepPosition: ['Side'],
        productLine: ['Cedar Series'],
      },
      priceMinCents: 50000,
      priceMaxCents: 150000,
    });
    expect(buildProductFilters(state)).toEqual([
      {variantOption: {name: 'Size', value: 'Queen'}},
      {variantOption: {name: 'Size', value: 'King'}},
      {productVendor: 'Larkmoor'},
      {productType: 'Mattress'},
      {
        productMetafield: {
          namespace: 'custom',
          key: 'comfort_level',
          value: 'Medium',
        },
      },
      {
        productMetafield: {
          namespace: 'custom',
          key: 'mattress_type',
          value: 'Hybrid',
        },
      },
      {
        productMetafield: {
          namespace: 'custom',
          key: 'benefits',
          value: 'Cooling',
        },
      },
      {
        productMetafield: {
          namespace: 'custom',
          key: 'sleep_positions',
          value: 'Side',
        },
      },
      {
        productMetafield: {
          namespace: 'custom',
          key: 'product_line',
          value: 'Cedar Series',
        },
      },
      {price: {min: 500, max: 1500}},
    ]);
  });

  it.each([
    [50000, null, {price: {min: 500}}],
    [null, 150000, {price: {max: 1500}}],
  ])('sends only the bound that is set (%j, %j)', (min, max, expected) => {
    expect(
      buildProductFilters(
        normalizeFilterState({priceMinCents: min, priceMaxCents: max}),
      ),
    ).toEqual([expected]);
  });

  it('adds an availability filter on request', () => {
    expect(
      buildProductFilters(emptyFilterState(), {availableOnly: true}),
    ).toEqual([{available: true}]);
  });

  it('never forwards a value outside the vocabularies', () => {
    const state = normalizeFilterState({
      selected: {
        size: ['Gigantic', 'Queen'],
        comfortLevel: ["Medium' OR 1=1"],
      },
    });
    expect(buildProductFilters(state)).toEqual([
      {variantOption: {name: 'Size', value: 'Queen'}},
    ]);
  });

  it.each([
    ['featured', 'COLLECTION_DEFAULT', false],
    ['best-selling', 'BEST_SELLING', false],
    ['price-asc', 'PRICE', false],
    ['price-desc', 'PRICE', true],
    ['newest', 'CREATED', true],
    ['title-asc', 'TITLE', false],
  ] as const)('collection sort %s -> %s reverse=%s', (sort, key, reverse) => {
    expect(toCollectionSort(sort)).toEqual({sortKey: key, reverse});
  });

  it.each([
    ['featured', 'RELEVANCE', false],
    ['best-selling', 'RELEVANCE', false],
    ['price-asc', 'PRICE', false],
    ['price-desc', 'PRICE', true],
    ['newest', 'RELEVANCE', false],
    ['title-asc', 'RELEVANCE', false],
  ] as const)('search sort %s -> %s reverse=%s', (sort, key, reverse) => {
    expect(toSearchSort(sort)).toEqual({sortKey: key, reverse});
  });
});

describe('reading Shopify filter values back (REQ-COL-002 counts) ASSUMPTION(V-04)', () => {
  const comfortInput = JSON.stringify({
    productMetafield: {
      namespace: 'custom',
      key: 'comfort_level',
      value: 'Medium',
    },
  });

  it('parses the JSON string Shopify returns in FilterValue.input', () => {
    expect(selectionFromShopifyInput(comfortInput)).toEqual({
      kind: 'value',
      dimension: 'comfortLevel',
      value: 'Medium',
    });
  });

  it('accepts an already parsed object too', () => {
    expect(
      selectionFromShopifyInput({variantOption: {name: 'size', value: 'king'}}),
    ).toEqual({kind: 'value', dimension: 'size', value: 'King'});
    expect(selectionFromShopifyInput({productVendor: 'Larkmoor'})).toEqual({
      kind: 'value',
      dimension: 'brand',
      value: 'Larkmoor',
    });
    expect(selectionFromShopifyInput({productType: 'Mattress'})).toEqual({
      kind: 'value',
      dimension: 'productType',
      value: 'Mattress',
    });
  });

  it('converts a dollar price range into cents', () => {
    expect(
      selectionFromShopifyInput('{"price":{"min":0,"max":499.5}}'),
    ).toEqual({kind: 'price', minCents: null, maxCents: 50000});
    expect(selectionFromShopifyInput({price: {min: 1000}})).toEqual({
      kind: 'price',
      minCents: 100000,
      maxCents: null,
    });
  });

  it.each([
    ['not json'],
    [''],
    [null],
    [undefined],
    [42],
    [['array']],
    ['{"unknownKey":"x"}'],
    ['{"available":true}'],
    ['{"tag":"sale"}'],
    ['{"variantOption":{"name":"Color","value":"Red"}}'],
    ['{"variantOption":"Queen"}'],
    ['{"variantOption":{"name":"Size","value":"Gigantic"}}'],
    [
      '{"productMetafield":{"namespace":"other","key":"comfort_level","value":"Medium"}}',
    ],
    [
      '{"productMetafield":{"namespace":"custom","key":"delivery_type","value":"parcel"}}',
    ],
    [
      '{"productMetafield":{"namespace":"custom","key":"comfort_level","value":"Squishy"}}',
    ],
    ['{"productVendor":"a","productType":"b"}'],
    ['{"price":{"min":-1}}'],
    ['{"price":{"min":"cheap"}}'],
    ['{"price":{}}'],
    ['x'.repeat(5000)],
  ])('returns null for %j', (input) => {
    expect(selectionFromShopifyInput(input)).toBeNull();
  });

  it('collects counts per dimension and skips unusable entries', () => {
    const counts = countsFromShopifyFilters([
      {
        values: [
          {count: 7, input: comfortInput},
          {
            count: 3,
            input: JSON.stringify({
              productMetafield: {
                namespace: 'custom',
                key: 'comfort_level',
                value: 'firm',
              },
            }),
          },
          {count: -1, input: JSON.stringify({productVendor: 'Bad Count'})},
          {count: 2.5, input: JSON.stringify({productVendor: 'Fractional'})},
          {count: 9, input: '{"available":true}'},
          {count: 4, input: JSON.stringify({price: {min: 0, max: 100}})},
        ],
      },
      {
        values: [
          {count: 5, input: JSON.stringify({productVendor: 'Larkmoor'})},
          {count: 99, input: JSON.stringify({productVendor: 'Larkmoor'})},
          {
            count: 1,
            input: JSON.stringify({
              variantOption: {name: 'Size', value: 'Queen'},
            }),
          },
        ],
      },
    ]);
    expect(counts.comfortLevel).toEqual({Medium: 7, Firm: 3});
    expect(counts.brand).toEqual({Larkmoor: 5});
    expect(counts.size).toEqual({Queen: 1});
    expect(counts.benefit).toEqual({});
  });

  it('lists options in standard order and keeps selected values visible at zero', () => {
    const counts = countsFromShopifyFilters([
      {
        values: [
          {
            count: 2,
            input: {
              productMetafield: {
                namespace: 'custom',
                key: 'comfort_level',
                value: 'Firm',
              },
            },
          },
          {
            count: 8,
            input: {
              productMetafield: {
                namespace: 'custom',
                key: 'comfort_level',
                value: 'Plush',
              },
            },
          },
        ],
      },
    ]);
    const state = normalizeFilterState({selected: {comfortLevel: ['Medium']}});
    expect(listFilterOptions('comfortLevel', counts, state)).toEqual([
      {value: 'Plush', count: 8, selected: false},
      {value: 'Medium', count: 0, selected: true},
      {value: 'Firm', count: 2, selected: false},
    ]);
  });

  it('property: every filter we send maps back to the selection that produced it', () => {
    const random = mulberry32(555);
    for (let i = 0; i < 200; i += 1) {
      const state = randomState(random);
      const rebuilt = buildProductFilters(state)
        .map((filter) => selectionFromShopifyInput(JSON.stringify(filter)))
        .reduce<FilterState>(
          (acc, selection) =>
            selection ? toggleSelection(acc, selection) : acc,
          emptyFilterState(),
        );
      expect(rebuilt.selected).toEqual(state.selected);
      expect(rebuilt.priceMinCents).toBe(state.priceMinCents);
      expect(rebuilt.priceMaxCents).toBe(state.priceMaxCents);
    }
  });

  it('knows every dimension (guards against adding one without a mapping)', () => {
    const dimensions: readonly FilterDimension[] = FILTER_DIMENSIONS;
    const state = normalizeFilterState({
      selected: {
        size: ['Queen'],
        brand: ['Larkmoor'],
        productType: ['Mattress'],
        comfortLevel: ['Medium'],
        mattressType: ['Hybrid'],
        benefit: ['Cooling'],
        sleepPosition: ['Side'],
        productLine: ['Cedar Series'],
      },
    });
    expect(buildProductFilters(state)).toHaveLength(dimensions.length);
  });
});
