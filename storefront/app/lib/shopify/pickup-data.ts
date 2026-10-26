// Per-location pickup stock for one variant (P3B-10, REQ-PDP-003). Server side only.
//
// Verified against the Storefront API reference (2026-10): `ProductVariant.storeAvailability(first, after, before, last,
// near, reverse)` returns a `StoreAvailabilityConnection`; each `StoreAvailability` has `available`, `pickUpTime`,
// `quantityAvailable` and `location { id name address }` and needs the `unauthenticated_read_product_pickup_locations`
// scope. There is NO argument that filters by location id, so every pickup location is read (up to 250) and the
// store's own location is picked out in `pickupAnswerFor`. `quantityAvailable` is not requested: the page says
// "ready for pickup", never a count. ASSUMPTION(V-05): the scope is granted on the storefront token of the store.

import type {Storefront} from '~/lib/hydrogen/storefront';
import type {PickupAvailabilityQuery} from 'storefrontapi.generated';
import {availabilityCache} from '~/lib/shopify/cache';
import type {PickupLocation} from '~/lib/stores/pickup';

export const PICKUP_AVAILABILITY_QUERY = `#graphql
  query PickupAvailability(
    $variantId: ID!
    $country: CountryCode
    $language: LanguageCode
  ) @inContext(country: $country, language: $language) {
    node(id: $variantId) {
      ... on ProductVariant {
        id
        storeAvailability(first: 250) {
          nodes {
            available
            pickUpTime
            location {
              id
              name
            }
          }
        }
      }
    }
  }
` as const;

export type PickupRead =
  | {readonly status: 'ok'; readonly locations: readonly PickupLocation[]}
  /** The id is not a variant of this store. */
  | {readonly status: 'not_found'};

/** Reduces the connection to the fields the page uses. Anything but `available: true` counts as not available. */
export function mapPickupNodes(
  node: PickupAvailabilityQuery['node'],
): PickupRead {
  if (!node) return {status: 'not_found'};
  const locations: PickupLocation[] = node.storeAvailability.nodes.map(
    (entry) => ({
      id: entry.location.id,
      name: entry.location.name,
      available: entry.available === true,
      pickUpTime: entry.pickUpTime,
    }),
  );
  return {status: 'ok', locations};
}

/** Throws on a failed Shopify read; the caller decides how to fail soft. */
export async function loadPickupLocations(
  storefront: Storefront,
  variantId: string,
): Promise<PickupRead> {
  const {node} = await storefront.query(PICKUP_AVAILABILITY_QUERY, {
    variables: {variantId},
    // Availability: the same 60 s window as the price and stock on the product page (DEC-024). The key holds the
    // variant id only; no shopper data.
    cache: availabilityCache(storefront),
  });
  return mapPickupNodes(node);
}
