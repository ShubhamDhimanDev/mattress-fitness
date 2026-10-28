// Collection and "all products" reads (REQ-COL-001, REQ-COL-002, REQ-COL-004). The loader gives this the
// parsed filter state from the URL codec; filters and sort go to Shopify as variables, never as text in
// the query. Shopify's own filter counts come back and are mapped for the panel; we never compute counts.

import type {Storefront} from '~/lib/hydrogen/storefront';
import type {CatalogCollectionQuery} from 'storefrontapi.generated';
import {
  buildProductFilters,
  normalizeFilterState,
  toCollectionSort,
  type FilterState,
  type SortKey,
} from '~/lib/filters';
import {logWarn} from '~/lib/logging/logger';
import {mapProductCards} from '~/lib/shopify/card';
import {pricedCache} from '~/lib/shopify/cache';
import {LISTING_PAGE_SIZE} from '~/lib/shopify/config';
import {
  listLocally,
  parseLocalCursor,
  shopifyHonoursFilters,
} from '~/lib/shopify/local-filter';
import {mapFaqs} from '~/lib/shopify/product';
import {textToParagraphs} from '~/lib/shopify/rich-text';
import {buildFilterGroups, type FilterGroupView} from '~/lib/shopify/listing';
import {ALL_PRODUCTS_QUERY, COLLECTION_QUERY} from '~/lib/shopify/queries';
import type {FaqView, PageInfoView, ProductCardView} from '~/lib/shopify/types';

const HANDLE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,254}$/;

/** Handles are path segments from the URL; reject anything that is not a plausible Shopify handle. */
export function isValidHandle(handle: unknown): handle is string {
  return typeof handle === 'string' && HANDLE_PATTERN.test(handle);
}

export type CollectionPage =
  | {
      readonly status: 'ok';
      readonly collection: {
        readonly id: string;
        readonly handle: string;
        readonly title: string;
        readonly description: readonly string[];
        readonly seoTitle: string | null;
        readonly seoDescription: string | null;
        readonly faqs: readonly FaqView[];
      };
      readonly products: readonly ProductCardView[];
      readonly pageInfo: PageInfoView;
      readonly filterGroups: readonly FilterGroupView[];
    }
  | {readonly status: 'not-found'};

type CollectionSource = NonNullable<CatalogCollectionQuery['collection']>;

function mapCollection(collection: CollectionSource) {
  return {
    id: collection.id,
    handle: collection.handle,
    title: collection.title,
    description: textToParagraphs(collection.description),
    seoTitle: collection.seo?.title ?? null,
    seoDescription: collection.seo?.description ?? null,
    faqs: mapFaqs(collection.faqs?.references?.nodes),
  };
}

/** One Storefront API page; the whole collection is read in at most this many pages when filtering here. */
const LOCAL_PAGE_SIZE = 250;
const LOCAL_MAX_PAGES = 2;

/**
 * The whole collection in the shopper's sort order, with only the price range sent to Shopify (the one filter every store
 * has). Everything else is filtered by `listLocally`. Null when the collection does not exist.
 */
async function loadWholeCollection(
  storefront: Storefront,
  handle: string,
  state: FilterState,
) {
  const {sortKey, reverse} = toCollectionSort(state.sort);
  const priceOnly = normalizeFilterState({
    priceMinCents: state.priceMinCents,
    priceMaxCents: state.priceMaxCents,
  });
  let collection: CollectionSource | null = null;
  const nodes: CollectionSource['products']['nodes'] = [];
  let after: string | null = null;
  for (let page = 0; page < LOCAL_MAX_PAGES; page += 1) {
    const result: CatalogCollectionQuery = await storefront.query(
      COLLECTION_QUERY,
      {
        cache: pricedCache(storefront),
        variables: {
          handle,
          first: LOCAL_PAGE_SIZE,
          after,
          sortKey,
          reverse,
          filters: buildProductFilters(priceOnly),
        },
      },
    );
    if (!result.collection) return null;
    collection ??= result.collection;
    nodes.push(...result.collection.products.nodes);
    if (!result.collection.products.pageInfo.hasNextPage)
      return {collection, nodes};
    after = result.collection.products.pageInfo.endCursor ?? null;
  }
  logWarn('collection.local_filter_truncated', {
    limit: LOCAL_PAGE_SIZE * LOCAL_MAX_PAGES,
  });
  return collection ? {collection, nodes} : null;
}

async function loadLocallyFiltered(
  storefront: Storefront,
  handle: string,
  state: FilterState,
): Promise<CollectionPage> {
  const whole = await loadWholeCollection(storefront, handle, state);
  if (!whole) return {status: 'not-found'};
  const listing = listLocally(
    whole.nodes,
    state,
    parseLocalCursor(state.cursor) ?? 0,
    LISTING_PAGE_SIZE,
  );
  return {
    status: 'ok',
    collection: mapCollection(whole.collection),
    products: mapProductCards(listing.products),
    pageInfo: listing.pageInfo,
    filterGroups: listing.filterGroups,
  };
}

export async function loadCollectionPage(
  storefront: Storefront,
  handle: string,
  state: FilterState,
): Promise<CollectionPage> {
  if (!isValidHandle(handle)) return {status: 'not-found'};
  // A "Load more" cursor of ours (local-filter.ts) never goes to Shopify.
  if (parseLocalCursor(state.cursor) !== null) {
    return loadLocallyFiltered(storefront, handle, state);
  }
  const {sortKey, reverse} = toCollectionSort(state.sort);
  const {collection} = await storefront.query(COLLECTION_QUERY, {
    // Cards carry price and availability: 60 s strategy (DEC-024).
    cache: pricedCache(storefront),
    variables: {
      handle,
      first: LISTING_PAGE_SIZE,
      after: state.cursor,
      sortKey,
      reverse,
      filters: buildProductFilters(state),
    },
  });
  if (!collection) return {status: 'not-found'};
  // A store without Search & Discovery filters ignores all but the price filter and offers no groups: filter here instead.
  if (!shopifyHonoursFilters(collection.products.filters, state)) {
    return loadLocallyFiltered(storefront, handle, state);
  }

  return {
    status: 'ok',
    collection: mapCollection(collection),
    products: mapProductCards(collection.products.nodes),
    pageInfo: {
      hasNextPage: collection.products.pageInfo.hasNextPage,
      endCursor: collection.products.pageInfo.endCursor ?? null,
    },
    filterGroups: buildFilterGroups(collection.products.filters, state),
  };
}

export type AllProductsPage = {
  readonly products: readonly ProductCardView[];
  readonly pageInfo: PageInfoView;
};

/** Root `products` supports sorting but not filters, so the all-products page offers sort only. */
function toProductSort(sort: SortKey): {
  sortKey: 'BEST_SELLING' | 'PRICE' | 'CREATED_AT' | 'TITLE' | 'RELEVANCE';
  reverse: boolean;
} {
  switch (sort) {
    case 'best-selling':
      return {sortKey: 'BEST_SELLING', reverse: false};
    case 'price-asc':
      return {sortKey: 'PRICE', reverse: false};
    case 'price-desc':
      return {sortKey: 'PRICE', reverse: true};
    case 'newest':
      return {sortKey: 'CREATED_AT', reverse: true};
    case 'title-asc':
      return {sortKey: 'TITLE', reverse: false};
    case 'featured':
      return {sortKey: 'BEST_SELLING', reverse: false};
    default: {
      const unreachable: never = sort;
      return unreachable;
    }
  }
}

export async function loadAllProductsPage(
  storefront: Storefront,
  state: FilterState,
): Promise<AllProductsPage> {
  const {sortKey, reverse} = toProductSort(state.sort);
  const {products} = await storefront.query(ALL_PRODUCTS_QUERY, {
    cache: pricedCache(storefront),
    variables: {
      first: LISTING_PAGE_SIZE,
      after: state.cursor,
      sortKey,
      reverse,
    },
  });
  return {
    products: mapProductCards(products.nodes),
    pageInfo: {
      hasNextPage: products.pageInfo.hasNextPage,
      endCursor: products.pageInfo.endCursor ?? null,
    },
  };
}
