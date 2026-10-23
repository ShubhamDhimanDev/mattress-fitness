// Turns the payloads Hydrogen publishes (and two click contexts) into our provider-neutral events (P7-01,
// REQ-ANL-001). Pure functions over `unknown` input: a payload is data from the page, so each field is read by
// name, checked and capped, and nothing is spread. That matters for the cart, whose Hydrogen object also holds the
// buyer's email, name and phone (T-05): none of those fields is ever read here.
//
// Money: Shopify amounts are decimal strings. They are converted to integer cents once, with the shared helper
// (`~/lib/format`), and only USD is accepted (NFR-008). A line or event with an unusable price is dropped, never
// guessed.

import type {AnalyticsEvent, AnalyticsItem} from '~/lib/analytics';
import {toCents} from '~/lib/format';
import {
  sanitizePageLocation,
  sanitizeSearchTerm,
} from '~/lib/analytics/privacy';

export const ANALYTICS_CURRENCY = 'USD';

const MAX_ITEMS = 50;
const MAX_QUANTITY = 99;
const MAX_NAME_LENGTH = 100;
const PRODUCT_GID = /^gid:\/\/shopify\/Product\/(\d{1,20})$/;
const PLAIN_ID = /^\d{1,20}$/;
const HANDLE = /^[a-z0-9][a-z0-9-]{0,99}$/;

// --- reading untrusted input ---------------------------------------------------------------------------------

function get(value: unknown, ...path: readonly string[]): unknown {
  let current = value;
  for (const key of path) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = Reflect.get(current, key);
  }
  return current;
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().slice(0, MAX_NAME_LENGTH);
  return trimmed === '' ? undefined : trimmed;
}

function list(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function quantityOf(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(MAX_QUANTITY, Math.max(0, Math.floor(value)));
}

/** "gid://shopify/Product/123" or "123" gives "123"; anything else is not an id we send. */
export function productIdFrom(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const gid = PRODUCT_GID.exec(value);
  if (gid?.[1]) return gid[1];
  return PLAIN_ID.test(value) ? value : null;
}

/**
 * A price as integer cents. Accepts a MoneyV2 object (`{amount, currencyCode}`) or a bare amount string, which is
 * read as USD because the store sells in dollars only. A different currency, a negative or malformed amount, or
 * anything that is not a string gives null.
 */
export function centsFrom(value: unknown): number | null {
  const amount = typeof value === 'string' ? value : get(value, 'amount');
  const currency =
    typeof value === 'string' ? undefined : get(value, 'currencyCode');
  if (typeof amount !== 'string') return null;
  if (currency !== undefined && currency !== ANALYTICS_CURRENCY) return null;
  try {
    return toCents(amount);
  } catch {
    return null;
  }
}

// --- items ---------------------------------------------------------------------------------------------------

function variantLabel(value: unknown): string | undefined {
  const title = text(value);
  // Shopify's name for a product with no options; not a useful variant.
  return title === undefined || title === 'Default Title' ? undefined : title;
}

function buildItem(fields: {
  readonly id: unknown;
  readonly name: unknown;
  readonly brand: unknown;
  readonly variant: unknown;
  readonly priceCents: number | null;
  readonly quantity: number;
}): AnalyticsItem | null {
  const id = productIdFrom(fields.id);
  const name = text(fields.name);
  if (id === null || name === undefined || fields.priceCents === null) {
    return null;
  }
  if (fields.quantity < 1) return null;
  const brand = text(fields.brand);
  const variant = variantLabel(fields.variant);
  return {
    id,
    name,
    ...(brand ? {brand} : {}),
    ...(variant ? {variant} : {}),
    priceCents: fields.priceCents,
    quantity: fields.quantity,
  };
}

/** An item from the `products[]` entries of Analytics.ProductView. */
export function itemFromProductPayload(product: unknown): AnalyticsItem | null {
  return buildItem({
    id: get(product, 'id'),
    name: get(product, 'title'),
    brand: get(product, 'vendor'),
    variant: get(product, 'variantTitle'),
    priceCents: centsFrom(get(product, 'price')),
    quantity: quantityOf(get(product, 'quantity'), 1),
  });
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

/**
 * view_item_list from the collection view. Hydrogen's payload carries the collection's id and handle but not the
 * products shown, so `items` is empty: the event says which list was viewed, not which products it held.
 */
export function mapCollectionViewed(payload: unknown): AnalyticsEvent | null {
  const handle = get(payload, 'collection', 'handle');
  if (typeof handle !== 'string' || !HANDLE.test(handle)) return null;
  return {
    name: 'view_item_list',
    params: {},
    ecommerce: {items: [], listId: handle, listName: handle},
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

/** The data attributes a product link carries so a click can be reported without the page knowing analytics. */
export const SELECT_ITEM_ATTRIBUTE = 'data-analytics-select-item';

export type SelectItemInput = {
  readonly productId: string;
  readonly name: string;
  readonly priceCents: number;
  readonly brand?: string;
  readonly listId?: string;
  /** Zero-based position in the list. */
  readonly index?: number;
};

/**
 * Attributes for the element wrapping a product link in a list. Spread them onto the link or its card:
 * `<a {...selectItemAttributes(input)}>`. The click listener reads them back through `parseSelectItemAttributes`.
 */
export function selectItemAttributes(
  input: SelectItemInput,
): Record<string, string> {
  return {
    [SELECT_ITEM_ATTRIBUTE]: '',
    'data-analytics-id': input.productId,
    'data-analytics-name': input.name,
    'data-analytics-price-cents': String(input.priceCents),
    ...(input.brand ? {'data-analytics-brand': input.brand} : {}),
    ...(input.listId ? {'data-analytics-list': input.listId} : {}),
    ...(input.index === undefined
      ? {}
      : {'data-analytics-index': String(input.index)}),
  };
}

/** Reads attribute values (as strings, from the DOM) into a select_item event; null when anything required is wrong. */
export function mapSelectItem(
  read: (name: string) => string | null,
): AnalyticsEvent | null {
  const price = read('data-analytics-price-cents');
  const priceCents =
    price !== null && /^\d{1,9}$/.test(price) ? Number(price) : null;
  const listText = text(read('data-analytics-list'));
  const indexText = read('data-analytics-index');
  const index =
    indexText !== null && /^\d{1,4}$/.test(indexText)
      ? Number(indexText)
      : undefined;
  const item = buildItem({
    id: read('data-analytics-id'),
    name: read('data-analytics-name'),
    brand: read('data-analytics-brand'),
    variant: undefined,
    priceCents,
    quantity: 1,
  });
  if (item === null) return null;
  const listId =
    listText !== undefined && HANDLE.test(listText) ? listText : undefined;
  return {
    name: 'select_item',
    params: {},
    ecommerce: {
      items: [index === undefined ? item : {...item, index}],
      ...(listId ? {listId, listName: listId} : {}),
    },
  };
}
