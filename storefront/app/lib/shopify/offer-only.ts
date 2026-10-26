// Offer-only products (security review K-L3): the Extend price-point products, the haul-away service, gift
// variants and comfort protectors exist so the cart can hold them as ordinary lines (ADR-0003). They must be
// published to the headless channel for that, which also makes them visible to crawlers. Two tags mark them, and
// this module is the one place that reads the marking, so the sitemap and the product page agree:
//   - `extend-coverage`  the Extend price-point products (the catalog the coverage code already reads)
//   - `offer-only`       every other service, gift or protector product (convention for the client team,
//                        added to the admin guide; set the tag in Shopify admin)
// Shopify's own `seo.hidden` metafield is the preferred second control for the sitemap; whether the Storefront
// sitemap honours it must be verified on the development store (V-05), which is why the tags are read as well.

import type {Storefront} from '~/lib/hydrogen/storefront';
import type {OfferOnlyProductHandlesQuery} from 'storefrontapi.generated';
import {COVERAGE_PRODUCT_TAG} from '~/lib/extend/coverage-catalog';
import {errorFields, logError} from '~/lib/logging/logger';
import {catalogCache} from '~/lib/shopify/cache';

export const OFFER_ONLY_TAG = 'offer-only';

/** Far above the real number (a handful of services and 4 to 8 price points); a hard cap on the read. */
const MAX_OFFER_ONLY_PRODUCTS = 250;

export const OFFER_ONLY_HANDLES_QUERY = `#graphql
  query OfferOnlyProductHandles($query: String!) {
    products(first: 250, query: $query) {
      nodes {
        handle
      }
    }
  }
` as const;

/** The Storefront search expression that finds every offer-only product. */
export const OFFER_ONLY_SEARCH = `tag:${COVERAGE_PRODUCT_TAG} OR tag:${OFFER_ONLY_TAG}`;

export function offerOnlyHandlesFrom(
  data: OfferOnlyProductHandlesQuery | null | undefined,
): ReadonlySet<string> {
  const nodes = data?.products?.nodes ?? [];
  return new Set(
    nodes
      .slice(0, MAX_OFFER_ONLY_PRODUCTS)
      .map((node) => node.handle)
      .filter((handle) => handle !== ''),
  );
}

/**
 * Handles of every offer-only product. A failed read is an empty set (the sitemap then lists them and the page is
 * indexable, which is the pre-existing behaviour) and is logged by class name only.
 */
export async function loadOfferOnlyHandles(
  storefront: Storefront,
): Promise<ReadonlySet<string>> {
  try {
    const data = await storefront.query(OFFER_ONLY_HANDLES_QUERY, {
      cache: catalogCache(storefront),
      variables: {query: OFFER_ONLY_SEARCH},
    });
    return offerOnlyHandlesFrom(data);
  } catch (error) {
    logError('catalog.offer_only_read_failed', errorFields(error));
    return new Set();
  }
}
