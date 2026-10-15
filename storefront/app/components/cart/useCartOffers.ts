import {useEffect, useRef} from 'react';
import {useFetcher} from 'react-router';
import {useLatestCartResult} from '~/components/cart/cart-results';
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
  const {offers: reported} = useLatestCartResult();
  const loader = useFetcher({key: 'cart-offers'});
  const requestedFor = useRef<string | null>(null);

  const view = pickOffersView(
    [provided ?? null, reported, readOffersView(loader.data)],
    cartUpdatedAt,
  );

  const needsLoad = active && !provided && !view && Boolean(cartUpdatedAt);
  useEffect(() => {
    if (
      !needsLoad ||
      !cartUpdatedAt ||
      requestedFor.current === cartUpdatedAt
    ) {
      return;
    }
    requestedFor.current = cartUpdatedAt;
    void loader.load('/cart');
  }, [needsLoad, cartUpdatedAt, loader]);

  return view;
}
