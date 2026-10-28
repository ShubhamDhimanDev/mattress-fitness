// Filtering a whole collection in our own code, for a store whose Search & Discovery filters are not set up (B-26, V-04).
//
// Shopify only answers a `filters:` argument, and only reports filter groups with counts, for the filters enabled in Search &
// Discovery. A store without them returns the price group alone and ignores a size, comfort or type filter, so a link such as
// "Shop by size > Twin" showed the whole collection with "Twin (0)". When that is detected, the collection loader reads the
// whole collection from Shopify (price filter and sort still go to Shopify) and this module applies the other filters to the
// cards' own data (variant sizes, vendor, `custom.*` metafields), counts the values for the panel and cuts the page.
//
// Every figure is still derived from Shopify's data of the request; nothing is stored here. With the filters enabled in
// Search & Discovery the loader never gets here, and Shopify's counts are used as before (REQ-COL-002).
//
// Pure: no Shopify client, no framework.

import type {CatalogProductCardFragment} from 'storefrontapi.generated';
import {
  BENEFITS,
  COMFORT_LEVELS,
  MATTRESS_TYPES,
  PRODUCT_METAFIELD_KEYS,
  SIZES,
  SLEEP_POSITIONS,
  matchCanonical,
  toSlug,
} from '~/lib/catalog/attributes';
import {
  FILTER_DIMENSIONS,
  countsFromShopifyFilters,
  listFilterOptions,
  type FilterCounts,
  type FilterDimension,
  type FilterState,
  type ShopifyFilterGroup,
} from '~/lib/filters';
import {sizesOfVariants} from '~/lib/shopify/card';
import {FILTER_LABELS, type FilterGroupView} from '~/lib/shopify/listing';
import {
  indexMetafields,
  readChoice,
  readChoices,
  readText,
} from '~/lib/shopify/metafields';
import type {PageInfoView} from '~/lib/shopify/types';

const LOCAL_CURSOR = /^local:(\d{1,5})$/;

/** The "Load more" cursor of a locally cut page: an offset into the filtered list, never sent to Shopify. */
export function localCursor(offset: number): string {
  return `local:${offset}`;
}

/** The offset in a local cursor, or null for no cursor or one of Shopify's. */
export function parseLocalCursor(cursor: string | null): number | null {
  const match = cursor === null ? null : LOCAL_CURSOR.exec(cursor);
  return match?.[1] === undefined ? null : Number(match[1]);
}

type Facets = Readonly<Record<FilterDimension, readonly string[]>>;

function single(value: string | null | undefined): readonly string[] {
  return value ? [value] : [];
}

/** The values a product has for each filter dimension, in the same canonical labels the URL uses. */
export function facetsOf(product: CatalogProductCardFragment): Facets {
  const metafields = indexMetafields(product.metafields);
  const sizes = sizesOfVariants(product.variants.nodes).flatMap((size) =>
    single(matchCanonical(SIZES, size)),
  );
  return {
    size: sizes,
    brand: single(product.vendor.trim()),
    productType: single(product.productType.trim()),
    comfortLevel: single(
      readChoice(
        metafields,
        PRODUCT_METAFIELD_KEYS.comfortLevel,
        COMFORT_LEVELS,
      ),
    ),
    mattressType: single(
      readChoice(
        metafields,
        PRODUCT_METAFIELD_KEYS.mattressType,
        MATTRESS_TYPES,
      ),
    ),
    benefit: readChoices(metafields, PRODUCT_METAFIELD_KEYS.benefits, BENEFITS),
    sleepPosition: readChoices(
      metafields,
      PRODUCT_METAFIELD_KEYS.sleepPositions,
      SLEEP_POSITIONS,
    ),
    productLine: single(
      readText(metafields, PRODUCT_METAFIELD_KEYS.productLine),
    ),
  };
}

/** Several values of one dimension are alternatives (OR); different dimensions all have to hold (AND). */
function matches(
  facets: Facets,
  state: FilterState,
  skip: FilterDimension | null,
): boolean {
  return FILTER_DIMENSIONS.every((dimension) => {
    const wanted = state.selected[dimension];
    if (dimension === skip || wanted.length === 0) return true;
    const has = new Set(facets[dimension].map(toSlug));
    return wanted.some((value) => has.has(toSlug(value)));
  });
}

/**
 * Whether Shopify's answer can be used as it is: it offers filter values for at least one of our dimensions, and for every
 * dimension the shopper selected. Otherwise it ignored what was asked and the collection is filtered here.
 */
export function shopifyHonoursFilters(
  groups: readonly ShopifyFilterGroup[],
  state: FilterState,
): boolean {
  const counts = countsFromShopifyFilters(groups);
  const offered = FILTER_DIMENSIONS.filter(
    (dimension) => Object.keys(counts[dimension]).length > 0,
  );
  return (
    offered.length > 0 &&
    FILTER_DIMENSIONS.every(
      (dimension) =>
        state.selected[dimension].length === 0 || offered.includes(dimension),
    )
  );
}

export type LocalListing = {
  readonly products: readonly CatalogProductCardFragment[];
  readonly pageInfo: PageInfoView;
  readonly filterGroups: readonly FilterGroupView[];
};

/**
 * Filters `all` (the whole collection, already in the shopper's sort order) by `state`, cuts the page that starts at `offset`
 * and builds the panel groups. A value's count is the number of products that would match if that dimension were
 * not restricted, so the panel shows what a click would give, as Shopify's own counts do.
 */
export function listLocally(
  all: readonly CatalogProductCardFragment[],
  state: FilterState,
  offset: number,
  pageSize: number,
): LocalListing {
  const entries = all.map((product) => ({product, facets: facetsOf(product)}));
  const kept = entries.filter((entry) => matches(entry.facets, state, null));
  const end = Math.min(kept.length, offset + pageSize);

  const tally = (dimension: FilterDimension): Record<string, number> => {
    const counted: Record<string, number> = {};
    for (const entry of entries) {
      if (!matches(entry.facets, state, dimension)) continue;
      for (const value of new Set(entry.facets[dimension])) {
        counted[value] = (counted[value] ?? 0) + 1;
      }
    }
    return counted;
  };
  const counts: FilterCounts = {
    size: tally('size'),
    brand: tally('brand'),
    productType: tally('productType'),
    comfortLevel: tally('comfortLevel'),
    mattressType: tally('mattressType'),
    benefit: tally('benefit'),
    sleepPosition: tally('sleepPosition'),
    productLine: tally('productLine'),
  };

  return {
    products: kept.slice(offset, end).map((entry) => entry.product),
    pageInfo: {
      hasNextPage: end < kept.length,
      endCursor: end < kept.length ? localCursor(end) : null,
      totalCount: kept.length,
    },
    filterGroups: FILTER_DIMENSIONS.flatMap((dimension) => {
      const options = listFilterOptions(dimension, counts, state);
      return options.length === 0
        ? []
        : [{dimension, label: FILTER_LABELS[dimension], options}];
    }),
  };
}
