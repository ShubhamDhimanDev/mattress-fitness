import {useCallback, useEffect, useState, type MouseEvent} from 'react';

/**
 * For a link that loads a whole new document (`reloadDocument`, a plain anchor): React Router never sees that navigation,
 * so `useNavigation` stays idle and the browser shows nothing until the server answers. `start` marks the link busy on
 * the click; the page then unloads and the state goes with it. If the shopper comes back through the back button the
 * browser may restore this page from its back-forward cache with the busy state still set, so `pageshow` clears it.
 */
export function useLeavingPage(): {
  active: boolean;
  start: (event: MouseEvent) => void;
} {
  const [active, setActive] = useState(false);

  useEffect(() => {
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) setActive(false);
    }
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  // A modified click (new tab, new window, download) leaves this page where it is, so it must not look busy.
  const start = useCallback((event: MouseEvent) => {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    setActive(true);
  }, []);
  return {active, start};
}
