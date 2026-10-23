import {AnalyticsEvent as HydrogenEvent, useAnalytics} from '@shopify/hydrogen';
import {useEffect, useRef} from 'react';
import {useLocation} from 'react-router';
import {track} from '~/lib/analytics';
import {
  SELECT_ITEM_ATTRIBUTE,
  mapBeginCheckout,
  mapCartLineChange,
  mapCartViewed,
  mapProductViewed,
  mapSearchViewed,
  mapSelectItem,
} from '~/lib/analytics/hydrogen-events';

const CHECKOUT_DEBOUNCE_MS = 2000;
// Written out, not imported from `~/lib/cart/checkout`: that module is shared with the cart chunk, and importing it here
// adds a file to the consent chunk's preload list in the root route (bundle budget, scripts/perf). A test pins the two.
export const CHECKOUT_LINK_PATH = '/checkout-steps';

/**
 * Feeds `track()` from what the page already publishes and does (P7-01, REQ-ANL-001). Renders nothing.
 *
 *  - Hydrogen's product, search, cart and cart-line events are subscribed to and mapped by the pure
 *    functions in `~/lib/analytics/hydrogen-events`. Its collection view is deliberately NOT subscribed to: the
 *    listing code sends `view_item_list` with the products for collection pages too. Hydrogen publishes them only while `canTrack` allows it,
 *    and re-publishes the current page when that changes, so a shopper who agrees later is still counted once.
 *  - page_view is sent per navigation from here and not from Hydrogen's page_viewed, so it does not depend on
 *    Shopify's consent script having loaded. The runtime holds it in memory until consent exists.
 *  - begin_checkout is sent on the click that hands the cart to checkout (the link to the pre-checkout steps),
 *    from the cart as the page holds it.
 *  - select_item is sent on a click inside an element marked with the `data-si` attribute (`cardSelectItemAttributes`).
 * Every handler goes through `track()`, which never throws, and the runtime drops what consent does not allow.
 */
export function AnalyticsBridge() {
  const {subscribe, cart} = useAnalytics();
  const cartRef = useRef(cart);
  cartRef.current = cart;

  // Hydrogen keeps subscribers in a module-level map keyed by the callback's source text and has no unsubscribe,
  // so this runs once and the callbacks hold nothing that can go stale (they only call the global `track`).
  useEffect(() => {
    subscribe(HydrogenEvent.PRODUCT_VIEWED, (payload) => {
      sendIfPresent(mapProductViewed(payload));
    });
    subscribe(HydrogenEvent.SEARCH_VIEWED, (payload) => {
      sendIfPresent(mapSearchViewed(payload));
    });
    subscribe(HydrogenEvent.CART_VIEWED, (payload) => {
      sendIfPresent(mapCartViewed(payload));
    });
    subscribe(HydrogenEvent.PRODUCT_ADD_TO_CART, (payload) => {
      sendIfPresent(mapCartLineChange('add', payload));
    });
    subscribe(HydrogenEvent.PRODUCT_REMOVED_FROM_CART, (payload) => {
      sendIfPresent(mapCartLineChange('remove', payload));
    });
  }, [subscribe]);

  useEffect(() => {
    let lastCheckout = 0;
    function onClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const link = target.closest('a[href]');
      if (link && isCheckoutLink(link)) {
        const now = Date.now();
        if (now - lastCheckout < CHECKOUT_DEBOUNCE_MS) return;
        lastCheckout = now;
        sendIfPresent(mapBeginCheckout(cartRef.current));
        return;
      }

      const marked = target.closest(`[${SELECT_ITEM_ATTRIBUTE}]`);
      if (marked) {
        sendIfPresent(
          mapSelectItem(
            marked.getAttribute(SELECT_ITEM_ATTRIBUTE),
            marked.textContent,
          ),
        );
      }
    }
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  return <PageViewTracker />;
}

function sendIfPresent(event: ReturnType<typeof mapProductViewed>): void {
  if (event) track(event);
}

function isCheckoutLink(link: Element): boolean {
  try {
    const url = new URL(link.getAttribute('href') ?? '', window.location.href);
    return (
      url.origin === window.location.origin &&
      url.pathname === CHECKOUT_LINK_PATH
    );
  } catch {
    return false;
  }
}

/** One page_view per navigation (path or query change); the address is reduced to a safe form by the mapper. */
function PageViewTracker() {
  const location = useLocation();
  const key = `${location.pathname}${location.search}`;
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (last.current === key) return;
    last.current = key;
    track({
      name: 'page_view',
      params: {page_location: window.location.href},
    });
  }, [key]);
  return null;
}
