// The one seam between the quiz, comparison and store-locator pages and their
// data. There is no development store yet, and mock.shop has none of the mattress
// metafields (comfort level, type, sleep positions, benefits) or `store`
// metaobjects, so today every function returns the synthetic fixtures and says so
// through `source`. Pages show a visible preview notice whenever `source` is
// 'fixtures' (NFR-007: the fixture brands are fictional and must never look real).
//
// Loaders call these functions on the server; components never import this file.
// Replacing the bodies with Storefront API queries must not change the signatures.

import type {CatalogProduct} from '~/lib/catalog/types';
import {FIXTURE_PRODUCTS} from '~/lib/catalog/fixtures';
import {FIXTURE_STORES, FIXTURE_STORE_WARNINGS} from '~/lib/stores/fixtures';
import type {Store} from '~/lib/stores/types';

/** Where the data came from. 'shopify' is returned only once the real queries exist. */
export type DataSource = 'fixtures' | 'shopify';

/**
 * Fixture image URLs use the reserved ".test" domain and never resolve, so the
 * preview products carry no images and the UI draws a neutral placeholder tile.
 */
function previewProducts(): readonly CatalogProduct[] {
  return FIXTURE_PRODUCTS.map((product) => ({...product, images: []}));
}

export type QuizProductsResult = {
  readonly source: DataSource;
  readonly products: readonly CatalogProduct[];
};

/**
 * Products the quiz may recommend, with size variants, prices and availability.
 * TODO(P3B-01): replace with a Storefront API query for the mattress collection
 * (metafields from SHOPIFY_DATA_MODEL "Product"), cached long with short-lived
 * availability.
 */
export function getQuizProducts(): Promise<QuizProductsResult> {
  return Promise.resolve({source: 'fixtures', products: previewProducts()});
}

/**
 * The admin-managed quiz configuration exactly as stored (a loose JSON value),
 * or undefined when the client has not created one, in which case the default
 * quiz is used (REQ-QZ-004).
 * TODO(P6-01): read the quiz question metaobjects through the Storefront API.
 */
export function getQuizConfigRaw(): Promise<unknown> {
  return Promise.resolve(undefined);
}

export type CompareCandidatesResult = {
  readonly source: DataSource;
  /**
   * Must contain the product for every requested handle that still exists, plus
   * the products offered in the picker and used for "similar products".
   */
  readonly candidates: readonly CatalogProduct[];
};

/**
 * Products for the comparison page. `handles` are already validated.
 * TODO(P3B-01): replace with a Storefront API query: the requested handles
 * (`product(handle:)` in one batched request) plus a bounded picker list (first
 * 50 of the mattress collection or a search result), never the whole catalog.
 */
export function getCompareCandidates(
  handles: readonly string[],
): Promise<CompareCandidatesResult> {
  // Fixtures hold every product already; the handles matter to the real query.
  void handles;
  return Promise.resolve({source: 'fixtures', candidates: previewProducts()});
}

export type StoresResult = {
  readonly source: DataSource;
  readonly stores: readonly Store[];
  /** Problems found while reading store records; contain no personal data. */
  readonly warnings: readonly string[];
};

/**
 * Every published store for the locator (REQ-LOC-001, REQ-LOC-002).
 * TODO(P3A-07): replace with the Storefront API `store` metaobject query,
 * parsed with parseStoreRecords, cached long.
 */
export function getStores(): Promise<StoresResult> {
  return Promise.resolve({
    source: 'fixtures',
    stores: FIXTURE_STORES,
    warnings: FIXTURE_STORE_WARNINGS,
  });
}
