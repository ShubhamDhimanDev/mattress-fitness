import {AnalyticsEvent as HydrogenEvent, useAnalytics} from '@shopify/hydrogen';
import {useEffect, useRef} from 'react';
import {useLocation} from 'react-router';
import {track} from '~/lib/analytics';
import {
  SELECT_ITEM_ATTRIBUTE,
  get,
  mapBeginCheckout,
  mapCartLineChange,
  mapCartViewed,
  mapProductViewed,
  mapSearchViewed,
  mapSelectItem,
} from '~/lib/analytics/hydrogen-events';

const CHECKOUT_DEBOUNCE_MS = 2000;

// True while an `AnalyticsBridge` is mounted; see the subscriptions below.
let mounted = false;
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
export function AnalyticsBridge({
  takeEarlyViews,
}: {
  /** The page's first product and search views, kept by the shell until now (`earlyViews` in `~/lib/analytics/gate`). */
  takeEarlyViews: () => Array<[string, unknown]>;
}) {
  const {subscribe, cart} = useAnalytics();
  const cartRef = useRef(cart);
  cartRef.current = cart;

  // Hydrogen keeps subscribers in a module-level map keyed by the callback's source text and has no unsubscribe, so a
  // subscription outlives this component. The callbacks therefore act only while it is mounted (`mounted`): between
  // two mounts a lingering callback would send an event that the next mount sends again from the early views.
  useEffect(() => {
    mounted = true;
    subscribe(HydrogenEvent.PRODUCT_VIEWED, (payload) => {
      if (mounted) sendIfPresent(mapProductViewed(payload));
    });
    subscribe(HydrogenEvent.SEARCH_VIEWED, (payload) => {
      if (mounted) sendIfPresent(mapSearchViewed(payload));
    });
    subscribe(HydrogenEvent.CART_VIEWED, (payload) => {
      if (mounted) sendIfPresent(mapCartViewed(payload));
    });
    subscribe(HydrogenEvent.PRODUCT_ADD_TO_CART, (payload) => {
      if (mounted) sendIfPresent(mapCartLineChange('add', payload));
    });
    subscribe(HydrogenEvent.PRODUCT_REMOVED_FROM_CART, (payload) => {
      if (mounted) sendIfPresent(mapCartLineChange('remove', payload));
    });
    // Hydrogen published this page's views before this chunk existed and does not replay them to a late subscriber,
    // so the shell kept them; send those that belong to the page the shopper is still on, once.
    for (const [kind, payload] of takeEarlyViews()) {
      if (!isThisPage(payload)) continue;
      sendIfPresent(
        kind === HydrogenEvent.PRODUCT_VIEWED
          ? mapProductViewed(payload)
          : mapSearchViewed(payload),
      );
    }
    return () => {
      mounted = false;
    };
  }, [subscribe, takeEarlyViews]);

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

/** A kept view belongs to this page when its address (path and query) is the one now showing. */
function isThisPage(payload: unknown): boolean {
  try {
    const url = new URL(String(get(payload, 'url')));
    return (
      url.pathname + url.search ===
      window.location.pathname + window.location.search
    );
  } catch {
    return false;
  }
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
