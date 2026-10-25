import {useEffect, useState} from 'react';
import {readPickupAnswer, type PickupAnswer} from '~/lib/stores/pickup';

const REQUEST_TIMEOUT_MS = 8000;

export type PickupState =
  | {readonly status: 'loading'}
  | {readonly status: 'answer'; readonly answer: PickupAnswer}
  /** The read failed: the section says nothing about stock rather than something wrong (NFR-013). */
  | {readonly status: 'hidden'};

type Settled = Exclude<PickupState, {status: 'loading'}>;

async function ask(
  variantId: string,
  storeKey: string,
  signal: AbortSignal,
): Promise<Settled> {
  try {
    // A variant id and a store key, nothing else (T-01): the stock is read on the server.
    const query = new URLSearchParams({variantId, store: storeKey});
    const response = await fetch(
      `/api/pickup-availability?${query.toString()}`,
      {
        signal,
        credentials: 'same-origin',
        headers: {Accept: 'application/json'},
      },
    );
    if (!response.ok) return {status: 'hidden'};
    const answer = readPickupAnswer(await response.json());
    return answer === null ? {status: 'hidden'} : {status: 'answer', answer};
  } catch {
    return {status: 'hidden'};
  }
}

/**
 * Pickup for the selected size and the shopper's store (REQ-PDP-003). With no store there is nothing to ask; otherwise one
 * request per variant and store, asked after load so the product page itself is the same for every shopper. Changing the
 * size or the store asks again with no full reload; a result for an earlier request is never shown for a later one, and
 * the loading state is derived rather than set in an effect.
 */
export function usePickupAvailability(
  variantId: string,
  storeKey: string | null,
): PickupState {
  const key = storeKey === null ? null : `${variantId}|${storeKey}`;
  const [settled, setSettled] = useState<{
    readonly key: string;
    readonly state: Settled;
  } | null>(null);

  useEffect(() => {
    if (storeKey === null || key === null) return;
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, REQUEST_TIMEOUT_MS);
    void ask(variantId, storeKey, controller.signal).then((state) => {
      if (active) setSettled({key, state});
    });
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [variantId, storeKey, key]);

  if (key === null) {
    return {status: 'answer', answer: {status: 'choose_store'}};
  }
  return settled?.key === key ? settled.state : {status: 'loading'};
}
