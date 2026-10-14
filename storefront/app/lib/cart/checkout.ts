// The single place that decides where "Checkout" goes (REQ-CHK-001, REQ-PRE-006, ADR-0003). The hand-off is
// Shopify's hosted checkout URL straight from the cart, but only after the server has revalidated the cart:
// a cart the offer engine finds uncorrectable (a violation) gets no checkout URL, it gets a blocked state
// the UI explains. The cart drawer and page link to CHECKOUT_STEPS_PATH, which runs the server gate and the
// pre-checkout steps and then redirects here.

import type {BlockReason} from '~/lib/offers-runtime/messages';
import type {SupportedStepId} from '~/lib/offers-runtime/view';

export const CHECKOUT_STEPS_PATH = '/checkout-steps';

type CheckoutCart = {readonly checkoutUrl?: string | null};

/** What revalidation found; anything in `blocked` withholds the checkout URL. */
export type CheckoutRevalidation = {
  readonly blocked: readonly unknown[];
};

/**
 * Shopify checkout is always https; anything else (a tampered or missing value) yields no link. With a
 * revalidation result that holds blocking reasons it yields no link either (REQ-PRE-006).
 */
export function getCheckoutHref(
  cart: CheckoutCart | null | undefined,
  revalidation?: CheckoutRevalidation | null,
): string | null {
  if (revalidation && revalidation.blocked.length > 0) return null;
  const url = cart?.checkoutUrl;
  if (!url) return null;
  try {
    return new URL(url).protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

export type CheckoutDecision =
  | {readonly status: 'ready'; readonly href: string}
  | {readonly status: 'step'; readonly step: SupportedStepId}
  | {readonly status: 'blocked'; readonly reasons: readonly BlockReason[]}
  | {readonly status: 'unavailable'};

type DecisionView = {
  readonly blocked: readonly BlockReason[];
  readonly nextStep: SupportedStepId | null;
};

/**
 * The hand-off decision for a cart the server has just revalidated. Order matters: a blocked cart never
 * reaches a step, and a pending step comes before the redirect. A cart without a revalidated view is never
 * handed off: an unverified cart must not reach checkout.
 */
export function decideCheckout(
  cart: CheckoutCart | null | undefined,
  view: DecisionView | null,
): CheckoutDecision {
  if (!view) return {status: 'unavailable'};
  if (view.blocked.length > 0)
    return {status: 'blocked', reasons: view.blocked};
  const href = getCheckoutHref(cart, view);
  if (!href) return {status: 'unavailable'};
  return view.nextStep
    ? {status: 'step', step: view.nextStep}
    : {status: 'ready', href};
}
