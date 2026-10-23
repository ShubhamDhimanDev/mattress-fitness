// What a product list tells analytics: which list it is, the select_item attributes of each card and the
// view_item_list event for the products on screen (P7-01, REQ-ANL-001). Pure and framework-free.
//
// Everything is read from the card data the page already holds (`ProductCardView`): no extra fetch and nothing
// personal. Prices go through the analytics module's own helpers, so they are integer cents from Shopify's decimal
// strings (`toCents`) and a card without a buyable price (every variant sold out) is left out rather than guessed.

import type {AnalyticsEvent, AnalyticsItem} from '~/lib/analytics';
import {
  centsFrom,
  itemFromProductPayload,
  mapCollectionViewed,
  productIdFrom,
  selectItemAttributes,
} from '~/lib/analytics/hydrogen-events';
import type {ProductCardView} from '~/lib/shopify/types';

/** The most items one event carries; longer lists are sent as several events of consecutive positions. */
const ITEMS_PER_EVENT = 50;

/** Same shape the select_item mapper accepts for a list id; anything else is dropped there too. */
const LIST_ID = /^[a-z0-9][a-z0-9-]{0,99}$/;

function validListId(value: string): string | undefined {
  return LIST_ID.test(value) ? value : undefined;
}

/**
 * The list id for a listing page, from its path: the collection handle (the same id Hydrogen's collection view
 * uses), `all` for the all-products page, `search`, and `brand-<handle>` for a brand page. Undefined elsewhere or
 * when the handle would not pass as an id, so the events still go out, just without a list.
 */
export function listIdForPath(pathname: string): string | undefined {
  if (pathname === '/search') return 'search';
  const [, section, handle, ...rest] = pathname.split('/');
  if (!handle || rest.length > 0) return undefined;
  if (section === 'collections') return validListId(handle);
  if (section === 'brands') return validListId(`brand-${handle}`);
  return undefined;
}

/**
 * Hydrogen's collection view already sends a `view_item_list` for `/collections/<handle>` (with no items, because
 * its payload has no products). Sending ours as well would count the list twice, so the listing stays silent
 * there until that mapper stops sending one. Read from the mapper itself, so the day it is dropped this switches
 * on without a second edit.
 */
const COLLECTION_PAGE_SENDS_EMPTY_LIST =
  mapCollectionViewed({collection: {handle: 'sample'}}) !== null;

export function listingReportsItems(pathname: string): boolean {
  const isCollectionPage =
    /^\/collections\/[^/]+\/?$/.test(pathname) &&
    pathname !== '/collections/all';
  return !(isCollectionPage && COLLECTION_PAGE_SENDS_EMPTY_LIST);
}

/**
 * Attributes for a card's product link, so a click is reported as select_item. Empty when the product has no
 * usable id or price (the mapper would drop the event anyway).
 */
export function cardSelectItemAttributes(
  product: ProductCardView,
  list: {readonly listId?: string; readonly position: number},
): Record<string, string> {
  const priceCents = centsFrom(product.price);
  const productId = productIdFrom(product.id);
  if (productId === null || priceCents === null) return {};
  return selectItemAttributes({
    productId,
    name: product.title,
    priceCents,
    ...(product.vendor ? {brand: product.vendor} : {}),
    ...(list.listId ? {listId: list.listId} : {}),
    index: list.position,
  });
}

function itemFor(
  product: ProductCardView,
  position: number,
): AnalyticsItem | null {
  const item = itemFromProductPayload({
    id: product.id,
    title: product.title,
    vendor: product.vendor,
    price: product.price,
  });
  return item === null ? null : {...item, index: position};
}

/**
 * The view_item_list events for products shown from `firstPosition` onward (zero-based position in the whole
 * list, so "Load more" continues the numbering). Cards without a usable price are skipped but still take their
 * position. No event when nothing remains.
 */
export function buildItemListEvents(
  products: readonly ProductCardView[],
  listId: string | undefined,
  firstPosition: number,
): AnalyticsEvent[] {
  const items = products.flatMap((product, offset) => {
    const item = itemFor(product, firstPosition + offset);
    return item === null ? [] : [item];
  });
  const events: AnalyticsEvent[] = [];
  for (let start = 0; start < items.length; start += ITEMS_PER_EVENT) {
    events.push({
      name: 'view_item_list',
      params: {},
      ecommerce: {
        items: items.slice(start, start + ITEMS_PER_EVENT),
        ...(listId ? {listId, listName: listId} : {}),
      },
    });
  }
  return events;
}
