// Shopper-facing wording for what the revalidation did or refused (REQ-PRE-006: "corrected or rejected").
// Plain text only, rendered escaped. The wording is placeholder copy until the client approves it.

import type {Correction, Violation} from '~/lib/offers/types';

type HaulAwayViolation = Extract<Violation, {code: 'haul-away-not-eligible'}>;

const HAUL_AWAY_BLOCKED: Record<HaulAwayViolation['reason'], string> = {
  'delivery-not-chosen':
    'The recycling and disposal service goes with in-home delivery, and no delivery choice is set. Remove the service to continue.',
  'pickup-selected':
    'Recycling and disposal is not available with store pickup. Remove the service to continue.',
  'zip-missing':
    'We need a delivery ZIP code inside our delivery area to offer recycling and disposal. Remove the service to continue.',
  'zip-invalid':
    'The delivery ZIP code is not valid, so recycling and disposal cannot be offered. Remove the service to continue.',
  'zone-unavailable':
    'We could not check the delivery area just now, so recycling and disposal cannot be offered. Remove the service to continue.',
  'outside-zone':
    'Recycling and disposal is not available for your delivery ZIP code. Remove the service to continue.',
};

export type BlockReason = {
  readonly code: Violation['code'] | 'unverified';
  readonly message: string;
  /** Cart lines the message is about, so the shopper can find and remove them. */
  readonly lineIds: readonly string[];
};

export const UNVERIFIED_REASON: BlockReason = {
  code: 'unverified',
  message:
    'We could not finish checking your cart. Please try again in a moment.',
  lineIds: [],
};

export function describeViolation(violation: Violation): BlockReason {
  switch (violation.code) {
    case 'invalid-quantity':
      return {
        code: violation.code,
        message:
          'One item in your cart has a quantity we cannot check. Remove it and add it again.',
        lineIds: [violation.lineId],
      };
    case 'duplicate-line-id':
      return {
        code: violation.code,
        message:
          'We could not verify your cart. Reload the page, and if this continues remove the item and add it again.',
        lineIds: [violation.lineId],
      };
    case 'haul-away-not-eligible':
      return {
        code: violation.code,
        message: HAUL_AWAY_BLOCKED[violation.reason],
        lineIds: violation.lineIds,
      };
    default: {
      const unreachable: never = violation;
      return unreachable;
    }
  }
}

/** One short notice per correction kind (not per line), so a repaired cart explains itself once. */
export function describeCorrections(
  corrections: readonly Correction[],
): string[] {
  const notices = new Set<string>();
  for (const correction of corrections) {
    notices.add(describeReason(correction.reason));
  }
  return [...notices];
}

function describeReason(reason: Correction['reason']): string {
  switch (reason) {
    case 'orphan-gift':
      return 'A free gift was removed because the item it came with is no longer in your cart.';
    case 'gift-not-offered':
      return 'A free gift was removed because that offer is no longer available.';
    case 'duplicate-gift':
    case 'gift-over-limit':
      return 'A free gift was adjusted: each offer includes a limited number of gifts.';
    case 'protector-without-mattress':
      return 'A mattress protector was removed because the mattress it goes with is no longer in your cart.';
    case 'wrong-size-protector':
      return 'A mattress protector was removed because it did not match the size of your mattress.';
    case 'protector-exceeds-mattresses':
      return 'A mattress protector was adjusted to match the number of mattresses in your cart.';
    case 'haul-away-disabled':
      return 'The recycling and disposal service was removed because it is not available right now.';
    case 'haul-away-over-max':
      return 'The recycling and disposal service was reduced to the maximum number of pieces we allow.';
    case 'orphan-coverage':
    case 'coverage-exceeds-item':
      return 'A protection plan was adjusted because it has to stay linked to the item it covers.';
    default: {
      const unreachable: never = reason;
      return unreachable;
    }
  }
}
