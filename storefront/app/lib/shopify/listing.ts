// Listing helpers shared by the collection and search pages: the filter panel model, URLs for every filter
// change, and the "Load more" merge. Pure; the filter state itself lives in lib/filters.ts (the URL codec).

import {
  FILTER_DIMENSIONS,
  countsFromShopifyFilters,
  listFilterOptions,
  normalizeFilterState,
  serializeFilterParams,
  toggleSelection,
  withPriceRange,
  withSort,
  clearFilters,
  type FilterCounts,
  type FilterDimension,
  type FilterOption,
  type FilterState,
  type ShopifyFilterGroup,
  type SortKey,
} from '~/lib/filters';
import type {PageInfoView, ProductCardView} from '~/lib/shopify/types';

export const FILTER_LABELS: Readonly<Record<FilterDimension, string>> = {
  size: 'Size',
  brand: 'Brand',
  productType: 'Product type',
  comfortLevel: 'Comfort level',
  mattressType: 'Mattress type',
  benefit: 'Benefits',
  sleepPosition: 'Sleep position',
  productLine: 'Product line',
};

export type FilterGroupView = {
  readonly dimension: FilterDimension;
  readonly label: string;
  readonly options: readonly FilterOption[];
};

/**
 * Groups for the panel: only dimensions Shopify returned values for (or that the shopper has selected), so
 * a store that has not configured a filter in Search & Discovery shows no empty group (REQ-COL-002).
 */
export function buildFilterGroups(
  groups: readonly ShopifyFilterGroup[],
  state: FilterState,
): FilterGroupView[] {
  const counts: FilterCounts = countsFromShopifyFilters(groups);
  return FILTER_DIMENSIONS.flatMap((dimension) => {
    const options = listFilterOptions(dimension, counts, state);
    return options.length === 0
      ? []
      : [{dimension, label: FILTER_LABELS[dimension], options}];
  });
}

/** Path plus query for a state; `base` keeps unrelated parameters such as the search term `q`. */
export function hrefForState(
  pathname: string,
  state: FilterState,
  base?: URLSearchParams,
): string {
  const query = serializeFilterParams(state, base).toString();
  return query === '' ? pathname : `${pathname}?${query}`;
}

export function hrefForToggle(
  pathname: string,
  state: FilterState,
  dimension: FilterDimension,
  value: string,
  base?: URLSearchParams,
): string {
  return hrefForState(
    pathname,
    toggleSelection(state, {kind: 'value', dimension, value}),
    base,
  );
}

export function hrefForSort(
  pathname: string,
  state: FilterState,
  sort: SortKey,
  base?: URLSearchParams,
): string {
  return hrefForState(pathname, withSort(state, sort), base);
}

export function hrefForPrice(
  pathname: string,
  state: FilterState,
  minDollars: string,
  maxDollars: string,
  base?: URLSearchParams,
): string {
  return hrefForState(
    pathname,
    withPriceRange(
      state,
      dollarsInputToCents(minDollars),
      dollarsInputToCents(maxDollars),
    ),
    base,
  );
}

export function hrefForReset(
  pathname: string,
  state: FilterState,
  base?: URLSearchParams,
): string {
  return hrefForState(pathname, clearFilters(state), base);
}

/** Whole dollars typed into a price field, as cents; anything else is "no limit". */
export function dollarsInputToCents(input: string): number | null {
  const trimmed = input.trim().replace(/^\$/, '');
  if (!/^\d{1,6}$/.test(trimmed)) return null;
  const dollars = Number(trimmed);
  return dollars > 0 ? dollars * 100 : null;
}

/** Whole dollars of a price bound for the field's value, or an empty string. */
export function centsToDollarsInput(cents: number | null): string {
  return cents === null ? '' : String(cents / 100);
}

/** State for the next "Load more" request: same filters and sort, the cursor of the next page. */
export function nextPageState(state: FilterState, cursor: string): FilterState {
  return normalizeFilterState({...state, cursor});
}

/**
 * The products and page info out of a loader response fetched for "Load more". The data arrives as JSON from
 * our own loader, but it is checked anyway so a failed or unrelated response is ignored, not rendered.
 */
export function readListingPage(
  data: unknown,
): {products: ProductCardView[]; pageInfo: PageInfoView} | null {
  if (typeof data !== 'object' || data === null) return null;
  const entries = new Map(Object.entries(data));
  const products = entries.get('products');
  const pageInfo = entries.get('pageInfo');
  if (
    !Array.isArray(products) ||
    typeof pageInfo !== 'object' ||
    pageInfo === null
  ) {
    return null;
  }
  const info = new Map(Object.entries(pageInfo));
  const endCursor = info.get('endCursor');
  const totalCount = info.get('totalCount');
  return {
    products: products.filter(isCardView),
    pageInfo: {
      hasNextPage: info.get('hasNextPage') === true,
      endCursor: typeof endCursor === 'string' ? endCursor : null,
      totalCount:
        typeof totalCount === 'number' &&
        Number.isSafeInteger(totalCount) &&
        totalCount >= 0
          ? totalCount
          : null,
    },
  };
}

function isCardView(value: unknown): value is ProductCardView {
  if (typeof value !== 'object' || value === null) return false;
  const fields = new Map(Object.entries(value));
  return (
    typeof fields.get('id') === 'string' &&
    typeof fields.get('handle') === 'string' &&
    typeof fields.get('title') === 'string'
  );
}

/** Appends a loaded page without repeating products that shifted between pages. */
export function appendUnique<T extends {readonly id: string}>(
  current: readonly T[],
  next: readonly T[],
): T[] {
  const seen = new Set(current.map((item) => item.id));
  return [...current, ...next.filter((item) => !seen.has(item.id))];
}

/**
 * "12 of 37 products" while more can be loaded and the total is known, "37 products" once all are on the page, and the old
 * "12 products shown" when the total is unknown (Shopify reports none; only a list we filter ourselves has one).
 */
export function countLabel(
  loaded: number,
  total: number | null,
  hasMore: boolean,
): string {
  const noun = (n: number) => (n === 1 ? 'product' : 'products');
  if (total !== null && hasMore && total > loaded) {
    return `${loaded} of ${total} ${noun(total)}`;
  }
  return `${loaded} ${noun(loaded)}${hasMore ? ' shown' : ''}`;
}
