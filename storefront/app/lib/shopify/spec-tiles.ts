import type {ProductPageView} from '~/lib/shopify/types';

export type SpecRow = {readonly label: string; readonly value: string};

/**
 * Splits a product's facts into the four headline tiles (comfort level, sleep positions, height, type) and the
 * remaining rows for the specifications table (REQ-PDP-002, BA-08). A fact the catalog does not carry produces no
 * tile and no row, so a product with sparse metafields shows only what exists; nothing is invented.
 */
export function splitSpecifications(
  product: Pick<
    ProductPageView,
    | 'comfortLevel'
    | 'mattressType'
    | 'sleepPositions'
    | 'benefits'
    | 'productLine'
    | 'heightInches'
    | 'specifications'
  >,
): {tiles: readonly SpecRow[]; rows: readonly SpecRow[]} {
  const present = (
    entries: readonly (readonly [string, string | null])[],
  ): SpecRow[] =>
    entries.flatMap(([label, value]) => (value ? [{label, value}] : []));

  const tiles = present([
    ['Comfort level', product.comfortLevel],
    ['Sleep positions', product.sleepPositions.join(', ') || null],
    [
      'Height',
      product.heightInches === null ? null : `${product.heightInches} in`,
    ],
    ['Mattress type', product.mattressType],
  ]);
  const rows = [
    ...present([
      ['Benefits', product.benefits.join(', ') || null],
      ['Product line', product.productLine],
    ]),
    ...product.specifications,
  ];
  return {tiles, rows};
}
