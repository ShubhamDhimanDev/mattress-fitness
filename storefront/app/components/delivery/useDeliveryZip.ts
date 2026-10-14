import {useCallback, useEffect, useRef} from 'react';
import {useFetcher, useRevalidator, useRouteLoaderData} from 'react-router';
import {
  readDeliverySeed,
  type DeliveryResponse,
} from '~/lib/delivery-runtime/response';

/** One shared fetcher: every ZIP control on a page (product page, cart, header) sees the same answer. */
export const DELIVERY_FETCHER_KEY = 'delivery-zip';

/**
 * The saved delivery ZIP, as the server describes it (P3B-11, REQ-NAV-003). The browser never reads the
 * cookie. The first answer comes from the server in this order: `initial` (the /delivery page itself, a
 * loader that read the cookie), else the root loader's `deliverySeed` (the root document is private and has
 * already read the signed cookie, so the header and the product-page and cart checks paint the right state
 * at once), else one request to `/delivery` after load (error pages that have no root data). After any change
 * the fetcher's own answer replaces the seed, so every surface keeps agreeing.
 */
export function useDeliveryZip(
  initial?: DeliveryResponse,
  options: {refreshPageAfterChange?: boolean} = {},
) {
  const fetcher = useFetcher<DeliveryResponse>({key: DELIVERY_FETCHER_KEY});
  const {load, submit, state, data} = fetcher;
  const {revalidate} = useRevalidator();
  // Untyped on purpose: importing the root's loader type here would make a cycle (root -> layout -> this).
  const rootData = useRouteLoaderData('root');
  const seed = initial ?? readDeliverySeed(rootData) ?? undefined;
  const hasSeed = seed !== undefined;
  const refresh = options.refreshPageAfterChange === true;
  // One attempt per mount: a failing endpoint must not turn into a request loop.
  const requested = useRef(false);

  useEffect(() => {
    if (hasSeed || data !== undefined || requested.current) return;
    requested.current = true;
    void load('/delivery');
  }, [hasSeed, data, load]);

  // A ZIP change must not re-run every loader on the page (the product loader, the header, the catalog): the
  // answer lives in this fetcher. Only a surface whose server data depends on the ZIP, the cart (offers and
  // haul-away eligibility), asks for a page refresh.
  const send = useCallback(
    async (fields: Record<string, string>) => {
      await submit(fields, {
        method: 'post',
        action: '/delivery',
        defaultShouldRevalidate: false,
      });
      if (refresh) await revalidate();
    },
    [submit, revalidate, refresh],
  );
  const save = useCallback(
    (zip: string) => send({intent: 'save', zip}),
    [send],
  );
  const clear = useCallback(() => send({intent: 'clear'}), [send]);

  return {
    /** null until the first answer arrives. */
    response: data ?? seed ?? null,
    pending: state !== 'idle',
    save,
    clear,
  };
}
