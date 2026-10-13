import {CartForm} from '@shopify/hydrogen';
import {useFetcher} from 'react-router';

type CartAction = (typeof CartForm.ACTIONS)[keyof typeof CartForm.ACTIONS];

/**
 * Submits a cart action without a visible form (quantity steppers). The payload has the same shape
 * `CartForm` writes, so Hydrogen's `useOptimisticCart` sees the pending change and the `/cart` action
 * validates it like any other. The fetcher key makes rapid changes to one line cancel each other instead
 * of racing (the last change wins).
 */
export function useCartSubmit(key: string) {
  const fetcher = useFetcher({key});
  function submit(action: CartAction, inputs: Record<string, unknown>) {
    void fetcher.submit(
      {[CartForm.INPUT_NAME]: JSON.stringify({action, inputs})},
      {method: 'post', action: '/cart'},
    );
  }
  return {submit, pending: fetcher.state !== 'idle'};
}
