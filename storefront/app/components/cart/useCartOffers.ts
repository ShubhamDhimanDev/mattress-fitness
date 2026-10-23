import {useEffect, useRef, useState} from 'react';
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
 *
 * Only the page-loader view that was on screen AT the change is dropped (compared by reference). A later one, from a
 * navigation to /cart or a revalidation after the change, was computed on the server with the new cookie and is
 * used as it arrives, so it costs no extra fetch and no empty offers block.
 *
 * Known small windows, accepted and recorded (P3B-11):
 * - A cart action posted just before the browser handled the ZIP answer, but answered after it, is counted as
 *   post-change although the server may have read the old cookie. The result is stamped when it is reported, not
 *   when it was sent (the posting forms do not stamp their requests). It is corrected by the next `/cart` load:
 *   React Router re-runs this hook's mounted fetch after every cart action, and a later cart version asks again.
 * - Only `offers` is read from the `/cart` answer, not its `cart`. A ZIP change never edits cart lines: the
 *   engine's corrections do not depend on the ZIP, and an out-of-zone haul-away is a violation that blocks the
 *   hand-off with the line named, not a repair (ARCHITECTURE section 5, "The gate"). So the lines on screen
 *   (the root cart) stay right, and the changed state arrives in the view's `blocked` reasons and messages.
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
  // The page-loader view that was current when the latest change was seen by this mount. State, not a ref: it is
  // adjusted during render, the pattern React documents for "state that follows a prop" (no extra paint). A mount
  // that starts after a change starts with none, because what its loader returned is already post-change.
  const [seen, setSeen] = useState<{
    epoch: number;
    stale: CartOffersView | null;
  }>({epoch, stale: null});
  let stale = seen.stale;
  if (seen.epoch !== epoch) {
    stale = provided ?? null;
    setSeen({epoch, stale});
  }

  // Once the ZIP has changed, the views from before it are older than the cookie; only views fetched, answered
  // or loaded since the change describe the cart as it is now.
  const changed = epoch > 0;
  const usableProvided = provided && provided !== stale ? provided : null;
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
