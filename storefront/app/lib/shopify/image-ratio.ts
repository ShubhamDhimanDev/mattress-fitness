// The shape of the box a product photo sits in (owner request 2026-11-12: photos were cut off in a fixed 1:1 box). Pure.
//
// The box follows the photograph's own proportions, kept between a tall and a wide limit so one odd file cannot make a card
// very tall or very flat; inside it the photo is drawn whole (`object-contain`). A photo outside the limits shows a little
// empty space at its sides or top and bottom instead of being cut. With no known size the box is square, as before.

export const MIN_BOX_RATIO = 0.75;
export const MAX_BOX_RATIO = 1.5;

export function boxRatio(
  image:
    | {readonly width?: number | null; readonly height?: number | null}
    | null
    | undefined,
): number {
  const width = image?.width;
  const height = image?.height;
  if (
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return 1;
  }
  return Math.min(MAX_BOX_RATIO, Math.max(MIN_BOX_RATIO, width / height));
}
