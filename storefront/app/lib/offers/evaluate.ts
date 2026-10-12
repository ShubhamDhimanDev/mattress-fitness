// The single offer engine (ADR-0003, P4-01). The cart UI calls it to decide what to show; the server calls it
// again against the real Shopify cart before the checkout hand-off and applies the corrections or refuses
// on a violation (REQ-PRE-006). Same function, same answer, so display and enforcement cannot drift.
//
// Contract:
// - Pure and deterministic: no I/O, no clock, input never mutated.
// - It decides which LINES should exist. It never computes a payable price; gift and bundle prices are
//   Shopify discounts and the subtotal is Shopify's.
// - Corrections only lower a quantity or remove a line. Applying them and evaluating again returns no
//   corrections (idempotent). Violations are not repaired here: the hand-off is refused.
// - Rules are independent: each line has one kind (lines.ts) and each rule reads only ordinary lines,
//   except coverage, which is evaluated last against the quantities left after the other corrections.

import {matchingAddOnOffers} from './addons';
import {parseOfferAttributes} from './attributes';
import {evaluateComfortGuarantee} from './comfort';
import {freeDeliveryProgress} from './free-delivery';
import {evaluateGifts} from './gifts';
import {evaluateHaulAway} from './haul-away';
import {prepareCart} from './lines';
import type {PreparedCart} from './lines';
import {evaluateAccidentProtection} from './protection';
import type {
  CartLike,
  Correction,
  OfferContext,
  OfferEvaluation,
  OfferRules,
  OfferStep,
} from './types';

function quantitiesAfter(
  prepared: PreparedCart,
  corrections: readonly Correction[],
): Map<string, number> {
  const quantities = new Map<string, number>();
  for (const {line} of prepared.lines) quantities.set(line.id, line.quantity);
  for (const correction of corrections) {
    quantities.set(
      correction.lineId,
      correction.type === 'remove-line' ? 0 : correction.quantity,
    );
  }
  return quantities;
}

export function evaluateOffers(
  cart: CartLike,
  rules: OfferRules,
  context: OfferContext,
): OfferEvaluation {
  const prepared = prepareCart(cart, rules);
  const {declined} = parseOfferAttributes(cart.attributes);

  const comfort = evaluateComfortGuarantee(
    prepared,
    rules.comfortGuarantee,
    declined['comfort-guarantee'],
  );
  const haulAway = evaluateHaulAway(
    prepared,
    rules.haulAway,
    context,
    declined['haul-away'],
  );
  const gifts = evaluateGifts(prepared, rules.gifts);

  const independent = [
    ...comfort.corrections,
    ...haulAway.corrections,
    ...gifts.corrections,
  ];
  const protection = evaluateAccidentProtection(
    prepared,
    quantitiesAfter(prepared, independent),
    context.protectionEligibleLineIds,
    declined['accident-protection'],
  );

  return {
    steps: [comfort.step, haulAway.step, protection.step],
    corrections: [...independent, ...protection.corrections],
    violations: [...prepared.violations, ...haulAway.violations],
    freeDelivery: freeDeliveryProgress(rules.freeDelivery, cart.subtotalCents),
    gifts: gifts.offers,
    matchingAddOns: matchingAddOnOffers(prepared, rules.matchingAddOns),
  };
}

/** Steps the shopper still has to answer, in checkout order (REQ-PRE-001: skipped when not applicable). */
export function pendingSteps(evaluation: OfferEvaluation): OfferStep[] {
  return evaluation.steps.filter((step) => step.status === 'pending');
}

/**
 * What the server does with the evaluation before the hand-off: refuse (violations), repair and re-check
 * (corrections), or go ahead. Pending steps never block the hand-off; the shopper may skip an offer.
 */
export type RevalidationOutcome = 'ok' | 'corrected' | 'rejected';

export function revalidationOutcome(
  evaluation: OfferEvaluation,
): RevalidationOutcome {
  if (evaluation.violations.length > 0) return 'rejected';
  return evaluation.corrections.length > 0 ? 'corrected' : 'ok';
}
