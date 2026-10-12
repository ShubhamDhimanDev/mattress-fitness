// Helpers that build size variants with realistic price spreads. Used by the
// fixtures and by tests; nothing in production code calls them (Shopify is the
// source of prices there).

import type {Size} from '~/lib/catalog/attributes';
import {SIZES, toSlug} from '~/lib/catalog/attributes';
import type {SizeVariant} from '~/lib/catalog/types';

export const SIZE_DIMENSIONS: Readonly<Record<Size, string>> = {
  Twin: '38" x 75"',
  'Twin XL': '38" x 80"',
  Full: '54" x 75"',
  Queen: '60" x 80"',
  King: '76" x 80"',
  'California King': '72" x 84"',
  'Split California King': '2 pieces, each 36" x 84"',
};

// Share of the queen price, in percent. Split California King is two pieces.
const SIZE_PRICE_PERCENT: Readonly<Record<Size, number>> = {
  Twin: 62,
  'Twin XL': 68,
  Full: 80,
  Queen: 100,
  King: 124,
  'California King': 124,
  'Split California King': 150,
};

/** Retail-style whole-dollar price ending in 9, for example 1299. */
function endInNine(dollars: number): number {
  return Math.max(9, Math.round(dollars / 10) * 10 - 1);
}

/** Regular price in whole dollars for a size, derived from the queen price. */
function regularDollars(queenDollars: number, size: Size): number {
  return endInNine((queenDollars * SIZE_PRICE_PERCENT[size]) / 100);
}

export type VariantPlan = {
  /** Sizes offered; defaults to all seven. */
  readonly sizes?: readonly Size[];
  /** Sizes that exist but cannot be bought right now. */
  readonly soldOutSizes?: readonly Size[];
  /** Percent off; the regular price becomes the compare-at price. */
  readonly saleOffPercent?: number;
};

export function buildVariants(
  handle: string,
  queenDollars: number,
  plan: VariantPlan = {},
): SizeVariant[] {
  const offered = plan.sizes ?? SIZES;
  const soldOut = plan.soldOutSizes ?? [];
  return SIZES.filter((size) => offered.includes(size)).map((size) => {
    const regular = regularDollars(queenDollars, size);
    const sale =
      plan.saleOffPercent === undefined
        ? null
        : endInNine((regular * (100 - plan.saleOffPercent)) / 100);
    return {
      id: `fixture-variant:${handle}:${toSlug(size)}`,
      size,
      sku: `${handle}-${toSlug(size)}`.toUpperCase(),
      dimensions: SIZE_DIMENSIONS[size],
      priceCents: (sale ?? regular) * 100,
      compareAtCents: sale === null ? null : regular * 100,
      available: !soldOut.includes(size),
    };
  });
}
