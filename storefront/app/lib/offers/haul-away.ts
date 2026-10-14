// Haul-away step (REQ-PRE-003, REQ-PROMO-003, ADR-0006, ADR-0007). Offered only when the shopper chose
// in-home delivery AND the ZIP is inside the delivery zone; quantity is capped at the admin maximum.
// This is the preventive layers (UI, server action, revalidation). The detective control for orders created
// by other means (Shopify Flow or the webhook receiver) lives outside this module.

import {isInZone} from '~/lib/delivery/zone';
import {parseZip} from '~/lib/delivery/zip';
import type {DeliveryZone} from '~/lib/delivery/zone';
import {isNonEmptyString, limitOrZero} from './helpers';
import type {PreparedCart} from './lines';
import type {
  Correction,
  DeliveryChoice,
  HaulAwayIneligibleReason,
  HaulAwayOption,
  HaulAwayRules,
  HaulAwayStep,
  OfferStepStatus,
  Violation,
} from './types';

export type HaulAwayEligibility =
  | {
      readonly eligible: true;
      readonly variantId: string;
      readonly maxPieces: number;
    }
  | {readonly eligible: false; readonly reason: HaulAwayIneligibleReason};

export type HaulAwayEligibilityInput = {
  readonly zip: string | null;
  readonly deliveryChoice: DeliveryChoice | null;
  readonly zone: DeliveryZone | null;
};

/** In-home choice AND a ZIP inside the zone AND a usable rule. Pickup is never eligible. */
export function haulAwayEligibility(
  rules: HaulAwayRules | null,
  input: HaulAwayEligibilityInput,
): HaulAwayEligibility {
  const maxPieces = rules === null ? 0 : limitOrZero(rules.maxPieces);
  if (rules === null || !isNonEmptyString(rules.variantId) || maxPieces < 1) {
    return {eligible: false, reason: 'not-configured'};
  }
  const ineligible = (
    reason: HaulAwayIneligibleReason,
  ): HaulAwayEligibility => ({
    eligible: false,
    reason,
  });

  if (input.deliveryChoice === null) return ineligible('delivery-not-chosen');
  if (input.deliveryChoice === 'pickup') return ineligible('pickup-selected');
  if (input.zone === null) return ineligible('zone-unavailable');

  const zip = parseZip(input.zip);
  if (!zip.ok) {
    return ineligible(
      input.zip === null || zip.reason === 'empty'
        ? 'zip-missing'
        : 'zip-invalid',
    );
  }
  if (!isInZone(input.zone, zip.zip)) return ineligible('outside-zone');
  return {eligible: true, variantId: rules.variantId, maxPieces};
}

/**
 * Brings a requested piece count into 0..maxPieces for the UI and for every cart action. A value that is
 * not a finite number (NaN, Infinity, text) reads as 0: an unusable request must not be granted the maximum.
 */
export function clampHaulAwayQuantity(
  requested: unknown,
  maxPieces: number,
): number {
  if (typeof requested !== 'number' || !Number.isFinite(requested)) return 0;
  const max = limitOrZero(maxPieces);
  return Math.min(Math.max(Math.floor(requested), 0), max);
}

export type HaulAwayResult = {
  readonly step: HaulAwayStep;
  readonly corrections: readonly Correction[];
  readonly violations: readonly Violation[];
};

function stepStatus(
  applies: boolean,
  currentQuantity: number,
  declined: boolean,
): OfferStepStatus {
  if (!applies) return 'not-applicable';
  if (currentQuantity > 0) return 'accepted';
  return declined ? 'declined' : 'pending';
}

export function evaluateHaulAway(
  prepared: PreparedCart,
  rules: HaulAwayRules | null,
  input: HaulAwayEligibilityInput,
  declined: boolean,
): HaulAwayResult {
  const eligibility = haulAwayEligibility(rules, input);
  const haulLines = prepared.lines.filter(({kind}) => kind === 'haul-away');
  const corrections: Correction[] = [];
  const violations: Violation[] = [];
  let currentQuantity = 0;

  if (eligibility.eligible) {
    // Earlier lines keep their pieces first, so the result depends on cart order only.
    let remaining = eligibility.maxPieces;
    for (const {line} of haulLines) {
      const kept = Math.min(line.quantity, remaining);
      remaining -= kept;
      currentQuantity += kept;
      if (kept === line.quantity) continue;
      corrections.push(
        kept > 0
          ? {
              type: 'set-quantity',
              lineId: line.id,
              quantity: kept,
              previousQuantity: line.quantity,
              reason: 'haul-away-over-max',
            }
          : {
              type: 'remove-line',
              lineId: line.id,
              reason: 'haul-away-over-max',
            },
      );
    }
  } else if (haulLines.length > 0) {
    if (eligibility.reason === 'not-configured') {
      // The offer was switched off in admin: degrade to "no offer" by dropping the line.
      for (const {line} of haulLines) {
        corrections.push({
          type: 'remove-line',
          lineId: line.id,
          reason: 'haul-away-disabled',
        });
      }
    } else {
      // The shopper (or a crafted cart) has a haul-away line they are not entitled to: refuse, do not guess.
      violations.push({
        code: 'haul-away-not-eligible',
        reason: eligibility.reason,
        lineIds: haulLines.map(({line}) => line.id),
      });
    }
  }

  const options: HaulAwayOption[] = eligibility.eligible
    ? [
        {
          variantId: eligibility.variantId,
          maxPieces: eligibility.maxPieces,
          currentQuantity,
        },
      ]
    : [];

  return {
    step: {
      id: 'haul-away',
      applies: eligibility.eligible,
      reason: eligibility.eligible ? 'eligible' : eligibility.reason,
      status: stepStatus(eligibility.eligible, currentQuantity, declined),
      options,
    },
    corrections,
    violations,
  };
}
