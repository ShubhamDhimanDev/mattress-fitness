// Search results read (REQ-SRCH-002): products with the same filter set and URL state as collections,
// plus a few matching pages and articles, and collections to suggest when nothing matches.

import type {Storefront} from '~/lib/hydrogen/storefront';
import {
  SEARCH_SORT_KEYS,
  buildProductFilters,
  toSearchSort,
  withSort,
  type FilterState,
} from '~/lib/filters';
import {cleanText} from '~/lib/catalog/text';
import {searchCache} from '~/lib/shopify/cache';
import {mapProductCards} from '~/lib/shopify/card';
import {
  LISTING_PAGE_SIZE,
  MAX_CACHED_TERM_LENGTH,
  MAX_SEARCH_TERM_LENGTH,
} from '~/lib/shopify/config';
import {buildFilterGroups, type FilterGroupView} from '~/lib/shopify/listing';
import {
  SEARCH_CONTENT_QUERY,
  SEARCH_PRODUCTS_QUERY,
} from '~/lib/shopify/queries';
import type {PageInfoView, ProductCardView} from '~/lib/shopify/types';

/** The `q` parameter as a safe search term: plain text, one line, bounded length. */
export function normalizeSearchTerm(raw: string | null | undefined): string {
  return cleanText(raw ?? '').slice(0, MAX_SEARCH_TERM_LENGTH);
}

/**
 * The form of the term sent to Shopify, which is also what Hydrogen's cache key embeds (the key is the
 * query plus its variables and cannot be overridden). Lower-casing and bounding it stops one phrase from
 * creating many cache entries and keeps oversized hostile input out of the key. Search is case-insensitive,
 * so results are unchanged. The shopper's own spelling is still what the page displays.
 */
export function toCacheableTerm(term: string): string {
  return term.trim().toLowerCase().slice(0, MAX_CACHED_TERM_LENGTH);
}

/** Search can only sort by relevance or price; any other sort falls back to relevance. */
export function searchStateFor(state: FilterState): FilterState {
  return SEARCH_SORT_KEYS.includes(state.sort)
    ? state
    : withSort(state, 'featured');
}

export type ContentLink = {
  readonly id: string;
  readonly title: string;
  readonly to: string;
};

export type SearchPageData = {
  readonly term: string;
  readonly totalCount: number;
  readonly products: readonly ProductCardView[];
  readonly pageInfo: PageInfoView;
  readonly filterGroups: readonly FilterGroupView[];
  readonly pages: readonly ContentLink[];
  readonly articles: readonly ContentLink[];
  readonly suggestedCollections: readonly ContentLink[];
};

const EMPTY_PAGE_INFO: PageInfoView = {hasNextPage: false, endCursor: null};

export function emptySearchPage(term: string): SearchPageData {
  return {
    term,
    totalCount: 0,
    products: [],
    pageInfo: EMPTY_PAGE_INFO,
    filterGroups: [],
    pages: [],
    articles: [],
    suggestedCollections: [],
  };
}

function text(node: object, key: string): string | null {
  const value: unknown = Object.entries(node).find(([k]) => k === key)?.[1];
  return typeof value === 'string' && value !== '' ? value : null;
}

/** Search nodes are a union, so non-matching types arrive as empty objects; only complete ones are kept. */
export function pageLinks(nodes: readonly object[]): ContentLink[] {
  return nodes.flatMap((node) => {
    const id = text(node, 'id');
    const handle = text(node, 'handle');
    const title = text(node, 'title');
    return id && handle && title
      ? [{id, title, to: `/pages/${encodeURIComponent(handle)}`}]
      : [];
  });
}

export function articleLinks(nodes: readonly object[]): ContentLink[] {
  return nodes.flatMap((node) => {
    const id = text(node, 'id');
    const handle = text(node, 'handle');
    const title = text(node, 'title');
    const blog = Object.entries(node).find(([key]) => key === 'blog')?.[1];
    const blogHandle =
      typeof blog === 'object' && blog !== null ? text(blog, 'handle') : null;
    return id && handle && title && blogHandle
      ? [
          {
            id,
            title,
            to: `/blogs/${encodeURIComponent(blogHandle)}/${encodeURIComponent(handle)}`,
          },
        ]
      : [];
  });
}

export async function loadSearchPage(
  storefront: Storefront,
  rawTerm: string | null,
  rawState: FilterState,
): Promise<SearchPageData> {
  const term = normalizeSearchTerm(rawTerm);
  if (term === '') return emptySearchPage(term);
  const state = searchStateFor(rawState);
  const {sortKey, reverse} = toSearchSort(state.sort);

  const queryTerm = toCacheableTerm(term);

  // Pages, articles and suggestions belong to the first page of results only.
  const [{products}, content] = await Promise.all([
    storefront.query(SEARCH_PRODUCTS_QUERY, {
      cache: searchCache(storefront),
      variables: {
        term: queryTerm,
        first: LISTING_PAGE_SIZE,
        after: state.cursor,
        sortKey,
        reverse,
        productFilters: buildProductFilters(state),
      },
    }),
    state.cursor === null
      ? storefront.query(SEARCH_CONTENT_QUERY, {
          cache: searchCache(storefront),
          variables: {term: queryTerm},
        })
      : Promise.resolve(null),
  ]);

  return {
    term,
    totalCount: products.totalCount,
    products: mapProductCards(products.nodes),
    pageInfo: {
      hasNextPage: products.pageInfo.hasNextPage,
      endCursor: products.pageInfo.endCursor ?? null,
    },
    filterGroups: buildFilterGroups(products.productFilters, state),
    pages: pageLinks(content?.pages.nodes ?? []),
    articles: articleLinks(content?.articles.nodes ?? []),
    suggestedCollections: (content?.collections.nodes ?? []).map(
      (collection) => ({
        id: collection.id,
        title: collection.title,
        to: `/collections/${collection.handle}`,
      }),
    ),
  };
}
