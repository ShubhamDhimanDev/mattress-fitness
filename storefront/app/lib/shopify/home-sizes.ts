// The bed drawn on each "Shop by size" tile (CR-31): a rectangle whose proportions are the size's real width and length,
// so the tiles show how the sizes compare without any photo. Inches are the standard US mattress dimensions, the same
// numbers `SIZE_DIMENSIONS` holds for the catalog fixtures (a unit test keeps the two in step). Nothing here is a price or
// a claim about a product.

import type {Size} from '~/lib/catalog/attributes';

export type BedShape = {
  readonly widthInches: number;
  readonly lengthInches: number;
  /** The dimensions as text, for example `60 x 80 in`. */
  readonly dimensions: string;
  /** Pillows drawn at the head of the bed: one for a single bed, two for a bed two people share. */
  readonly pillows: 1 | 2;
};

/** Longest side of any listed size; the tile scales every bed by its length against this one. */
export const LONGEST_BED_INCHES = 84;

const SINGLE_BED_MAX_WIDTH_INCHES = 40;

function bed(
  widthInches: number,
  lengthInches: number,
  dimensions = `${widthInches} x ${lengthInches} in`,
): BedShape {
  return {
    widthInches,
    lengthInches,
    dimensions,
    pillows: widthInches <= SINGLE_BED_MAX_WIDTH_INCHES ? 1 : 2,
  };
}

export const BED_SHAPES: Readonly<Record<Size, BedShape>> = {
  Twin: bed(38, 75),
  'Twin XL': bed(38, 80),
  Full: bed(54, 75),
  Queen: bed(60, 80),
  King: bed(76, 80),
  'California King': bed(72, 84),
  // Two 36 x 84 halves side by side.
  'Split California King': bed(72, 84, '2 pieces, each 36 x 84 in'),
};

/** CSS for the drawn bed: its height as a share of the tile's drawing area, and its width through the aspect ratio. */
export function bedBoxStyle(shape: BedShape): {
  readonly height: string;
  readonly aspectRatio: string;
} {
  const share = Math.round((shape.lengthInches / LONGEST_BED_INCHES) * 100);
  return {
    height: `${share}%`,
    aspectRatio: `${shape.widthInches} / ${shape.lengthInches}`,
  };
}
