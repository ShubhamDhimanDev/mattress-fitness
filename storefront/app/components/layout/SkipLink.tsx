export const MAIN_CONTENT_ID = 'main-content';

/**
 * First focusable element on every page (WCAG 2.4.1). Visible only while focused, drawn over the red promo bar (or
 * the grey utility bar when there is none). `on-dark` makes the ring yellow (the blue ring is 1.31:1 on the red bar);
 * an ink band (`ring-4`, 2 px of it shows between the link and the ring) keeps the yellow readable on the grey bar too, where
 * yellow alone is only about 1.4:1.
 */
export function SkipLink() {
  return (
    <a
      href={`#${MAIN_CONTENT_ID}`}
      className="on-dark sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-60 focus:rounded-choice focus:bg-ink-900 focus:px-4 focus:py-3 focus:text-sm focus:font-bold focus:text-white focus:ring-4 focus:ring-ink-900"
    >
      Skip to main content
    </a>
  );
}
