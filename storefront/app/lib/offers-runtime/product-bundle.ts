// The product page's "Frequently bought together" card (P4-06, REQ-ADD-002): what the server answers and what the page does
// with it. Pure and safe to import in the browser; the server read is product-bundle-server.ts.
//
// The answer holds one set per size (the companions in that size, with Shopify's price and stock), so choosing another size
// swaps the set without a request. The saving is a Shopify AUTOMATIC discount: nothing here produces or sums a price, and a
// saving figure is read only from the cart result Shopify priced (`readBundleSavings`).

import {normalizeSize} from '~/lib/offers/helpers';
import {isCartActionResult} from '~/lib/cart/messages';
import type {OfferedVariant} from './view';

export type ProductBundleItem = {
  readonly quantity: number;
  /** In stock, with the price as Shopify returned it (display only). */
  readonly variant: OfferedVariant;
};

export type ProductBundleSet = {
  /** The size the companions are for; null = they do not depend on size. */
  readonly size: string | null;
  readonly items: readonly ProductBundleItem[];
};

export type ProductBundle = {
  readonly bundleId: string;
  readonly sets: readonly ProductBundleSet[];
};

export type ProductBundleAnswer = {
  readonly status: 'ok';
  /** null = show nothing (no rule, no complete set in stock). */
  readonly bundle: ProductBundle | null;
};

/**
 * The set for the selected size: an exact size match first, otherwise the size-independent set. A product without a size
 * option (null) is offered only the size-independent set. Same normalisation as the cart engine.
 */
export function setForSize(
  sets: readonly ProductBundleSet[],
  selectedSize: string | null,
): ProductBundleSet | null {
  const wanted = normalizeSize(selectedSize);
  const exact =
    wanted === null
      ? undefined
      : sets.find((set) => normalizeSize(set.size) === wanted);
  return exact ?? sets.find((set) => set.size === null) ?? null;
}

/** True when the cart holds this exact anchor variant and every companion of the set. */
export function setInCart(
  cartIds: ReadonlySet<string> | null,
  anchorVariantId: string,
  set: ProductBundleSet,
): boolean {
  return (
    cartIds !== null &&
    cartIds.has(anchorVariantId) &&
    set.items.every((item) => cartIds.has(item.variant.variantId))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const VARIANT_GID = /^gid:\/\/shopify\/ProductVariant\/[1-9]\d{0,19}$/;
const MAX_QUANTITY = 99;

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

function readSet(value: unknown): ProductBundleSet | null {
  if (!isRecord(value) || !Array.isArray(value.items)) return null;
  const size = value.size;
  if (!(size === null || typeof size === 'string')) return null;
  const items: ProductBundleItem[] = [];
  for (const entry of value.items.slice(0, 20)) {
    if (!isRecord(entry)) return null;
    const variant = readVariant(entry.variant);
    const quantity = entry.quantity;
    if (
      variant === null ||
      typeof quantity !== 'number' ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > MAX_QUANTITY
    ) {
      // A set with one unreadable member is dropped whole: a partial set would not earn the saving.
      return null;
    }
    items.push({quantity, variant});
  }
  return items.length === 0 ? null : {size, items};
}

/**
 * Documented narrowing helper: the response arrives as `unknown` JSON from our own route. A set that does not look right
 * is dropped (never half-shown); a body that is not an answer at all is `null`, which the page treats as an error.
 */
export function readProductBundleAnswer(
  body: unknown,
): ProductBundleAnswer | null {
  if (!isRecord(body) || body.status !== 'ok') return null;
  if (body.bundle === null) return {status: 'ok', bundle: null};
  if (
    !isRecord(body.bundle) ||
    typeof body.bundle.bundleId !== 'string' ||
    !Array.isArray(body.bundle.sets)
  ) {
    return null;
  }
  const sets: ProductBundleSet[] = [];
  for (const entry of body.bundle.sets.slice(0, 40)) {
    const set = readSet(entry);
    if (set !== null) sets.push(set);
  }
  return {
    status: 'ok',
    bundle: sets.length === 0 ? null : {bundleId: body.bundle.bundleId, sets},
  };
}

/**
 * The saving Shopify reported for a bundle in the answer to a cart action (the offers view the cart gate built from the
 * discount allocations on the cart lines). Null unless that bundle is complete in the cart AND Shopify reported a saving:
 * the card never shows a number of its own.
 */
export function readBundleSavings(
  data: unknown,
  bundleId: string,
): {readonly amount: string; readonly currencyCode: string} | null {
  if (!isCartActionResult(data) || !isRecord(data.offers)) return null;
  const bundles = data.offers.bundles;
  if (!Array.isArray(bundles)) return null;
  for (const entry of bundles) {
    if (
      !isRecord(entry) ||
      entry.bundleId !== bundleId ||
      entry.status !== 'complete' ||
      !isRecord(entry.savings)
    ) {
      continue;
    }
    const {amount, currencyCode} = entry.savings;
    if (typeof amount === 'string' && typeof currencyCode === 'string') {
      return {amount, currencyCode};
    }
  }
  return null;
}
