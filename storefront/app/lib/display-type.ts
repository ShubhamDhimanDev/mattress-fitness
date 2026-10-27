/**
 * Since the CR-31 redesign `type-display` is sentence case (weight 800, tight tracking), so a long heading no longer
 * reads badly in capitals; the guard is kept because callers and tests still use it, and past this many characters a
 * heading still drops the tight tracking and line height of `type-display` for plain `font-extrabold`, which keeps a
 * long admin-written line readable. (Before CR-31 this guard stopped long text from being set in capitals,
 * BRAND_APPLICATION_SPEC 2.7.)
 */
export const DISPLAY_TYPE_MAX_LENGTH = 40;

export function fitsDisplayType(text: string): boolean {
  return text.trim().length <= DISPLAY_TYPE_MAX_LENGTH;
}

/** Class names for a heading: the display utility when the text is short, plain heavy type when it is not. */
export function displayHeadingClass(text: string): string {
  return fitsDisplayType(text) ? 'type-display' : 'font-extrabold';
}
