import {useCallback, useEffect, useRef} from 'react';
import {useFetcher} from 'react-router';
import type {DeliveryResponse} from '~/lib/delivery-runtime/response';

/** One shared fetcher: every ZIP control on a page (product page, cart, header) sees the same answer. */
export const DELIVERY_FETCHER_KEY = 'delivery-zip';

/**
 * The saved delivery ZIP, as the server describes it (P3B-11, REQ-NAV-003). The browser never reads the
 * cookie: it asks `/delivery`, which answers privately and uncached. The first answer is fetched after the
 * page loads on purpose, so a product page can stay cacheable and carry no personal data; pass `initial`
 * where the server already knows (the /delivery page itself, a loader that read the cookie).
 */
export function useDeliveryZip(initial?: DeliveryResponse) {
  const fetcher = useFetcher<DeliveryResponse>({key: DELIVERY_FETCHER_KEY});
  const {load, submit, state, data} = fetcher;
  // One attempt per mount: a failing endpoint must not turn into a request loop.
  const requested = useRef(false);

  useEffect(() => {
    if (initial !== undefined || data !== undefined || requested.current) {
      return;
    }
    requested.current = true;
    void load('/delivery');
  }, [initial, data, load]);

  const save = useCallback(
    (zip: string) =>
      submit({intent: 'save', zip}, {method: 'post', action: '/delivery'}),
    [submit],
  );
  const clear = useCallback(
    () => submit({intent: 'clear'}, {method: 'post', action: '/delivery'}),
    [submit],
  );

  return {
    /** null until the first answer arrives. */
    response: data ?? initial ?? null,
    pending: state !== 'idle',
    save,
    clear,
  };
}
