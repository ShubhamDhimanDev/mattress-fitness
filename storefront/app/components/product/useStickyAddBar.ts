import {useEffect, useState, type RefObject} from 'react';
import {
  isScrolledPast,
  PRODUCT_END_ID,
  shouldShowStickyBar,
} from '~/components/product/sticky-add-bar';

/**
 * Whether the phone's sticky Add to cart bar should be on screen. Watches the main button's wrapper and the page-end marker
 * with one IntersectionObserver. It starts false and only changes after mount, so the server render and the first client
 * render agree and nothing shifts; without IntersectionObserver the bar simply never shows (the main button is still there).
 * No request is made.
 */
export function useStickyAddBar(
  action: RefObject<HTMLElement | null>,
): boolean {
  const [pastAction, setPastAction] = useState(false);
  const [atEnd, setAtEnd] = useState(false);

  useEffect(() => {
    const actionElement = action.current;
    if (!actionElement || typeof IntersectionObserver !== 'function') return;
    const endElement = document.getElementById(PRODUCT_END_ID);

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === actionElement) {
          setPastAction(
            isScrolledPast({
              isIntersecting: entry.isIntersecting,
              top: entry.boundingClientRect.top,
            }),
          );
        } else {
          setAtEnd(entry.isIntersecting);
        }
      }
    });
    observer.observe(actionElement);
    if (endElement) observer.observe(endElement);
    return () => observer.disconnect();
  }, [action]);

  return shouldShowStickyBar({pastAction, atEnd});
}
