import type {MoneyV2Like} from '~/lib/format';

// What the cart summary shows for the subtotal while Shopify is still answering (RS-02).
//
// Hydrogen's `useOptimisticCart` clones the cart and adds or changes lines, but it never touches `cost`. So:
//  - the very first add (no cart yet) produces a cart with lines and NO `cost` at all, and the summary showed "-"
//    for about a second until Shopify answered;
//  - a later add or quantity change leaves the previous subtotal in place until the answer arrives.
// The browser must not compute a price (ADR-0003), so nothing is estimated here: with no known amount the summary
// shows a busy placeholder, and with an out-of-date amount it keeps showing it, marked as updating.

type CartCostLike = {
  readonly isOptimistic?: boolean | null;
  readonly cost?: {
    readonly subtotalAmount?: {
      readonly amount?: string | null;
      readonly currencyCode?: string | null;
    } | null;
  } | null;
} | null;

export type SubtotalView =
  | {readonly status: 'pending'}
  | {
      readonly status: 'ready';
      readonly amount: MoneyV2Like;
      /** True while a change is in flight: the amount is Shopify's last answer, not yet updated for it. */
      readonly updating: boolean;
    };

export function subtotalView(cart: CartCostLike | undefined): SubtotalView {
  const subtotal = cart?.cost?.subtotalAmount;
  if (!subtotal?.amount || !subtotal.currencyCode) return {status: 'pending'};
  return {
    status: 'ready',
    amount: {amount: subtotal.amount, currencyCode: subtotal.currencyCode},
    updating: Boolean(cart?.isOptimistic),
  };
}
