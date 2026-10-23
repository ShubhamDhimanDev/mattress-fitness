// The product page's add-on slot (P4-03, REQ-ADD-001): what the server answers and what the page does with it. Pure and
// safe to import in the browser; the server read is product-addons-server.ts.
//
// The slot offers the foundation category only (foundations, adjustable bases and frames: the admin lists them under
// `matchingAddOns.foundations`). Protectors, pillows and bedding stay in the cart (REQ-CART-003). The answer holds every
// size of the page's mattress at once, so choosing another size swaps the offered variants without a request.

import {normalizeSize} from '~/lib/offers/helpers';
import type {AddOnCategory} from '~/lib/offers/types';
import type {OfferedVariant} from './view';

/** Categories the product page offers. */
export const PRODUCT_PAGE_CATEGORIES: readonly AddOnCategory[] = ['foundation'];

const PRODUCT_GID = /^gid:\/\/shopify\/Product\/[1-9]\d{0,19}$/;

export function isProductGid(value: unknown): value is string {
  return typeof value === 'string' && PRODUCT_GID.test(value);
}

export type ProductAddOnItem = {
  readonly category: AddOnCategory;
  /** The mattress size the admin related this item to; null = every size. */
  readonly size: string | null;
  /** In stock, with the price as Shopify returned it (display only). */
  readonly variant: OfferedVariant;
};

export type ProductAddOnsAnswer = {
  readonly status: 'ok';
  readonly items: readonly ProductAddOnItem[];
};

/**
 * The items that fit the selected size, one per variant. Same comparison as the cart engine (`relationFitsSize`): a size
 * is compared once trimmed, lower-cased and with inner spaces collapsed, and an item with no size fits every size. A
 * mattress without a size option (null) is offered only the items that fit every size.
 */
export function itemsForSize(
  items: readonly ProductAddOnItem[],
  selectedSize: string | null,
): ProductAddOnItem[] {
  const wanted = normalizeSize(selectedSize);
  const seen = new Set<string>();
  return items.filter((item) => {
    const fits =
      item.size === null ||
      (wanted !== null && normalizeSize(item.size) === wanted);
    if (!fits || seen.has(item.variant.variantId)) return false;
    seen.add(item.variant.variantId);
    return true;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const VARIANT_GID = /^gid:\/\/shopify\/ProductVariant\/[1-9]\d{0,19}$/;

function readVariant(value: unknown): OfferedVariant | null {
  if (!isRecord(value)) return null;
  const {variantId, productTitle, productHandle, variantTitle, price} = value;
  if (
    typeof variantId !== 'string' ||
    !VARIANT_GID.test(variantId) ||
    typeof productTitle !== 'string' ||
    typeof productHandle !== 'string' ||
    !(variantTitle === null || typeof variantTitle === 'string') ||
    !isRecord(price) ||
    typeof price.amount !== 'string' ||
    typeof price.currencyCode !== 'string'
  ) {
    return null;
  }
  return {
    variantId,
    productTitle,
    productHandle,
    variantTitle,
    price: {amount: price.amount, currencyCode: price.currencyCode},
  };
}

/**
 * Documented narrowing helper: the response arrives as `unknown` JSON from our own route. An item that does not look
 * right is dropped (never half-shown); a body that is not an answer at all is `null`, which the page treats as an error.
 */
export function readProductAddOnsAnswer(
  body: unknown,
): ProductAddOnsAnswer | null {
  if (!isRecord(body) || body.status !== 'ok' || !Array.isArray(body.items)) {
    return null;
  }
  const items: ProductAddOnItem[] = [];
  for (const entry of body.items.slice(0, 100)) {
    if (!isRecord(entry) || entry.category !== 'foundation') continue;
    const variant = readVariant(entry.variant);
    const size = entry.size;
    if (variant === null || !(size === null || typeof size === 'string')) {
      continue;
    }
    items.push({category: 'foundation', size, variant});
  }
  return {status: 'ok', items};
}

// Dev-only test hook (see products.$handle.tsx): the e2e spec opts a page into the add-on slot with this cookie, because
// the dev server has no OFFER_CONFIG_JSON. A pure function so the multi-cookie header case is tested (as for Extend).
const DEV_ADDONS_COOKIE = /(?:^|;\s*)e2e_addons_expected=1(?:;|$)/;

export function hasDevAddOnsCookie(cookieHeader: string): boolean {
  return DEV_ADDONS_COOKIE.test(cookieHeader);
}
