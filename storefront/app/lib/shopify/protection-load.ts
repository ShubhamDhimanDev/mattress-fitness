// The product page's "has an Extend category" hint, read by HANDLE so it can start together with the product read
// instead of after it (review m7: the page used to wait for the product, then for this). It reads the same
// `custom.extend_category` metafield, validated by the same parser, as the by-id read the offers route uses
// (`loadProductCategories`), so the page's hint and the server's answer cannot disagree.

import {parseProductCategories} from '~/lib/extend/coverage-facts';
import type {FactsStorefront} from '~/lib/extend/coverage-facts';
import {errorFields, logError} from '~/lib/logging/logger';
import {pricedCache} from '~/lib/shopify/cache';
import {isValidHandle} from '~/lib/shopify/collection-data';

export const EXTEND_PRODUCT_CATEGORY_BY_HANDLE_QUERY = `#graphql
  query ExtendProductCategoryByHandle($handle: String!, $country: CountryCode, $language: LanguageCode)
  @inContext(country: $country, language: $language) {
    product(handle: $handle) {
      id
      metafield(namespace: "custom", key: "extend_category") {
        value
      }
    }
  }
` as const;

/**
 * Whether the product with this handle has an Extend category. False for an unknown handle (the page is a 404 then
 * and the answer is unused), null when the read failed (the page then reserves no space instead of guessing).
 * Never throws; an invalid handle makes no request.
 */
export async function loadExtendEligibilityByHandle(
  storefront: FactsStorefront,
  handle: string,
): Promise<boolean | null> {
  if (!isValidHandle(handle)) return false;
  try {
    const raw: unknown = await storefront.query(
      EXTEND_PRODUCT_CATEGORY_BY_HANDLE_QUERY,
      {cache: pricedCache(storefront), variables: {handle}},
    );
    const product =
      typeof raw === 'object' && raw !== null && 'product' in raw
        ? raw.product
        : null;
    return parseProductCategories({nodes: [product]}).size > 0;
  } catch (error) {
    logError('coverage.facts_read_failed', {
      what: 'product category by handle',
      ...errorFields(error),
    });
    return null;
  }
}
