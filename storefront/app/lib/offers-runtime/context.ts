// Builds the engine's OfferContext from server-side facts (P4-09). The browser contributes nothing to the
// context except what the cart itself says: the `delivery_choice` cart attribute is read through the strict
// parser in offers/attributes.ts, and eligibility to buy it (ZIP in zone) is still decided here, not there.

import type {DeliveryZone} from '~/lib/delivery/zone';
import {parseOfferAttributes} from '~/lib/offers/attributes';
import type {CartLike, OfferContext} from '~/lib/offers/types';

export type ContextInput = {
  /**
   * The shopper's saved delivery ZIP, read from the signed `delivery_zip` cookie by the route
   * (delivery-runtime/zip-cookie, P3B-11). A shopper without one passes null and haul-away fails closed
   * (zip-missing).
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
