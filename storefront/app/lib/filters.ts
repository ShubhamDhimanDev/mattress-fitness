// Filter and sort state for collections and search (REQ-COL-002, REQ-SRCH-002).
//
// One pure module shared by both routes:
//   URL  <->  FilterState  ->  Storefront API ProductFilter[]
//   Storefront API filter values (with counts)  ->  FilterSelection / counts
//
// The URL is the single source of truth (shareable, back-button safe). Every
// value read from it is validated against the known lists; anything unknown is
// dropped, never trusted (threat T-07). Prices are whole dollars in the URL and
// integer cents in state.
//
// ASSUMPTION(V-04) markers below list Storefront API behaviour that must be
// confirmed on the development store once Shopify Search and Discovery is
// configured. Shopify, not this module, decides which filters exist and their
// counts; this module only translates.

import {
  BENEFITS,
  COMFORT_LEVELS,
  MATTRESS_TYPES,
  PRODUCT_METAFIELD_KEYS,
  PRODUCT_METAFIELD_NAMESPACE,
  SIZES,
  SIZE_OPTION_NAME,
  SLEEP_POSITIONS,
  indexIn,
  matchCanonical,
  toSlug,
} from '~/lib/catalog/attributes';

export const FILTER_DIMENSIONS = [
  'size',
  'brand',
  'productType',
  'comfortLevel',
  'mattressType',
  'benefit',
  'sleepPosition',
  'productLine',
] as const;
export type FilterDimension = (typeof FILTER_DIMENSIONS)[number];

export const SORT_KEYS = [
  'featured',
  'best-selling',
  'price-asc',
  'price-desc',
  'newest',
  'title-asc',
] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export const DEFAULT_SORT: SortKey = 'featured';

export const SORT_LABELS: Readonly<Record<SortKey, string>> = {
  featured: 'Featured',
  'best-selling': 'Best selling',
  'price-asc': 'Price: low to high',
  'price-desc': 'Price: high to low',
  newest: 'Newest',
  'title-asc': 'Name: A to Z',
};

/** Search can only sort by relevance or price (SearchSortKeys). */
export const SEARCH_SORT_KEYS: readonly SortKey[] = [
  'featured',
  'price-asc',
  'price-desc',
];

/** Largest price the URL may carry, in whole dollars. */
export const MAX_FILTER_PRICE_DOLLARS = 100000;

/** Allow-lists for the dimensions whose values come from the catalog, not a fixed list. */
export type FilterVocabulary = {
  readonly brand?: readonly string[];
  readonly productType?: readonly string[];
  readonly productLine?: readonly string[];
};

export type FilterState = {
  readonly selected: Readonly<Record<FilterDimension, readonly string[]>>;
  readonly priceMinCents: number | null;
  readonly priceMaxCents: number | null;
  readonly sort: SortKey;
  /** Opaque Storefront API pagination cursor ("after"); reset when filters change. */
  readonly cursor: string | null;
};

type ShopifyMapping =
  | {readonly kind: 'variantOption'; readonly name: string}
  | {readonly kind: 'vendor'}
  | {readonly kind: 'productType'}
  | {
      readonly kind: 'metafield';
      readonly namespace: string;
      readonly key: string;
    };

type DimensionSpec = {
  readonly param: string;
  /** Fixed value list, or null when values come from the catalog. */
  readonly fixed: readonly string[] | null;
  readonly maxValues: number;
  readonly shopify: ShopifyMapping;
};

const OPEN_MAX_VALUES = 12;

const DIMENSION_SPECS: Readonly<Record<FilterDimension, DimensionSpec>> = {
  size: {
    param: 'size',
    fixed: SIZES,
    maxValues: SIZES.length,
    shopify: {kind: 'variantOption', name: SIZE_OPTION_NAME},
  },
  brand: {
    param: 'brand',
    fixed: null,
    maxValues: OPEN_MAX_VALUES,
    shopify: {kind: 'vendor'},
  },
  productType: {
    param: 'product_type',
    fixed: null,
    maxValues: OPEN_MAX_VALUES,
    shopify: {kind: 'productType'},
  },
  comfortLevel: {
    param: 'comfort',
    fixed: COMFORT_LEVELS,
    maxValues: COMFORT_LEVELS.length,
    shopify: {
      kind: 'metafield',
      namespace: PRODUCT_METAFIELD_NAMESPACE,
      key: PRODUCT_METAFIELD_KEYS.comfortLevel,
    },
  },
  mattressType: {
    param: 'mattress_type',
    fixed: MATTRESS_TYPES,
    maxValues: MATTRESS_TYPES.length,
    shopify: {
      kind: 'metafield',
      namespace: PRODUCT_METAFIELD_NAMESPACE,
      key: PRODUCT_METAFIELD_KEYS.mattressType,
    },
  },
  benefit: {
    param: 'benefit',
    fixed: BENEFITS,
    maxValues: BENEFITS.length,
    shopify: {
      kind: 'metafield',
      namespace: PRODUCT_METAFIELD_NAMESPACE,
      key: PRODUCT_METAFIELD_KEYS.benefits,
    },
  },
  sleepPosition: {
    param: 'position',
    fixed: SLEEP_POSITIONS,
    maxValues: SLEEP_POSITIONS.length,
    shopify: {
      kind: 'metafield',
      namespace: PRODUCT_METAFIELD_NAMESPACE,
      key: PRODUCT_METAFIELD_KEYS.sleepPositions,
    },
  },
  productLine: {
    param: 'product_line',
    fixed: null,
    maxValues: OPEN_MAX_VALUES,
    shopify: {
      kind: 'metafield',
      namespace: PRODUCT_METAFIELD_NAMESPACE,
      key: PRODUCT_METAFIELD_KEYS.productLine,
    },
  },
};

const PRICE_MIN_PARAM = 'price_min';
const PRICE_MAX_PARAM = 'price_max';
const SORT_PARAM = 'sort';
const CURSOR_PARAM = 'cursor';

/** Every URL parameter this codec owns; all others (for example `q`) pass through untouched. */
export const MANAGED_FILTER_PARAMS: readonly string[] = [
  ...FILTER_DIMENSIONS.map((dimension) => DIMENSION_SPECS[dimension].param),
  PRICE_MIN_PARAM,
  PRICE_MAX_PARAM,
  SORT_PARAM,
  CURSOR_PARAM,
];

// A hostile URL can repeat a parameter thousands of times; look at a bounded number.
const MAX_RAW_VALUES_PER_PARAM = 50;
const MAX_RAW_VALUE_LENGTH = 200;
const CURSOR_PATTERN = /^[A-Za-z0-9+/=_.~:-]{1,512}$/;
// Catalog-sourced values (brand names and the like): letters, digits, spaces and
// a small set of punctuation. No angle brackets, quotes, control characters.
const OPEN_VALUE_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} &'’.,+()/-]{0,79}$/u;

function mapDimensions<T>(
  fn: (dimension: FilterDimension) => T,
): Record<FilterDimension, T> {
  return {
    size: fn('size'),
    brand: fn('brand'),
    productType: fn('productType'),
    comfortLevel: fn('comfortLevel'),
    mattressType: fn('mattressType'),
    benefit: fn('benefit'),
    sleepPosition: fn('sleepPosition'),
    productLine: fn('productLine'),
  };
}

export function emptyFilterState(): FilterState {
  return {
    selected: mapDimensions(() => []),
    priceMinCents: null,
    priceMaxCents: null,
    sort: DEFAULT_SORT,
    cursor: null,
  };
}

function isSortKey(value: unknown): value is SortKey {
  return SORT_KEYS.some((key) => key === value);
}

function vocabularyFor(
  dimension: FilterDimension,
  vocabulary: FilterVocabulary | undefined,
): readonly string[] | null {
  switch (dimension) {
    case 'brand':
    case 'productType':
    case 'productLine':
      return vocabulary?.[dimension] ?? null;
    case 'size':
    case 'comfortLevel':
    case 'mattressType':
    case 'benefit':
    case 'sleepPosition':
      return null;
    default: {
      const unreachable: never = dimension;
      return unreachable;
    }
  }
}

/** Returns the canonical value, or null when the value is not acceptable. */
export function canonicalFilterValue(
  dimension: FilterDimension,
  raw: unknown,
  vocabulary?: FilterVocabulary,
): string | null {
  if (typeof raw !== 'string' || raw.length > MAX_RAW_VALUE_LENGTH) return null;
  const spec = DIMENSION_SPECS[dimension];
  if (spec.fixed) return matchCanonical(spec.fixed, raw);
  const allowed = vocabularyFor(dimension, vocabulary);
  if (allowed) return matchCanonical(allowed, raw);
  const value = raw.normalize('NFC').replace(/\s+/g, ' ').trim();
  return OPEN_VALUE_PATTERN.test(value) ? value : null;
}

function normalizeValues(
  dimension: FilterDimension,
  values: readonly unknown[],
  vocabulary: FilterVocabulary | undefined,
): readonly string[] {
  const spec = DIMENSION_SPECS[dimension];
  const unique = new Set<string>();
  for (const raw of values.slice(0, MAX_RAW_VALUES_PER_PARAM)) {
    const value = canonicalFilterValue(dimension, raw, vocabulary);
    if (value !== null) unique.add(value);
  }
  const sorted = [...unique].sort((a, b) => {
    if (spec.fixed) return indexIn(spec.fixed, a) - indexIn(spec.fixed, b);
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return sorted.slice(0, spec.maxValues);
}

function wholeDollarsToCents(
  cents: number | null | undefined,
  mode: 'floor' | 'ceil',
): number | null {
  if (cents === null || cents === undefined) return null;
  if (!Number.isFinite(cents) || cents <= 0) return null;
  const dollars =
    mode === 'floor' ? Math.floor(cents / 100) : Math.ceil(cents / 100);
  if (dollars <= 0 || dollars > MAX_FILTER_PRICE_DOLLARS) return null;
  return dollars * 100;
}

function normalizePrice(
  minCents: number | null | undefined,
  maxCents: number | null | undefined,
): {min: number | null; max: number | null} {
  // Round outward so the range never excludes more than the shopper asked for.
  const min = wholeDollarsToCents(minCents, 'floor');
  const max = wholeDollarsToCents(maxCents, 'ceil');
  if (min !== null && max !== null && min > max) return {min: max, max: min};
  return {min, max};
}

export type FilterStateInput = {
  readonly selected?: Partial<Record<FilterDimension, readonly unknown[]>>;
  readonly priceMinCents?: number | null;
  readonly priceMaxCents?: number | null;
  readonly sort?: unknown;
  readonly cursor?: unknown;
};

/**
 * Builds a valid, canonical state from anything: unknown values are dropped,
 * lists are de-duplicated and ordered, prices are whole dollars within range.
 * Every other function in this module returns states that pass through here.
 */
export function normalizeFilterState(
  input: FilterStateInput,
  vocabulary?: FilterVocabulary,
): FilterState {
  const price = normalizePrice(input.priceMinCents, input.priceMaxCents);
  return {
    selected: mapDimensions((dimension) =>
      normalizeValues(dimension, input.selected?.[dimension] ?? [], vocabulary),
    ),
    priceMinCents: price.min,
    priceMaxCents: price.max,
    sort: isSortKey(input.sort) ? input.sort : DEFAULT_SORT,
    cursor:
      typeof input.cursor === 'string' && CURSOR_PATTERN.test(input.cursor)
        ? input.cursor
        : null,
  };
}

function parseDollars(raw: string | null): number | null {
  if (raw === null || !/^\d{1,6}$/.test(raw)) return null;
  return Number(raw) * 100;
}

/** Reads filter, sort and cursor state from a URL, dropping anything invalid. */
export function parseFilterParams(
  params: URLSearchParams,
  vocabulary?: FilterVocabulary,
): FilterState {
  return normalizeFilterState(
    {
      selected: mapDimensions((dimension) =>
        params.getAll(DIMENSION_SPECS[dimension].param),
      ),
      priceMinCents: parseDollars(params.get(PRICE_MIN_PARAM)),
      priceMaxCents: parseDollars(params.get(PRICE_MAX_PARAM)),
      sort: params.get(SORT_PARAM),
      cursor: params.get(CURSOR_PARAM),
    },
    vocabulary,
  );
}

/**
 * Writes the state into URL parameters. `base` keeps unrelated parameters such
 * as the search term `q`; this codec's own parameters are replaced. Default
 * sort and empty values are omitted so equal states give equal URLs.
 */
export function serializeFilterParams(
  state: FilterState,
  base?: URLSearchParams,
): URLSearchParams {
  const canonical = normalizeFilterState(state);
  const params = new URLSearchParams(base);
  for (const key of MANAGED_FILTER_PARAMS) params.delete(key);

  for (const dimension of FILTER_DIMENSIONS) {
    const spec = DIMENSION_SPECS[dimension];
    for (const value of canonical.selected[dimension]) {
      params.append(spec.param, spec.fixed ? toSlug(value) : value);
    }
  }
  if (canonical.priceMinCents !== null) {
    params.set(PRICE_MIN_PARAM, String(canonical.priceMinCents / 100));
  }
  if (canonical.priceMaxCents !== null) {
    params.set(PRICE_MAX_PARAM, String(canonical.priceMaxCents / 100));
  }
  if (canonical.sort !== DEFAULT_SORT) params.set(SORT_PARAM, canonical.sort);
  if (canonical.cursor !== null) params.set(CURSOR_PARAM, canonical.cursor);
  return params;
}

// --- State changes used by the filter UI. Each one resets pagination. ---

export function hasActiveFilters(state: FilterState): boolean {
  return countActiveFilters(state) > 0;
}

export function countActiveFilters(state: FilterState): number {
  const values = FILTER_DIMENSIONS.reduce(
    (total, dimension) => total + state.selected[dimension].length,
    0,
  );
  const price = state.priceMinCents !== null || state.priceMaxCents !== null;
  return values + (price ? 1 : 0);
}

/** Clears every filter but keeps the shopper's chosen sort. */
export function clearFilters(state: FilterState): FilterState {
  return {...emptyFilterState(), sort: state.sort};
}

export function withSort(state: FilterState, sort: SortKey): FilterState {
  return normalizeFilterState({...state, sort, cursor: null});
}

export function withCursor(
  state: FilterState,
  cursor: string | null,
): FilterState {
  return normalizeFilterState({...state, cursor});
}

export function withPriceRange(
  state: FilterState,
  minCents: number | null,
  maxCents: number | null,
): FilterState {
  return normalizeFilterState({
    ...state,
    priceMinCents: minCents,
    priceMaxCents: maxCents,
    cursor: null,
  });
}

export type FilterSelection =
  | {
      readonly kind: 'value';
      readonly dimension: FilterDimension;
      readonly value: string;
    }
  | {
      readonly kind: 'price';
      readonly minCents: number | null;
      readonly maxCents: number | null;
    };

export function isSelectionActive(
  state: FilterState,
  selection: FilterSelection,
): boolean {
  if (selection.kind === 'value') {
    return state.selected[selection.dimension].includes(selection.value);
  }
  const range = normalizePrice(selection.minCents, selection.maxCents);
  return range.min === state.priceMinCents && range.max === state.priceMaxCents;
}

/** Adds the selection when absent, removes it when present. */
export function toggleSelection(
  state: FilterState,
  selection: FilterSelection,
  vocabulary?: FilterVocabulary,
): FilterState {
  if (selection.kind === 'price') {
    return isSelectionActive(state, selection)
      ? withPriceRange(state, null, null)
      : withPriceRange(state, selection.minCents, selection.maxCents);
  }
  const current = state.selected[selection.dimension];
  const next = current.includes(selection.value)
    ? current.filter((value) => value !== selection.value)
    : [...current, selection.value];
  return normalizeFilterState(
    {
      ...state,
      selected: {...state.selected, [selection.dimension]: next},
      cursor: null,
    },
    vocabulary,
  );
}

// --- Storefront API mapping ---

/**
 * Shape of the `ProductFilter` input. A list of these goes to `filters:` on
 * `collection.products` and `search`.
 *
 * ASSUMPTION(V-04): values for different filters are combined with AND and
 * several values of the same filter with OR, as in Shopify's theme filtering.
 * ASSUMPTION(V-04): the `price` filter is in dollars (Float), is inclusive and
 * applies to variant prices; the Storefront API reference types min and max as Float.
 */
export type ShopifyProductFilter =
  | {readonly available: boolean}
  | {
      readonly variantOption: {
        readonly name: string;
        readonly value: string;
      };
    }
  | {readonly productVendor: string}
  | {readonly productType: string}
  | {
      readonly productMetafield: {
        readonly namespace: string;
        readonly key: string;
        readonly value: string;
      };
    }
  | {readonly price: {readonly min?: number; readonly max?: number}};

function filterForValue(
  mapping: ShopifyMapping,
  value: string,
): ShopifyProductFilter {
  switch (mapping.kind) {
    case 'variantOption':
      return {variantOption: {name: mapping.name, value}};
    case 'vendor':
      return {productVendor: value};
    case 'productType':
      return {productType: value};
    case 'metafield':
      // ASSUMPTION(V-04): the metafield is enabled as a filter in Search and
      // Discovery, and its stored text equals our canonical label exactly. List
      // metafields (benefits, sleep positions) match when any element equals `value`.
      return {
        productMetafield: {
          namespace: mapping.namespace,
          key: mapping.key,
          value,
        },
      };
    default: {
      const unreachable: never = mapping;
      return unreachable;
    }
  }
}

/** Turns validated state into the `filters` argument for the Storefront API. */
export function buildProductFilters(
  state: FilterState,
  options: {readonly availableOnly?: boolean} = {},
): ShopifyProductFilter[] {
  const canonical = normalizeFilterState(state);
  const filters: ShopifyProductFilter[] = [];
  for (const dimension of FILTER_DIMENSIONS) {
    const mapping = DIMENSION_SPECS[dimension].shopify;
    for (const value of canonical.selected[dimension]) {
      filters.push(filterForValue(mapping, value));
    }
  }
  if (canonical.priceMinCents !== null || canonical.priceMaxCents !== null) {
    // The one place cents become a Float: the API takes dollars. Whole dollars only.
    filters.push({
      price: {
        ...(canonical.priceMinCents !== null && {
          min: canonical.priceMinCents / 100,
        }),
        ...(canonical.priceMaxCents !== null && {
          max: canonical.priceMaxCents / 100,
        }),
      },
    });
  }
  if (options.availableOnly) filters.push({available: true});
  return filters;
}

export type CollectionSort = {
  readonly sortKey:
    'COLLECTION_DEFAULT' | 'BEST_SELLING' | 'PRICE' | 'CREATED' | 'TITLE';
  readonly reverse: boolean;
};

/** `sortKey` and `reverse` for `collection.products` (ProductCollectionSortKeys). */
export function toCollectionSort(sort: SortKey): CollectionSort {
  switch (sort) {
    case 'featured':
      return {sortKey: 'COLLECTION_DEFAULT', reverse: false};
    case 'best-selling':
      return {sortKey: 'BEST_SELLING', reverse: false};
    case 'price-asc':
      return {sortKey: 'PRICE', reverse: false};
    case 'price-desc':
      return {sortKey: 'PRICE', reverse: true};
    case 'newest':
      return {sortKey: 'CREATED', reverse: true};
    case 'title-asc':
      return {sortKey: 'TITLE', reverse: false};
    default: {
      const unreachable: never = sort;
      return unreachable;
    }
  }
}

export type SearchSort = {
  readonly sortKey: 'RELEVANCE' | 'PRICE';
  readonly reverse: boolean;
};

/** `sortKey` and `reverse` for `search` (SearchSortKeys has only RELEVANCE and PRICE). */
export function toSearchSort(sort: SortKey): SearchSort {
  switch (sort) {
    case 'price-asc':
      return {sortKey: 'PRICE', reverse: false};
    case 'price-desc':
      return {sortKey: 'PRICE', reverse: true};
    case 'featured':
    case 'best-selling':
    case 'newest':
    case 'title-asc':
      return {sortKey: 'RELEVANCE', reverse: false};
    default: {
      const unreachable: never = sort;
      return unreachable;
    }
  }
}

// --- The reverse direction: Shopify filter values back into our state ---

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJsonObject(input: unknown): Record<string, unknown> | null {
  if (typeof input !== 'string') return isRecord(input) ? input : null;
  if (input.length > 2000) return null;
  try {
    const parsed: unknown = JSON.parse(input);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function valueSelection(
  dimension: FilterDimension,
  raw: unknown,
  vocabulary: FilterVocabulary | undefined,
): FilterSelection | null {
  const value = canonicalFilterValue(dimension, raw, vocabulary);
  return value === null ? null : {kind: 'value', dimension, value};
}

function dollarsToCents(raw: unknown): number | null | undefined {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) {
    return undefined;
  }
  return Math.round(raw * 100);
}

function metafieldDimension(
  namespace: unknown,
  key: unknown,
): FilterDimension | null {
  if (namespace !== PRODUCT_METAFIELD_NAMESPACE) return null;
  return (
    FILTER_DIMENSIONS.find((dimension) => {
      const mapping = DIMENSION_SPECS[dimension].shopify;
      return mapping.kind === 'metafield' && mapping.key === key;
    }) ?? null
  );
}

/**
 * Reads the `input` of a Storefront API FilterValue (a JSON string, or the
 * parsed object) and returns the matching selection, or null when it is a
 * filter we do not model (tags, availability, unknown values).
 *
 * ASSUMPTION(V-04): `input` uses the same keys as ProductFilter, for example
 * {"productMetafield":{"namespace":"custom","key":"comfort_level","value":"Medium"}}.
 */
export function selectionFromShopifyInput(
  input: unknown,
  vocabulary?: FilterVocabulary,
): FilterSelection | null {
  const object = parseJsonObject(input);
  if (!object) return null;
  const keys = Object.keys(object);
  if (keys.length !== 1) return null;

  const {variantOption, productVendor, productType, productMetafield, price} =
    object;

  if (variantOption !== undefined) {
    if (!isRecord(variantOption)) return null;
    const name = variantOption.name;
    if (typeof name !== 'string' || toSlug(name) !== toSlug(SIZE_OPTION_NAME)) {
      return null;
    }
    return valueSelection('size', variantOption.value, vocabulary);
  }
  if (productVendor !== undefined) {
    return valueSelection('brand', productVendor, vocabulary);
  }
  if (productType !== undefined) {
    return valueSelection('productType', productType, vocabulary);
  }
  if (productMetafield !== undefined) {
    if (!isRecord(productMetafield)) return null;
    const dimension = metafieldDimension(
      productMetafield.namespace,
      productMetafield.key,
    );
    return dimension
      ? valueSelection(dimension, productMetafield.value, vocabulary)
      : null;
  }
  if (price !== undefined) {
    if (!isRecord(price)) return null;
    const min = dollarsToCents(price.min);
    const max = dollarsToCents(price.max);
    if (min === undefined || max === undefined) return null;
    const range = normalizePrice(min, max);
    if (range.min === null && range.max === null) return null;
    return {kind: 'price', minCents: range.min, maxCents: range.max};
  }
  return null;
}

/** Minimal shape of the `filters` in a Storefront API response that we read. */
export type ShopifyFilterGroup = {
  readonly values: readonly {
    readonly count: number;
    readonly input: unknown;
  }[];
};

export type FilterCounts = Readonly<
  Record<FilterDimension, Readonly<Record<string, number>>>
>;

/**
 * Collects the result counts Shopify reports for each value of each dimension.
 * Counts come from Shopify only; we never compute them (REQ-COL-002).
 */
export function countsFromShopifyFilters(
  groups: readonly ShopifyFilterGroup[],
  vocabulary?: FilterVocabulary,
): FilterCounts {
  const maps = mapDimensions(() => new Map<string, number>());
  for (const group of groups) {
    for (const entry of group.values) {
      const selection = selectionFromShopifyInput(entry.input, vocabulary);
      if (selection?.kind !== 'value') continue;
      if (!Number.isInteger(entry.count) || entry.count < 0) continue;
      const map = maps[selection.dimension];
      if (!map.has(selection.value)) map.set(selection.value, entry.count);
    }
  }
  return mapDimensions((dimension) => Object.fromEntries(maps[dimension]));
}

export type FilterOption = {
  readonly value: string;
  readonly count: number;
  readonly selected: boolean;
};

/**
 * The options to show for one dimension: fixed lists in their standard order,
 * catalog-sourced lists alphabetically. A selected value stays visible with
 * count 0 so the shopper can always turn it off.
 */
export function listFilterOptions(
  dimension: FilterDimension,
  counts: FilterCounts,
  state: FilterState,
): FilterOption[] {
  const spec = DIMENSION_SPECS[dimension];
  const values = new Set([
    ...Object.keys(counts[dimension]),
    ...state.selected[dimension],
  ]);
  return [...values]
    .sort((a, b) => {
      if (spec.fixed) return indexIn(spec.fixed, a) - indexIn(spec.fixed, b);
      return a < b ? -1 : a > b ? 1 : 0;
    })
    .map((value) => ({
      value,
      count: counts[dimension][value] ?? 0,
      selected: state.selected[dimension].includes(value),
    }));
}
