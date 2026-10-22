/**
 * The heavy uppercase display type is for short labels (BRAND_APPLICATION_SPEC 2.7). Headings written in Shopify
 * admin can be any length, and a long line in capitals is hard to read, so past this many characters a heading
 * keeps the weight but goes back to sentence case with no tracking.
 */
export const DISPLAY_TYPE_MAX_LENGTH = 40;

export function fitsDisplayType(text: string): boolean {
  return text.trim().length <= DISPLAY_TYPE_MAX_LENGTH;
}

/** Class names for a heading: the display utility when the text is short, plain heavy type when it is not. */
export function displayHeadingClass(text: string): string {
  return fitsDisplayType(text) ? 'type-display' : 'font-extrabold';
}
