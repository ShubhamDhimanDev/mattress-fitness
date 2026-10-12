// Variant, price and sale rules that every surface shares so they cannot drift
// (collection cards, the comparison table, quiz results). All inputs come from
// Shopify data; nothing here reads a price from the browser.

import type {Size} from '~/lib/catalog/attributes';
import {sizeIndex} from '~/lib/catalog/attributes';
import type {CatalogProduct, SizeVariant} from '~/lib/catalog/types';

export function variantForSize(
  product: CatalogProduct,
  size: Size,
): SizeVariant | null {
  return product.variants.find((variant) => variant.size === size) ?? null;
}

export function availableVariants(
  product: CatalogProduct,
): readonly SizeVariant[] {
  return product.variants.filter((variant) => variant.available);
}

export function isSoldOut(product: CatalogProduct): boolean {
  return availableVariants(product).length === 0;
}

/** "From $": the lowest price among variants a shopper can actually buy. */
export function lowestAvailablePriceCents(
  product: CatalogProduct,
): number | null {
  const prices = availableVariants(product).map((v) => v.priceCents);
  return prices.length === 0 ? null : Math.min(...prices);
}

/** A sale badge needs compare-at strictly greater than price. */
export function isOnSale(variant: SizeVariant): boolean {
  return (
    variant.compareAtCents !== null &&
    variant.compareAtCents > variant.priceCents
  );
}

export function savingsCents(variant: SizeVariant): number {
  return variant.compareAtCents !== null && isOnSale(variant)
    ? variant.compareAtCents - variant.priceCents
    : 0;
}

/** Sizes in the standard order (Twin first), whatever order Shopify returned. */
export function sizesInOrder(product: CatalogProduct): readonly Size[] {
  return product.variants
    .map((variant) => variant.size)
    .sort((a, b) => sizeIndex(a) - sizeIndex(b));
}
