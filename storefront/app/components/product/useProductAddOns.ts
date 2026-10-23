import {useEffect, useState} from 'react';
import {
  readProductAddOnsAnswer,
  type ProductAddOnItem,
} from '~/lib/offers-runtime/product-addons';

const REQUEST_TIMEOUT_MS = 8000;

export type ProductAddOnsState =
  | {readonly status: 'loading'}
  | {readonly status: 'ready'; readonly items: readonly ProductAddOnItem[]}
  | {readonly status: 'error'};

type Settled = Exclude<ProductAddOnsState, {status: 'loading'}>;

async function ask(productId: string, signal: AbortSignal): Promise<Settled> {
  try {
    // The product id and nothing else (T-01): relations, prices and stock are read on the server.
    const query = new URLSearchParams({productId});
    const response = await fetch(`/api/product-addons?${query.toString()}`, {
      signal,
      credentials: 'same-origin',
      headers: {Accept: 'application/json'},
    });
    if (!response.ok) return {status: 'error'};
    const answer = readProductAddOnsAnswer(await response.json());
    return answer === null
      ? {status: 'error'}
      : {status: 'ready', items: answer.items};
  } catch {
    // Slow, down, aborted or not JSON: an error the shopper can retry; the page itself is unaffected (NFR-013).
    return {status: 'error'};
  }
}

/**
 * The add-ons the server relates to this mattress product, every size (P4-03, REQ-ADD-001).
 *
 * The product page is the same for every shopper and carries no add-on data of its own, so the list is asked for AFTER
 * load from our own route (the same pattern as the protection panel, `useProtectionOffers`): the page never waits on
 * it. One request per product and attempt; leaving the page cancels it. `retry` asks again after an error. The state is
 * keyed by product and attempt, so a result for an earlier request is never shown for a later one, and the loading state
 * is derived rather than set in an effect.
 */
export function useProductAddOns(productId: string): {
  readonly state: ProductAddOnsState;
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
