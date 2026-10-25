import {useCallback, useEffect, useRef} from 'react';
import {useFetcher, useRouteLoaderData} from 'react-router';
import {currentCartResultSeq} from '~/components/cart/cart-results';
import {
  readDeliverySeed,
  type DeliveryResponse,
} from '~/lib/delivery-runtime/response';
import {
  deliverySignature,
  markZipChanged,
} from '~/lib/delivery-runtime/zip-change';

/** One shared fetcher: every ZIP control on a page (product page, cart, header) sees the same answer. */
export const DELIVERY_FETCHER_KEY = 'delivery-zip';

/**
 * The saved delivery ZIP, as the server describes it (P3B-11, REQ-NAV-003). The browser never reads the
 * cookie. The first answer comes from the server in this order: `initial` (the /delivery page itself, a
 * loader that read the cookie), else the root loader's `deliverySeed` (the root document is private and has
 * already read the signed cookie, so the header and the product-page and cart checks paint the right state
 * at once), else one request to `/delivery` after load (error pages that have no root data). After any change
 * the fetcher's own answer replaces the seed, so every surface keeps agreeing.
 *
 * A save or clear that the server accepted is recorded in `zip-change.ts`; the cart's offers view reads that
 * record and refreshes itself (useCartOffers), so a change made from the header, the drawer or the cart page
 * reaches the haul-away and free-delivery state without a reload. The page's loaders are deliberately NOT all
 * re-run: the product page, the header and the catalog do not depend on the ZIP.
 */
export function useDeliveryZip(initial?: DeliveryResponse) {
  const fetcher = useFetcher<DeliveryResponse>({key: DELIVERY_FETCHER_KEY});
  const {load, submit, state, data, formMethod} = fetcher;
  // Untyped on purpose: importing the root's loader type here would make a cycle (root -> layout -> this).
  const rootData = useRouteLoaderData('root');
  const seed = initial ?? readDeliverySeed(rootData) ?? undefined;
  const hasSeed = seed !== undefined;
  // One attempt per mount: a failing endpoint must not turn into a request loop.
  const requested = useRef(false);
  // True between this instance sending a change and its answer arriving. Only the instance that sent it records
  // the change, so several ZIP controls on one page do not count it more than once, and the answer to the
  // first `load('/delivery')` is never mistaken for a change.
  const awaitingAnswer = useRef(false);
  // What the answer said when the change was sent, to tell a real change from saving the same ZIP again.
  const answeredBefore = useRef('none');
  const current = data ?? seed ?? null;
  const currentSignature = deliverySignature(current?.delivery ?? null);
  // "Pending" means the shopper's own save or clear is on its way, not that the fetcher is busy. The first answer is a
  // GET load on the same fetcher, and React Router hands the fetcher's data to components through a mutable map that
  // is updated before the router state that says "idle" is rendered. A render in that gap shows the answer and the
  // form together with the fetcher still "loading": if that counted as pending, the buttons would be inert (loading
  // buttons ignore clicks) for a moment and a click on a form that is already on screen would be swallowed (the
  // flaky DeliveryCheck tests, found under full-suite load). A POST is what a change is; its loading state after the
  // action keeps the POST method, so it still counts.
  const changing =
    state !== 'idle' &&
    formMethod !== undefined &&
    formMethod.toUpperCase() !== 'GET';

  useEffect(() => {
    if (hasSeed || data !== undefined || requested.current) return;
    requested.current = true;
    void load('/delivery');
  }, [hasSeed, data, load]);

  useEffect(() => {
    if (!awaitingAnswer.current || state !== 'idle' || data === undefined) {
      return;
    }
    awaitingAnswer.current = false;
    // A refused change (invalid ZIP, no secret, wrong origin) leaves the cookie as it was: nothing to refresh.
    // Saving the ZIP that was already saved changes nothing the cart depends on.
    if (
      data.error === null &&
      deliverySignature(data.delivery) !== answeredBefore.current
    ) {
      markZipChanged(currentCartResultSeq());
    }
  }, [state, data]);

  const send = useCallback(
    async (fields: Record<string, string>) => {
      awaitingAnswer.current = true;
      answeredBefore.current = currentSignature;
      try {
        await submit(fields, {
          method: 'post',
          action: '/delivery',
          defaultShouldRevalidate: false,
        });
      } catch (error) {
        // No answer will come: do not let a later, unrelated answer be taken for this change.
        awaitingAnswer.current = false;
        throw error;
      }
    },
    [submit, currentSignature],
  );
  const save = useCallback(
    (zip: string) => send({intent: 'save', zip}),
    [send],
  );
  const clear = useCallback(() => send({intent: 'clear'}), [send]);

  return {
    /** null until the first answer arrives. */
    response: current,
    pending: changing,
    save,
    clear,
  };
}
