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

/** A server answer is definitive; a failed request is not, and must not be remembered as "no plans". */
type Asked =
  | {readonly kind: 'answered'; readonly answer: ProtectionAnswer}
  | {readonly kind: 'failed'};

const FAILED: Asked = {kind: 'failed'};

async function askServer(
  variantId: string,
  signal: AbortSignal,
): Promise<Asked> {
  try {
    // Variant id and quantity only (T-01): the server reads price, category and plans itself.
    const query = new URLSearchParams({variantId, quantity: '1'});
    const response = await fetch(`/api/extend/offers?${query.toString()}`, {
      signal,
      credentials: 'same-origin',
      headers: {Accept: 'application/json'},
    });
    if (!response.ok) return FAILED;
    const body: unknown = await response.json();
    return {kind: 'answered', answer: readProtectionAnswer(body, variantId)};
  } catch {
    // Slow, down, aborted or not JSON: the offer is not shown now (NFR-013), but it is asked again next time.
    return FAILED;
  }
}

/**
 * The protection plans for the selected variant (P5A-05, REQ-ADD-003, REQ-EXT-001).
 *
 * The product page is the same for every shopper and every variant is already on it, so the offers are asked for AFTER
 * load from our own server route, never from Extend: the browser has no Extend address or credential. A change of
 * variant waits `OFFERS_DEBOUNCE_MS`, then asks; leaving the variant (or the page) cancels the request in flight, and
 * an answer for a variant that is no longer selected is never shown. Answers are kept per variant for the life of the
 * page so switching back is instant: only plans and a definitive "no plans" are kept. A request that failed (a non-OK
 * status, a timeout, a network error) hides the panel for now and is NOT kept, so choosing that size again asks again.
 * "Loading" is a state of its own so the panel can hold its space (NFR-002); unavailable, empty and failed answers are
 * all "hidden".
 */
export function useProtectionOffers(
  variantId: string | null,
  enabled: boolean,
): ProtectionOffers {
  const [answers, setAnswers] = useState<ReadonlyMap<string, ProtectionAnswer>>(
    () => new Map(),
  );
  // The variant whose latest request failed; forgotten as soon as the shopper leaves that variant.
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const known =
    variantId !== null && (answers.has(variantId) || failedFor === variantId);

  useEffect(() => {
    setFailedFor((previous) => (previous === variantId ? previous : null));
  }, [variantId]);

  useEffect(() => {
    if (!enabled || variantId === null || known) return;
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, OFFERS_DEBOUNCE_MS + REQUEST_TIMEOUT_MS);
    const debounce = setTimeout(() => {
      void askServer(variantId, controller.signal).then((asked) => {
        if (!active) return;
        if (asked.kind === 'failed') {
          setFailedFor(variantId);
          return;
        }
        setAnswers((previous) =>
          new Map(previous).set(variantId, asked.answer),
        );
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
  if (answer === undefined) {
    return failedFor === variantId ? {status: 'hidden'} : {status: 'loading'};
  }
  return answer.status === 'plans'
    ? {status: 'plans', plans: answer.plans}
    : {status: 'hidden'};
}
