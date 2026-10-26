// The `store` metaobjects as the locator, the header's "my store" and pickup read them (P3A-07, REQ-LOC-002).
// Server side only. The records go through the same `parseStoreRecords` as the fixtures, so a typo in admin skips
// one field or one store and never breaks a page.
//
// Absent data degrades to today's behaviour: a store with no `store` entries (or a failed read) returns null and
// the caller keeps the labelled fixtures (data-source.ts). Store text carries no price or availability, so the long
// cache applies (an edit shows after about an hour, ADMIN_GUIDE 6.6).

import type {Storefront} from '~/lib/hydrogen/storefront';
import type {StoreMetaobjectsQuery} from 'storefrontapi.generated';
import {errorFields, logError} from '~/lib/logging/logger';
import {catalogCache} from '~/lib/shopify/cache';
import {parseStoreRecords, type StoreListResult} from '~/lib/stores/parse';

/** Up to 250 stores (one page of the Storefront API); the SOW catalog has far fewer. */
export const STORE_METAOBJECTS_QUERY = `#graphql
  query StoreMetaobjects($country: CountryCode, $language: LanguageCode)
  @inContext(country: $country, language: $language) {
    stores: metaobjects(type: "store", first: 250) {
      nodes {
        id
        handle
        fields {
          key
          value
          reference {
            ... on MediaImage {
              image {
                url
              }
            }
          }
        }
      }
    }
  }
` as const;

type StoreNode = StoreMetaobjectsQuery['stores']['nodes'][number];

/** One metaobject as the loose record `parseStoreRecord` accepts. The photo reference becomes its https URL. */
export function storeNodeToRecord(node: StoreNode): Record<string, unknown> {
  const record: Record<string, unknown> = {id: node.id, handle: node.handle};
  for (const field of node.fields) {
    const reference = field.reference;
    if (reference && 'image' in reference && reference.image) {
      record[field.key] = reference.image.url;
    } else if (field.value !== null && field.value !== undefined) {
      record[field.key] = field.value;
    }
  }
  return record;
}

export function mapStoreNodes(nodes: readonly StoreNode[]): StoreListResult {
  return parseStoreRecords(nodes.map(storeNodeToRecord));
}

/** The published stores, or null when there are none or the read failed (the caller then keeps its fallback). */
export async function loadShopifyStores(
  storefront: Storefront,
): Promise<StoreListResult | null> {
  try {
    const {stores} = await storefront.query(STORE_METAOBJECTS_QUERY, {
      cache: catalogCache(storefront),
    });
    const result = mapStoreNodes(stores.nodes);
    return result.stores.length > 0 ? result : null;
  } catch (error: unknown) {
    // Class name only (T-05): the message can echo what was asked for.
    logError('stores.shopify_read_failed', errorFields(error));
    return null;
  }
}
