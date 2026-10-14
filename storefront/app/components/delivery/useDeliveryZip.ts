import {useCallback, useEffect, useRef} from 'react';
import {useFetcher, useRevalidator} from 'react-router';
import type {DeliveryResponse} from '~/lib/delivery-runtime/response';

/** One shared fetcher: every ZIP control on a page (product page, cart, header) sees the same answer. */
export const DELIVERY_FETCHER_KEY = 'delivery-zip';

/**
 * The saved delivery ZIP, as the server describes it (P3B-11, REQ-NAV-003). The browser never reads the
 * cookie: it asks `/delivery`, which answers privately and uncached. The first answer is fetched after the
 * page loads on purpose, so a product page can stay cacheable and carry no personal data; pass `initial`
 * where the server already knows (the /delivery page itself, a loader that read the cookie).
 */
export function useDeliveryZip(
  initial?: DeliveryResponse,
  options: {refreshPageAfterChange?: boolean} = {},
) {
  const fetcher = useFetcher<DeliveryResponse>({key: DELIVERY_FETCHER_KEY});
  const {load, submit, state, data} = fetcher;
  const {revalidate} = useRevalidator();
  const refresh = options.refreshPageAfterChange === true;
  // One attempt per mount: a failing endpoint must not turn into a request loop.
  const requested = useRef(false);

  useEffect(() => {
    if (initial !== undefined || data !== undefined || requested.current) {
      return;
    }
    requested.current = true;
    void load('/delivery');
  }, [initial, data, load]);

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
    response: data ?? initial ?? null,
    pending: state !== 'idle',
    save,
    clear,
  };
}
