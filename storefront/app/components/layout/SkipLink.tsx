export const MAIN_CONTENT_ID = 'main-content';

/** First focusable element on every page (WCAG 2.4.1). Visible only while focused. */
export function SkipLink() {
  return (
    <a
      href={`#${MAIN_CONTENT_ID}`}
      className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-60 focus:rounded-choice focus:bg-ink-900 focus:px-4 focus:py-3 focus:text-sm focus:font-bold focus:text-white"
    >
      Skip to main content
    </a>
  );
}
