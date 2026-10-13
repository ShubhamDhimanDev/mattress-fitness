// Builds the engine's OfferContext from server-side facts (P4-09). The browser contributes nothing to the
// context except what the cart itself says: the `delivery_choice` cart attribute is read through the strict
// parser in offers/attributes.ts, and eligibility to buy it (ZIP in zone) is still decided here, not there.

import type {DeliveryZone} from '~/lib/delivery/zone';
import {parseOfferAttributes} from '~/lib/offers/attributes';
import type {CartLike, OfferContext} from '~/lib/offers/types';

export type ContextInput = {
  /**
   * The shopper's saved delivery ZIP. No server-side store for it exists yet (the header control keeps it in
   * component state, REQ-NAV-003), so callers pass null and haul-away fails closed (zip-missing).
   */
  readonly zip: string | null;
  readonly zone: DeliveryZone | null;
  /** Cart line ids Extend says can be covered. Empty while Extend is off or not connected (P5A-06). */
  readonly protectionEligibleLineIds: readonly string[];
};

export function buildOfferContext(
  cart: CartLike,
  input: ContextInput,
): OfferContext {
  return {
    zip: input.zip,
    deliveryChoice: parseOfferAttributes(cart.attributes).deliveryChoice,
    zone: input.zone,
    protectionEligibleLineIds: input.protectionEligibleLineIds,
  };
}
