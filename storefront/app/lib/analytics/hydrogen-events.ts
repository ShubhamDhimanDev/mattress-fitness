// Turns the payloads Hydrogen publishes (and two click contexts) into our provider-neutral events (P7-01,
// REQ-ANL-001). Pure functions over `unknown` input: a payload is data from the page, so each field is read by
// name, checked and capped, and nothing is spread. That matters for the cart, whose Hydrogen object also holds the
// buyer's email, name and phone (T-05): none of those fields is ever read here.
//
// The reading helpers, the item builders and the select_item attributes live in `item-basics.ts` (small, imported
// by product cards); this module holds the event mappers, which reach the browser only inside the consent chunk.
// Money: see `item-basics.ts`. A line or event with an unusable price is dropped, never guessed.

import type {AnalyticsEvent, AnalyticsItem} from '~/lib/analytics';
import {
  buildItem,
  centsFrom,
  get,
  itemFromProductPayload,
  quantityOf,
  text,
} from '~/lib/analytics/item-basics';
import {
  sanitizePageLocation,
  sanitizeSearchTerm,
} from '~/lib/analytics/privacy';

// Re-exported so existing imports and tests keep one place to look.
export {
  ANALYTICS_CURRENCY,
  SELECT_ITEM_ATTRIBUTE,
  centsFrom,
  itemFromProductPayload,
  mapCollectionViewed,
  productIdFrom,
  selectItemValue,
  type SelectItemInput,
} from '~/lib/analytics/item-basics';

const MAX_ITEMS = 50;
const HANDLE = /^[a-z0-9][a-z0-9-]{0,99}$/;

function list(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

/** An item from a cart line, for `quantity` units (default: the line's own quantity). */
export function itemFromCartLine(
  line: unknown,
  quantity?: number,
): AnalyticsItem | null {
  const unit =
    centsFrom(get(line, 'cost', 'amountPerQuantity')) ??
    centsFrom(get(line, 'merchandise', 'price'));
  return buildItem({
    id: get(line, 'merchandise', 'product', 'id'),
    name: get(line, 'merchandise', 'product', 'title'),
    brand: get(line, 'merchandise', 'product', 'vendor'),
    variant: get(line, 'merchandise', 'title'),
    priceCents: unit,
    quantity: quantity ?? quantityOf(get(line, 'quantity'), 1),
  });
}

function valueOf(items: readonly AnalyticsItem[]): number {
  return items.reduce((sum, item) => sum + item.priceCents * item.quantity, 0);
}

// --- events --------------------------------------------------------------------------------------------------

export function mapPageViewed(payload: unknown): AnalyticsEvent | null {
  const location = sanitizePageLocation(get(payload, 'url'));
  return location === null
    ? null
    : {name: 'page_view', params: {page_location: location}};
}

export function mapProductViewed(payload: unknown): AnalyticsEvent | null {
  const items = list(get(payload, 'products'))
    .slice(0, MAX_ITEMS)
    .map(itemFromProductPayload)
    .filter((item): item is AnalyticsItem => item !== null);
  if (items.length === 0) return null;
  return {
    name: 'view_item',
    params: {},
    ecommerce: {items, valueCents: valueOf(items)},
  };
}

export function mapSearchViewed(payload: unknown): AnalyticsEvent | null {
  const term = sanitizeSearchTerm(get(payload, 'searchTerm'));
  return term === null ? null : {name: 'search', params: {search_term: term}};
}

/**
 * add_to_cart or remove_from_cart from Hydrogen's cart-line payload. The event carries the units that changed,
 * not the line total: a line going from 1 to 3 is an add of 2.
 */
export function mapCartLineChange(
  kind: 'add' | 'remove',
  payload: unknown,
): AnalyticsEvent | null {
  const previous = get(payload, 'prevLine');
  const current = get(payload, 'currentLine');
  const before = quantityOf(get(previous, 'quantity'), 0);
  const after = quantityOf(get(current, 'quantity'), 0);
  const delta = kind === 'add' ? after - before : before - after;
  if (delta < 1) return null;
  const item = itemFromCartLine(kind === 'add' ? current : previous, delta);
  if (item === null) return null;
  return {
    name: kind === 'add' ? 'add_to_cart' : 'remove_from_cart',
    params: {},
    ecommerce: {items: [item], valueCents: valueOf([item])},
  };
}

function cartLines(cart: unknown): readonly unknown[] {
  const nodes = list(get(cart, 'lines', 'nodes'));
  if (nodes.length > 0) return nodes;
  return list(get(cart, 'lines', 'edges')).map((edge) => get(edge, 'node'));
}

/**
 * begin_checkout from the cart as the page holds it. The value is the sum of the line totals Shopify reports
 * (after line discounts, before tax and shipping); where a line has none, price times quantity stands in.
 */
export function mapBeginCheckout(cart: unknown): AnalyticsEvent | null {
  return cartEvent('begin_checkout', cart);
}

/** view_cart from Hydrogen's cart_viewed payload (`payload.cart`). */
export function mapCartViewed(payload: unknown): AnalyticsEvent | null {
  return cartEvent('view_cart', get(payload, 'cart'));
}

function cartEvent(
  name: 'begin_checkout' | 'view_cart',
  cart: unknown,
): AnalyticsEvent | null {
  const lines = cartLines(cart).slice(0, MAX_ITEMS);
  const items: AnalyticsItem[] = [];
  let valueCents = 0;
  for (const line of lines) {
    const item = itemFromCartLine(line);
    if (item === null) continue;
    items.push(item);
    valueCents +=
      centsFrom(get(line, 'cost', 'totalAmount')) ?? valueOf([item]);
  }
  if (items.length === 0) return null;
  return {name, params: {}, ecommerce: {items, valueCents}};
}

// --- select_item ---------------------------------------------------------------------------------------------

/**
 * Reads a card's `data-si` value (`gid|price cents|position|list id`) and the link's text (the title) into a
 * select_item event. Anything required that is wrong (a malformed id, a price that is not whole cents, no title, a
 * value with more or fewer parts) gives null; a bad position or list id is left out and the item is kept.
 */
export function mapSelectItem(
  value: string | null,
  label: string | null,
): AnalyticsEvent | null {
  if (value === null || value.length > 300) return null;
  const parts = value.split('|');
  if (parts.length !== 4) return null;
  const [gid, price, position, list] = parts;
  const priceCents =
    price !== undefined && /^\d{1,9}$/.test(price) ? Number(price) : null;
  const index =
    position !== undefined && /^\d{1,4}$/.test(position)
      ? Number(position)
      : undefined;
  const item = buildItem({
    id: gid,
    name: label?.replace(/\s+/g, ' '),
    brand: undefined,
    variant: undefined,
    priceCents,
    quantity: 1,
  });
  if (item === null) return null;
  const listId = list !== undefined && HANDLE.test(list) ? list : undefined;
  return {
    name: 'select_item',
    params: {},
    ecommerce: {
      items: [index === undefined ? item : {...item, index}],
      ...(listId ? {listId, listName: listId} : {}),
    },
  };
}
