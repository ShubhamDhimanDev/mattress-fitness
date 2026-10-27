// Which collections exist in Shopify, so the fixed navigation never links one that 404s (REQ-NAV-001, REQ-NAV-002). One
// small read of handles only (no price, availability or shopper data), so it uses the long catalog cache (cache.ts): a
// collection made in admin shows in the menu after the cache window. A failed read gives `null`, which keeps every link
// (the menu is then no worse than before); only a read that worked removes links.

import type {Storefront} from '~/lib/hydrogen/storefront';
import {errorFields, logError} from '~/lib/logging/logger';
import type {CollectionHandles} from '~/lib/navigation';
import {catalogCache} from '~/lib/shopify/cache';

// The 250 most recent are enough: the fixed menu names about a dozen handles, and a store near the cap has a menu of its own.
export const COLLECTION_HANDLES_QUERY = `#graphql
  query CollectionHandles($country: CountryCode, $language: LanguageCode)
    @inContext(country: $country, language: $language) {
    collections(first: 250) {
      nodes {
        handle
      }
    }
  }
` as const;

export async function loadCollectionHandles(
  storefront: Storefront,
): Promise<CollectionHandles> {
  try {
    const {collections} = await storefront.query(COLLECTION_HANDLES_QUERY, {
      cache: catalogCache(storefront),
    });
    return new Set(collections.nodes.map((node) => node.handle));
  } catch (error: unknown) {
    logError('nav.collection_handles_read_failed', errorFields(error));
    return null;
  }
}
