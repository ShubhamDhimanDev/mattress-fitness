// Collection and "all products" reads (REQ-COL-001, REQ-COL-002, REQ-COL-004). The loader gives this the
// parsed filter state from the URL codec; filters and sort go to Shopify as variables, never as text in
// the query. Shopify's own filter counts come back and are mapped for the panel; we never compute counts.

import type {Storefront} from '~/lib/hydrogen/storefront';
import {
  buildProductFilters,
  toCollectionSort,
  type FilterState,
  type SortKey,
} from '~/lib/filters';
import {mapProductCards} from '~/lib/shopify/card';
import {pricedCache} from '~/lib/shopify/cache';
import {LISTING_PAGE_SIZE} from '~/lib/shopify/config';
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

export async function loadCollectionPage(
  storefront: Storefront,
  handle: string,
  state: FilterState,
): Promise<CollectionPage> {
  if (!isValidHandle(handle)) return {status: 'not-found'};
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

  return {
    status: 'ok',
    collection: {
      id: collection.id,
      handle: collection.handle,
      title: collection.title,
      description: textToParagraphs(collection.description),
      seoTitle: collection.seo?.title ?? null,
      seoDescription: collection.seo?.description ?? null,
      faqs: mapFaqs(collection.faqs?.references?.nodes),
    },
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
