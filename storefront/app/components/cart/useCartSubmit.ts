import {CartForm} from '~/lib/hydrogen/cart-form';
import {useFetcher} from 'react-router';
import {useReportCartResult} from '~/components/cart/cart-results';
import {
  ADD_PROTECTION_ACTION,
  CHANGE_SIZE_ACTION,
} from '~/lib/cart/custom-actions';

type CartAction =
  | (typeof CartForm.ACTIONS)[keyof typeof CartForm.ACTIONS]
  | typeof CHANGE_SIZE_ACTION
  | typeof ADD_PROTECTION_ACTION;

/**
 * Submits a cart action without a visible form (quantity steppers). The payload has the same shape
 * `CartForm` writes, so Hydrogen's `useOptimisticCart` sees the pending change and the `/cart` action
 * validates it like any other. The fetcher key makes rapid changes to one line cancel each other instead
 * of racing (the last change wins). The server's answer is reported for `CartMessages` (B-20): only this fetcher
 * still holds it once it is idle.
 */
export function useCartSubmit(key: string) {
  const fetcher = useFetcher({key});
  useReportCartResult(fetcher.data);
  function submit(action: CartAction, inputs: Record<string, unknown>) {
    void fetcher.submit(
      {[CartForm.INPUT_NAME]: JSON.stringify({action, inputs})},
      {method: 'post', action: '/cart'},
    );
  }
  return {submit, pending: fetcher.state !== 'idle'};
}
