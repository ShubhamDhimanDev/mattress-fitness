// SERVER ONLY. The delivery-choice and haul-away steps of the pre-checkout flow (P5B-04, REQ-PRE-003,
// REQ-PRE-005, REQ-PRE-006). Like acceptComfortGuarantee, nothing but the shopper's intent comes from the
// browser:
//  - the variant is the one in the server's offer rules;
//  - the number of pieces is the shopper's request clamped to the maximum in those rules;
//  - whether in-home delivery can be recorded is decided from the saved ZIP and the zone;
//  - every answer is written as the documented cart attribute (delivery_choice, offer_declined_haul_away).
// The shopper can always decline: both steps have a way on that adds nothing. The caller revalidates.

import {mayChoose} from '~/lib/delivery/choice-step';
import {
  clearDeclineAttribute,
  declineAttribute,
  deliveryChoiceAttribute,
} from '~/lib/offers/attributes';
import {clampHaulAwayQuantity} from '~/lib/offers/haul-away';
import {
  failed,
  rejectedStep,
  revalidateCartOffers,
  type OfferRuntime,
  type StepChangeResult,
} from '~/lib/offers-runtime/server';
import {loadDeliveryZone, loadHaulAwayVariantId} from './zone';
import {withAttribute} from '~/lib/offers-runtime/step-attributes';
import type {CartApiQueryFragment} from 'storefrontapi.generated';
import type {DeliveryChoice} from '~/lib/offers/types';

/** Cart lines that are the haul-away service. The role comes from the server's rule variant, never from the cart. */
function haulAwayLineIds(
  cart: CartApiQueryFragment,
  variantId: string | null,
): string[] {
  if (variantId === null) return [];
  return cart.lines.nodes
    .filter((line) => line.merchandise?.id === variantId)
    .map((line) => line.id);
}

/**
 * Records in-home delivery or store pickup. In-home is recorded only when the saved ZIP is inside the zone
 * and a haul-away service exists to follow it; a forged request for anything else is refused, not stored.
 *
 * The question is only asked of a shopper whose saved ZIP is inside the zone (a shopper with no ZIP is not
 * asked here; they enter one through the cart or product page control and are asked on the next visit), so
 * "applies" below means pending or already answered. Switching to pickup removes any haul-away service
 * already added: it is for in-home delivery only, and leaving the line would block checkout. The removal
 * comes BEFORE the attribute write, so a failure in between leaves a shopper who is still "in-home" with
 * nothing blocking, never a pickup order with a service line.
 */
export async function chooseDelivery(
  runtime: OfferRuntime,
  current: CartApiQueryFragment | null,
  choice: DeliveryChoice,
): Promise<StepChangeResult> {
  const offers = await revalidateCartOffers(runtime, current);
  const cart = offers.cart;
  if (!cart || cart.lines.nodes.length === 0) return rejectedStep('cart-gone');
  // A cart that could not be verified offers no questions at all.
  if (
    !offers.view ||
    offers.view.blocked.some((r) => r.code === 'unverified')
  ) {
    return rejectedStep('unverified');
  }
  const applies = offers.view.deliveryChoice !== null;
  const zone = loadDeliveryZone(runtime.env);
  const allowed =
    applies &&
    mayChoose(
      {
        haulAwayOffered: true,
        zone,
        zip: runtime.zip ?? null,
        choice: null,
      },
      choice,
    );
  if (!allowed) return rejectedStep('delivery-choice-unavailable');
  if (choice === 'pickup') {
    const haulIds = haulAwayLineIds(cart, loadHaulAwayVariantId(runtime.env));
    if (haulIds.length > 0) {
      const removed = await runtime.cart.removeLines(haulIds);
      if (failed(removed)) return rejectedStep('record-failed');
    }
  }
  const written = await runtime.cart.updateAttributes(
    withAttribute(cart.attributes, deliveryChoiceAttribute(choice)),
  );
  return failed(written)
    ? rejectedStep('record-failed')
    : {status: 'ok', result: written};
}

/**
 * Adds the recycling and disposal service. The step must be pending in the engine's own view (eligible,
 * nothing in the cart yet, not already answered), the variant is the rule's, and the quantity is the request
 * capped at the rule's maximum: asking for 99 gets the maximum, asking for nothing readable gets a refusal.
 * As with the comfort guarantee the decline is reset FIRST, so a failed add never leaves a service line
 * next to a recorded decline.
 */
export async function acceptHaulAway(
  runtime: OfferRuntime,
  current: CartApiQueryFragment | null,
  requestedPieces: number,
): Promise<StepChangeResult> {
  const offers = await revalidateCartOffers(runtime, current);
  const haul = offers.view?.haulAway ?? null;
  if (!offers.cart || offers.cart.lines.nodes.length === 0) {
    return rejectedStep('cart-gone');
  }
  if (!haul || haul.currentQuantity > 0) {
    return rejectedStep('haul-away-unavailable');
  }
  const pieces = clampHaulAwayQuantity(requestedPieces, haul.maxPieces);
  if (pieces < 1) return rejectedStep('quantity-invalid');
  const reset = await runtime.cart.updateAttributes(
    withAttribute(offers.cart.attributes, clearDeclineAttribute('haul-away')),
  );
  if (failed(reset)) return rejectedStep('record-failed');
  const added = await runtime.cart.addLines([
    {merchandiseId: haul.variant.variantId, quantity: pieces},
  ]);
  return failed(added)
    ? rejectedStep('add-failed')
    : {status: 'ok', result: added};
}

/**
 * Declining is recorded as a cart attribute that becomes an order note attribute (REQ-PRE-005). It is only
 * recorded for a step that was actually put to the shopper: in-home chosen, a ZIP inside the zone, the
 * service offered and bought nowhere yet. Anything else gets a known code, so a forged post cannot write a
 * decline for an offer that never applied, and a decline never sits next to a service line.
 */
export async function declineHaulAway(
  runtime: OfferRuntime,
  current: CartApiQueryFragment | null,
): Promise<StepChangeResult> {
  if (!current || current.lines.nodes.length === 0) {
    return rejectedStep('cart-gone');
  }
  const offers = await revalidateCartOffers(runtime, current);
  const cart = offers.cart;
  if (!cart || cart.lines.nodes.length === 0) return rejectedStep('cart-gone');
  const haul = offers.view?.haulAway ?? null;
  if (haul === null) return rejectedStep('haul-away-unavailable');
  // Mirror of acceptHaulAway: a recorded decline next to a service line would contradict the order.
  if (
    haul.currentQuantity > 0 ||
    haulAwayLineIds(cart, loadHaulAwayVariantId(runtime.env)).length > 0
  ) {
    return rejectedStep('haul-away-in-cart');
  }
  const written = await runtime.cart.updateAttributes(
    withAttribute(cart.attributes, declineAttribute('haul-away')),
  );
  return failed(written)
    ? rejectedStep('record-failed')
    : {status: 'ok', result: written};
}
