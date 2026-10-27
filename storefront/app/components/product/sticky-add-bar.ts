/**
 * Pure rules for the phone-only sticky "Add to cart" bar on the product page (CR-31). The bar repeats the main button, so
 * it must appear only while that button is out of view, and only because the shopper scrolled past it: a bar that also
 * showed while the button was still below the fold would cover the first screen of every product page.
 */

/** What an IntersectionObserver reports about one watched element. */
export type SentinelReading = {
  readonly isIntersecting: boolean;
  /** `boundingClientRect.top`: negative once the element has scrolled up above the viewport. */
  readonly top: number;
};

/** The main Add to cart button has been scrolled past (it is out of view and above the viewport). */
export function isScrolledPast(reading: SentinelReading): boolean {
  return !reading.isIntersecting && reading.top < 0;
}

/**
 * The bar shows once the main button is scrolled past, and goes away again at the end of the product content, so it
 * never covers the footer's links.
 */
export function shouldShowStickyBar({
  pastAction,
  atEnd,
}: {
  pastAction: boolean;
  atEnd: boolean;
}): boolean {
  return pastAction && !atEnd;
}

/** The id of the zero-height marker the product page renders after its last section. */
export const PRODUCT_END_ID = 'product-page-end';
