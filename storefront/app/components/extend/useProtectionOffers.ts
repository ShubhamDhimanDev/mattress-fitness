import {useEffect, useState} from 'react';
import {
  readProtectionAnswer,
  type ProtectionAnswer,
} from '~/lib/offers-runtime/client';
import type {ProtectionPlanView} from '~/lib/offers-runtime/view';

/** Wait for the shopper to stop switching sizes before asking, so a quick run of clicks makes one request. */
export const OFFERS_DEBOUNCE_MS = 250;
const REQUEST_TIMEOUT_MS = 8000;

export type ProtectionOffers =
  | {readonly status: 'loading'}
  | {readonly status: 'plans'; readonly plans: readonly ProtectionPlanView[]}
  | {readonly status: 'hidden'};

const HIDDEN: ProtectionAnswer = {status: 'hidden'};

async function askServer(
  variantId: string,
  signal: AbortSignal,
): Promise<ProtectionAnswer> {
  try {
    // Variant id and quantity only (T-01): the server reads price, category and plans itself.
    const query = new URLSearchParams({variantId, quantity: '1'});
    const response = await fetch(`/api/extend/offers?${query.toString()}`, {
      signal,
      credentials: 'same-origin',
      headers: {Accept: 'application/json'},
    });
    if (!response.ok) return HIDDEN;
    const body: unknown = await response.json();
    return readProtectionAnswer(body, variantId);
  } catch {
    // Slow, down, aborted or not JSON: the offer is simply not shown (NFR-013).
    return HIDDEN;
  }
}

/**
 * The protection plans for the selected variant (P5A-05, REQ-ADD-003, REQ-EXT-001).
 *
 * The product page is the same for every shopper and every variant is already on it, so the offers are asked for AFTER
 * load from our own server route, never from Extend: the browser has no Extend address or credential. A change of
 * variant waits `OFFERS_DEBOUNCE_MS`, then asks; leaving the variant (or the page) cancels the request in flight, and
 * an answer for a variant that is no longer selected is never shown. Answers are kept per variant for the life of the
 * page so switching back is instant. "Loading" is a state of its own so the panel can hold its space (NFR-002);
 * unavailable, empty and failed answers are all "hidden".
 */
export function useProtectionOffers(
  variantId: string | null,
  enabled: boolean,
): ProtectionOffers {
  const [answers, setAnswers] = useState<ReadonlyMap<string, ProtectionAnswer>>(
    () => new Map(),
  );
  const known = variantId !== null && answers.has(variantId);

  useEffect(() => {
    if (!enabled || variantId === null || known) return;
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, OFFERS_DEBOUNCE_MS + REQUEST_TIMEOUT_MS);
    const debounce = setTimeout(() => {
      void askServer(variantId, controller.signal).then((answer) => {
        if (!active) return;
        setAnswers((previous) => new Map(previous).set(variantId, answer));
      });
    }, OFFERS_DEBOUNCE_MS);
    return () => {
      active = false;
      clearTimeout(debounce);
      clearTimeout(timeout);
      controller.abort();
    };
  }, [enabled, variantId, known]);

  if (!enabled || variantId === null) return {status: 'hidden'};
  const answer = answers.get(variantId);
  if (answer === undefined) return {status: 'loading'};
  return answer.status === 'plans'
    ? {status: 'plans', plans: answer.plans}
    : {status: 'hidden'};
}
