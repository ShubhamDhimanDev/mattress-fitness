import {useEffect, useRef} from 'react';
import {useFetcher} from 'react-router';
import {useLatestCartResult} from '~/components/cart/cart-results';
import {useZipChange} from '~/components/delivery/useZipChange';
import {pickOffersView, readOffersView} from '~/lib/offers-runtime/client';
import type {CartOffersView} from '~/lib/offers-runtime/view';

/**
 * The offers view for the cart on screen (REQ-CART-003, REQ-CART-004). The page route hands its loader's view
 * in. The drawer has none, so it takes the newest view any cart action answered with and, when none matches, asks
 * `/cart` once per cart version while the drawer is open. The load is triggered by opening the drawer, not by first
 * render.
 *
 * The action answers come from the results the submitting forms report (cart-results.ts), never from
 * `useFetchers()`: React Router drops a mounted fetcher from that list as soon as it is idle, so a view read there
 * vanished right after it arrived and the drawer asked `/cart` again after every change (B-20 follow-up). Only this
 * hook's own `cart-offers` fetcher is read directly, because its data survives.
 *
 * The view depends on the shopper's delivery ZIP (haul-away eligibility, the free-delivery message), which is not
 * part of the cart version. After a ZIP change (zip-change.ts, P3B-11) every view computed before it is dropped:
 * the page loader's, an earlier action's, and the earlier fetch (a new fetcher key per change starts empty). The
 * hook then asks `/cart` again, on the page as well as in the drawer, and a cart action answered after the change
 * is used as soon as it arrives. The `/cart` request reads the new signed cookie on the server; nothing about the
 * ZIP is sent or cached by the browser here.
 */
export function useCartOffers({
  cartUpdatedAt,
  provided,
  active,
}: {
  cartUpdatedAt: string | null | undefined;
  provided: CartOffersView | null | undefined;
  active: boolean;
}): CartOffersView | null {
  const {offers: reportedOffers, offersSeq} = useLatestCartResult();
  const {epoch, cartResultSeq} = useZipChange();
  const loader = useFetcher({key: `cart-offers-${epoch}`});
  const requestedFor = useRef<string | null>(null);

  // Once the ZIP has changed, the loader's view of the page is older than the cookie; only views fetched or
  // answered since the change describe the cart as it is now.
  const changed = epoch > 0;
  const usableProvided = changed ? null : (provided ?? null);
  const usableReported =
    !changed || offersSeq > cartResultSeq ? reportedOffers : null;

  const view = pickOffersView(
    [usableProvided, usableReported, readOffersView(loader.data)],
    cartUpdatedAt,
  );

  const needsLoad =
    active && !usableProvided && !view && Boolean(cartUpdatedAt);
  const requestKey = cartUpdatedAt ? `${epoch}:${cartUpdatedAt}` : null;
  useEffect(() => {
    if (
      !needsLoad ||
      requestKey === null ||
      requestedFor.current === requestKey
    ) {
      return;
    }
    requestedFor.current = requestKey;
    void loader.load('/cart');
  }, [needsLoad, requestKey, loader]);

  return view;
}
