import {AnalyticsEvent as HydrogenEvent, useAnalytics} from '@shopify/hydrogen';
import {useEffect, useRef} from 'react';
import {useLocation, useNavigation} from 'react-router';
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
/** How long a click on a link to a private page holds the providers if the navigation never starts. */
const PENDING_CLICK_MS = 3000;
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
  resetEarlyViews,
  setNavigationTarget,
}: {
  /** The page's first product and search views, kept by the shell until now (`earlyViews` in `~/lib/analytics/gate`). */
  takeEarlyViews: () => Array<[string, unknown]>;
  /** Starts keeping the views again when this bridge goes away, so a remounted one can take them. */
  resetEarlyViews: () => void;
  /** Tells the runtime where the shopper is about to go (or null), so a private target pauses the providers first. */
  setNavigationTarget: (href: string | null) => void;
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
      resetEarlyViews();
    };
  }, [subscribe, takeEarlyViews, resetEarlyViews]);

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

  return (
    <>
      <PageViewTracker />
      <NavigationGuard setNavigationTarget={setNavigationTarget} />
    </>
  );
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

/**
 * Pauses the providers BEFORE the address changes when the shopper is going to a private page (security review
 * A-M1). The runtime's own pause runs when the new page's view is tracked, after the navigation has committed, and
 * Google's own history-change page view can fire on the address change before that. Two signals, both cleared when
 * the navigation ends:
 *  - React Router's pending navigation (`useNavigation().location`), which exists while the next page loads and
 *    before the history entry is pushed;
 *  - a click, in the capture phase, on a link into a private prefix, which covers the instant before the router has
 *    started (and is released after a few seconds if no navigation follows, for example a cancelled click).
 * The runtime decides which targets are private.
 */
function NavigationGuard({
  setNavigationTarget,
}: {
  setNavigationTarget: (href: string | null) => void;
}) {
  const navigation = useNavigation();
  const pending = navigation.location
    ? navigation.location.pathname + navigation.location.search
    : null;
  const stateRef = useRef(navigation.state);
  stateRef.current = navigation.state;

  useEffect(() => {
    setNavigationTarget(pending);
  }, [pending, setNavigationTarget]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    function onClickCapture(event: MouseEvent) {
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest('a[href]');
      if (!link) return;
      const where = link.getAttribute('target');
      if (where && where !== '_self') return;
      setNavigationTarget(link.getAttribute('href'));
      clearTimeout(timer);
      timer = setTimeout(() => {
        // Still on the same page and no navigation under way: the click led nowhere.
        if (stateRef.current === 'idle') setNavigationTarget(null);
      }, PENDING_CLICK_MS);
    }
    document.addEventListener('click', onClickCapture, true);
    return () => {
      document.removeEventListener('click', onClickCapture, true);
      clearTimeout(timer);
    };
  }, [setNavigationTarget]);

  return null;
}
