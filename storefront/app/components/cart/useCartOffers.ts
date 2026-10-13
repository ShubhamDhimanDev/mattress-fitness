import {useEffect, useRef} from 'react';
import {useFetcher, useFetchers} from 'react-router';
import {pickOffersView, readOffersView} from '~/lib/offers-runtime/client';
import type {CartOffersView} from '~/lib/offers-runtime/view';

/**
 * The offers view for the cart on screen (REQ-CART-003, REQ-CART-004). The page route hands its loader's view
 * in. The drawer has none, so it takes the newest matching result of any cart action (every action returns
 * a view for the cart it produced) and, when none matches, asks `/cart` once per cart version while the drawer
 * is open. The load is triggered by opening the drawer, not by first render.
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
  const fetchers = useFetchers();
  const loader = useFetcher({key: 'cart-offers'});
  const requestedFor = useRef<string | null>(null);

  const fromFetchers = fetchers.map((fetcher) => readOffersView(fetcher.data));
  const candidates = [
    provided ?? null,
    ...fromFetchers,
    readOffersView(loader.data),
  ];
  const view = pickOffersView(candidates, cartUpdatedAt);

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
