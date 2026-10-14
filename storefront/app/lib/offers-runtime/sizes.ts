// Size swaps on a cart line (REQ-CART-001). A product can have Size x Color variants, so "another size" means
// a variant whose OTHER options equal the line's own: swapping Twin/Sand to King must give King/Sand, never
// King/Slate. Pure functions over option lists; the server supplies the Shopify data.

import {SIZE_OPTION_NAME, toSlug} from '~/lib/catalog/attributes';
import type {SizeChoice} from './view';

export type OptionPair = {readonly name: string; readonly value: string};

export type VariantOptions = {
  readonly variantId: string;
  readonly available: boolean;
  readonly options: readonly OptionPair[];
};

const SIZE_KEY = toSlug(SIZE_OPTION_NAME);

function isSize(option: OptionPair): boolean {
  return toSlug(option.name) === SIZE_KEY;
}

export function sizeOf(options: readonly OptionPair[]): string | null {
  return options.find(isSize)?.value ?? null;
}

/** The non-size options as one comparable string, order-independent. */
export function otherOptionsKey(options: readonly OptionPair[]): string {
  return options
    .filter((option) => !isSize(option))
    .map(
      (option) => `${toSlug(option.name)}=${option.value.trim().toLowerCase()}`,
    )
    .sort()
    .join('|');
}

/**
 * The sizes a line can be swapped to: variants with the same other options and a size. Fewer than two
 * distinct sizes means there is nothing to choose, so the list is empty.
 */
export function swapChoicesFor(
  lineOptions: readonly OptionPair[],
  variants: readonly VariantOptions[],
): SizeChoice[] {
  if (sizeOf(lineOptions) === null) return [];
  const wanted = otherOptionsKey(lineOptions);
  const bySize = new Map<string, SizeChoice>();
  for (const variant of variants) {
    const size = sizeOf(variant.options);
    if (size === null || otherOptionsKey(variant.options) !== wanted) continue;
    if (!bySize.has(size)) {
      bySize.set(size, {
        variantId: variant.variantId,
        size,
        available: variant.available,
      });
    }
  }
  return bySize.size > 1 ? [...bySize.values()] : [];
}

/** True when the target differs from the line only in size. */
export function isSizeSwap(
  lineOptions: readonly OptionPair[],
  targetOptions: readonly OptionPair[],
): boolean {
  return (
    sizeOf(lineOptions) !== null &&
    sizeOf(targetOptions) !== null &&
    otherOptionsKey(lineOptions) === otherOptionsKey(targetOptions)
  );
}
