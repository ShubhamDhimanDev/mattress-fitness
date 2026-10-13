// The single place that decides where "Checkout" goes (REQ-CHK-001, ADR-0003). Today it is Shopify's
// hosted checkout URL straight from the cart. The pre-checkout offer steps (P4-09, P4-11) will route
// through here first, so the cart drawer and the cart page never need to change.

type CheckoutCart = {readonly checkoutUrl?: string | null};

/** Shopify checkout is always https; anything else (a tampered or missing value) yields no link. */
export function getCheckoutHref(
  cart: CheckoutCart | null | undefined,
): string | null {
  const url = cart?.checkoutUrl;
  if (!url) return null;
  try {
    return new URL(url).protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}
