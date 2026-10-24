// The small, pure part of the analytics mapping that page code imports directly (P7-01): reading untrusted input,
// turning a product or cart line into an `AnalyticsItem`, and the attribute value a product card carries so a
// click can be reported as `select_item`.
//
// Why a module of its own: product cards and listings are in the initial JavaScript of every route, and the budget
// for it is tight (scripts/perf). Everything that maps Hydrogen events or looks at the page address lives in
// `hydrogen-events.ts` and `privacy.ts`, which reach the browser only inside the consent chunk, loaded after
// hydration and only when a provider id is set. Keep this file free of imports beyond `~/lib/format`.
//
// Money: Shopify amounts are decimal strings, converted to integer cents once with the shared helper
// (`~/lib/format`); only USD is accepted (NFR-008). An item with an unusable price is dropped, never guessed.

import type {AnalyticsEvent, AnalyticsItem} from '~/lib/analytics';
import {toCents} from '~/lib/format';

export const ANALYTICS_CURRENCY = 'USD';

const MAX_QUANTITY = 99;
const MAX_NAME_LENGTH = 100;
const PRODUCT_GID = /^gid:\/\/shopify\/Product\/(\d{1,20})$/;
const PLAIN_ID = /^\d{1,20}$/;

// --- reading untrusted input ---------------------------------------------------------------------------------

export function get(value: unknown, ...path: readonly string[]): unknown {
  let current = value;
  for (const key of path) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = Reflect.get(current, key);
  }
  return current;
}

export function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().slice(0, MAX_NAME_LENGTH);
  return trimmed === '' ? undefined : trimmed;
}

export function quantityOf(value: unknown, fallback: number): number {
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

export function buildItem(fields: {
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

/**
 * Hydrogen's collection view sends nothing. Its payload carries the collection's id and handle but not the products
 * shown, so the event it would produce is an empty `view_item_list`; the listing code (`~/lib/listing-analytics`,
 * `ProductListing`) sends the real one, with the products, for collection, all-products, brand and search pages,
 * and sending both would count the list twice. Kept as a function that always answers null so the bridge, the
 * listing code and the tests keep one place that says so.
 */
export function mapCollectionViewed(_payload: unknown): AnalyticsEvent | null {
  return null;
}

// --- select_item ---------------------------------------------------------------------------------------------

/**
 * The attribute a product link carries so a click can be reported without the page knowing analytics. Its value is
 * `gid|price in cents|zero-based position|list id` (the list id may be empty); the title is the link's own text.
 * Short on purpose: it is repeated on every card (bundle budget, scripts/perf).
 */
export const SELECT_ITEM_ATTRIBUTE = 'data-si';

export type SelectItemInput = {
  /** A Shopify product gid or its numeric id. */
  readonly productId: string;
  readonly priceCents: number;
  readonly listId?: string;
  /** Zero-based position in the list. */
  readonly index?: number;
};

/** The value of the attribute above. The card builds the same text itself (`~/lib/listing-analytics`); a test pins them. */
export function selectItemValue(input: SelectItemInput): string {
  return `${input.productId}|${input.priceCents}|${input.index ?? ''}|${input.listId ?? ''}`;
}
