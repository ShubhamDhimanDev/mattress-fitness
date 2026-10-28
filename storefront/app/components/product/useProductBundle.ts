import {useEffect, useState} from 'react';
import {
  readProductBundleAnswer,
  type ProductBundle,
} from '~/lib/offers-runtime/product-bundle';

const REQUEST_TIMEOUT_MS = 8000;

export type ProductBundleState =
  | {readonly status: 'loading'}
  | {readonly status: 'ready'; readonly bundle: ProductBundle | null}
  | {readonly status: 'error'};

type Settled = Exclude<ProductBundleState, {status: 'loading'}>;

async function ask(productId: string, signal: AbortSignal): Promise<Settled> {
  try {
    // The product id and nothing else (T-01): the rule, prices and stock are read on the server.
    const query = new URLSearchParams({productId});
    const response = await fetch(`/api/product-bundle?${query.toString()}`, {
      signal,
      credentials: 'same-origin',
      headers: {Accept: 'application/json'},
    });
    if (!response.ok) return {status: 'error'};
    const answer = readProductBundleAnswer(await response.json());
    return answer === null
      ? {status: 'error'}
      : {status: 'ready', bundle: answer.bundle};
  } catch {
    // Slow, down, aborted or not JSON: an error the shopper can retry; the page itself is unaffected (NFR-013).
    return {status: 'error'};
  }
}

/**
 * The bundle set the server offers for this anchor product, every size (P4-06, REQ-ADD-002).
 *
 * The product page is the same for every shopper and carries no bundle data of its own, so the set is asked for AFTER load
 * from our own route (the same pattern as `useProductAddOns`): the page never waits on it. One request per product and
 * attempt; leaving the page cancels it. `retry` asks again after an error. The state is keyed by product and attempt, so a
 * result for an earlier request is never shown for a later one, and the loading state is derived, not set in an effect.
 */
export function useProductBundle(productId: string): {
  readonly state: ProductBundleState;
  readonly retry: () => void;
} {
  const [attempt, setAttempt] = useState(0);
  const key = `${productId}#${attempt}`;
  const [settled, setSettled] = useState<{
    readonly key: string;
    readonly state: Settled;
  } | null>(null);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, REQUEST_TIMEOUT_MS);
    void ask(productId, controller.signal).then((state) => {
      if (active) setSettled({key, state});
    });
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [productId, key]);

  return {
    state: settled?.key === key ? settled.state : {status: 'loading'},
    retry: () => setAttempt((previous) => previous + 1),
  };
}
