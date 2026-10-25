// Store pickup on the product page (REQ-PDP-003, REQ-PDP-004). Pure: the Storefront API answer for one variant
// (`ProductVariant.storeAvailability`, one entry per pickup location) and the shopper's store go in, one of a few
// states comes out. The server builds the answer; the browser only shows it and never sends or computes stock.
//
// Mapping a store to a Shopify location (ASSUMPTION(V-05), see SHOPIFY_DATA_MODEL): the Storefront API's `Location`
// has only `id` and `name`, so the store's `location_handle` is matched against the location's name (ignoring case,
// spaces and hyphens) or against the numeric part of its id. Nothing else is guessed.

import {toSlug} from '~/lib/catalog/attributes';
import {cleanText} from '~/lib/catalog/text';
import {STORE_LOCATOR_PATH} from '~/lib/navigation';
import type {Store} from '~/lib/stores/types';

/** One location's answer for the selected variant, reduced to what the page uses. */
export type PickupLocation = {
  /** The location's global id, `gid://shopify/Location/123`. */
  readonly id: string;
  readonly name: string;
  readonly available: boolean;
  /** Shopify's own estimate text, for example "Usually ready in 24 hours"; empty when none. */
  readonly pickUpTime: string;
};

export type PickupAnswer =
  /** No (valid) store chosen: the page asks the shopper to choose one. */
  | {readonly status: 'choose_store'}
  /** The chosen store does not offer pickup, or has no Shopify location mapped. */
  | {readonly status: 'not_offered'; readonly storeName: string}
  | {
      readonly status: 'ready';
      readonly storeName: string;
      readonly pickUpTime: string | null;
    }
  | {readonly status: 'unavailable'; readonly storeName: string};

const MAX_PICKUP_TIME_LENGTH = 80;

/** The `123` of `gid://shopify/Location/123`; null for anything else. */
function numericLocationId(id: string): string | null {
  const match = /^gid:\/\/shopify\/Location\/(\d{1,20})$/.exec(id);
  return match?.[1] ?? null;
}

/** True when the store's `location_handle` names this Shopify location. */
export function locationMatches(
  locationHandle: string,
  location: Pick<PickupLocation, 'id' | 'name'>,
): boolean {
  const wanted = locationHandle.trim();
  if (wanted === '') return false;
  if (/^\d{1,20}$/.test(wanted))
    return numericLocationId(location.id) === wanted;
  return toSlug(wanted) !== '' && toSlug(wanted) === toSlug(location.name);
}

function cleanPickupTime(value: string): string | null {
  const text = cleanText(value).replace(/[<>]/g, '').trim();
  return text === '' ? null : text.slice(0, MAX_PICKUP_TIME_LENGTH);
}

/**
 * The state to show for `store`. A store without pickup or without a mapped location is `not_offered`; a mapped
 * location that is absent from Shopify's answer, or present but not available, is `unavailable`: the shopper's
 * next step is the same (choose another store or have it delivered).
 */
export function pickupAnswerFor(
  store: Pick<Store, 'name' | 'pickupEnabled' | 'locationHandle'> | null,
  locations: readonly PickupLocation[],
): PickupAnswer {
  if (store === null) return {status: 'choose_store'};
  const handle = store.locationHandle;
  if (!store.pickupEnabled || handle === null) {
    return {status: 'not_offered', storeName: store.name};
  }
  const location = locations.find((candidate) =>
    locationMatches(handle, candidate),
  );
  if (!location || !location.available) {
    return {status: 'unavailable', storeName: store.name};
  }
  return {
    status: 'ready',
    storeName: store.name,
    pickUpTime: cleanPickupTime(location.pickUpTime),
  };
}

function textOf(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= max
    ? value
    : null;
}

/** The browser's check of the route's JSON: anything unexpected is null, which the page treats as "hide". */
export function readPickupAnswer(value: unknown): PickupAnswer | null {
  if (typeof value !== 'object' || value === null || !('status' in value)) {
    return null;
  }
  if (value.status === 'choose_store') return {status: 'choose_store'};
  const storeName = 'storeName' in value ? textOf(value.storeName, 200) : null;
  if (storeName === null) return null;
  switch (value.status) {
    case 'not_offered':
      return {status: 'not_offered', storeName};
    case 'unavailable':
      return {status: 'unavailable', storeName};
    case 'ready': {
      const time =
        'pickUpTime' in value
          ? textOf(value.pickUpTime, MAX_PICKUP_TIME_LENGTH)
          : null;
      return {status: 'ready', storeName, pickUpTime: time};
    }
    default:
      return null;
  }
}

/** `gid://shopify/ProductVariant/123`, the only variant id shape the pickup route accepts. */
export function isVariantGid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^gid:\/\/shopify\/ProductVariant\/\d{1,20}$/.test(value)
  );
}

/** The `product` parameter of a store page as a product path, or null when it is not a plausible handle. */
export function productPathFromParam(value: string | null): string | null {
  return value !== null && /^[a-z0-9][a-z0-9_-]{0,254}$/.test(value)
    ? `/products/${encodeURIComponent(value)}`
    : null;
}

/**
 * Where "Try in store" goes (REQ-PDP-004): the shopper's store page, or the locator when none is set. The product
 * handle rides along as `product` so the store page can offer a way back; it is validated there before use.
 * No booking or appointment is implied.
 */
export function tryInStorePath(
  storePagePath: string | null,
  productHandle: string,
): string {
  const base = storePagePath ?? STORE_LOCATOR_PATH;
  return `${base}?product=${encodeURIComponent(productHandle)}`;
}
