// Builds the view_item_list events for the products a listing shows (P7-01, REQ-ANL-001). Loaded only through
// `import()` from `ProductListing`'s reporting effect, so it is never part of a route's initial JavaScript
// (bundle budget, scripts/perf). Pure and framework-free. Do not import it statically from page code.

import {track, type AnalyticsEvent, type AnalyticsItem} from '~/lib/analytics';
import {itemFromProductPayload} from '~/lib/analytics/item-basics';
import type {ProductCardView} from '~/lib/shopify/types';

/** The most items one event carries; longer lists are sent as several events of consecutive positions. */
const ITEMS_PER_EVENT = 50;

/** The id shape the select_item mapper accepts for a list; a path that does not match is sent without a list. */
const LIST_ID = /^[a-z0-9][a-z0-9-]{0,99}$/;

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

/** What has been reported for the list on screen: which list view it is (filters, sort, path) and how many products. */
export type ReportedList = {key: string; count: number};

/**
 * Sends view_item_list for the products of `visible` not yet reported, and records them in `holder`. A new `key`
 * (another filter, sort or path) starts a new list view; "Load more" reports only the products it adds, numbered on.
 * `holder` is the component's ref, empty at first. Because the record is read and written here, in one synchronous
 * step, a repeated call for the same products (React's double effect in development, or a re-render) sends nothing. `track()` never throws.
 */
export function reportListing(
  holder: {current: ReportedList | null},
  key: string,
  visible: readonly ProductCardView[],
  listId: string | undefined,
): void {
  if (holder.current?.key !== key) holder.current = {key, count: 0};
  const reported = holder.current;
  if (visible.length <= reported.count) return;
  const first = reported.count;
  reported.count = visible.length;
  const list =
    listId !== undefined && LIST_ID.test(listId) ? listId : undefined;
  for (const event of buildItemListEvents(visible.slice(first), list, first)) {
    track(event);
  }
}
