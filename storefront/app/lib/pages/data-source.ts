// The one seam between the quiz and comparison pages and their
// data. There is no development store yet, and mock.shop has none of the mattress
// metafields (comfort level, type, sleep positions, benefits), so today every function returns the synthetic fixtures and says so
// through `source`. Pages show a visible preview notice whenever `source` is
// 'fixtures' (NFR-007: the fixture brands are fictional and must never look real).
//
// Loaders call these functions on the server; components never import this file.
// Replacing the bodies with Storefront API queries must not change the signatures.

import type {Storefront} from '~/lib/hydrogen/storefront';
import type {CatalogProduct} from '~/lib/catalog/types';
import {loadQuizConfigRaw} from '~/lib/shopify/quiz-data';
import {loadQuizProducts} from '~/lib/shopify/quiz-products';
import {FIXTURE_PRODUCTS} from '~/lib/catalog/fixtures';

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
 * Products the quiz may recommend, with size variants, prices and availability. With a Storefront client the
 * `mattresses` collection is read (P3B-01, priced cache) and that is the answer, even when it is empty or the read
 * failed: the quiz then says it found no mattresses, and never shows the fictional preview products on a connected
 * store. The labelled fixtures are only for running without a Storefront client.
 */
export async function getQuizProducts(
  storefront?: Storefront,
): Promise<QuizProductsResult> {
  if (storefront) {
    return {source: 'shopify', products: await loadQuizProducts(storefront)};
  }
  return {source: 'fixtures', products: previewProducts()};
}

/**
 * The admin-managed quiz configuration exactly as stored (a loose JSON value),
 * or undefined when the client has not created one, in which case the default
 * quiz is used (REQ-QZ-004). With a Storefront client the `quiz_question`, `quiz_option` and `quiz_scoring_rule`
 * metaobjects are read (P6-13); without one, or when none exist or the read fails, the answer is undefined.
 */
export function getQuizConfigRaw(storefront?: Storefront): Promise<unknown> {
  return storefront
    ? loadQuizConfigRaw(storefront)
    : Promise.resolve(undefined);
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
