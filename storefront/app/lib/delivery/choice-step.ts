// Whether the pre-checkout "in-home delivery or store pickup" question applies (P5B-04, REQ-PRE-003,
// phase 5B "Delivery choice step"). The offer engine cannot ask it: haul-away stays not-applicable until a
// choice exists (offers/haul-away.ts), so the question itself is decided here, from the same ZIP, zone and
// rules the engine will use afterwards. Pure; no I/O.

import {parseZip} from './zip';
import {isInZone, type DeliveryZone} from './zone';
import type {DeliveryChoice} from '~/lib/offers/types';

export type DeliveryChoiceState =
  | {
      readonly status: 'not-applicable';
      readonly reason: 'not-configured' | 'zone-unavailable' | 'outside-zone';
    }
  /** In-home delivery cannot be offered without a ZIP; the shopper is nudged on the cart and product page. */
  | {
      readonly status: 'needs-zip';
      readonly reason: 'zip-missing' | 'zip-invalid';
    }
  | {readonly status: 'pending'}
  | {readonly status: 'answered'; readonly choice: DeliveryChoice};

export type DeliveryChoiceInput = {
  /** True when the haul-away offer is switched on and its service can be bought. The question exists only for it. */
  readonly haulAwayOffered: boolean;
  readonly zone: DeliveryZone | null;
  readonly zip: string | null;
  /** From the `delivery_choice` cart attribute, through the strict parser. */
  readonly choice: DeliveryChoice | null;
};

export function deliveryChoiceState(
  input: DeliveryChoiceInput,
): DeliveryChoiceState {
  if (!input.haulAwayOffered) {
    return {status: 'not-applicable', reason: 'not-configured'};
  }
  if (input.choice !== null) return {status: 'answered', choice: input.choice};
  if (input.zone === null) {
    return {status: 'not-applicable', reason: 'zone-unavailable'};
  }
  const zip = parseZip(input.zip);
  if (!zip.ok) {
    return {
      status: 'needs-zip',
      reason:
        input.zip === null || zip.reason === 'empty'
          ? 'zip-missing'
          : 'zip-invalid',
    };
  }
  return isInZone(input.zone, zip.zip)
    ? {status: 'pending'}
    : {status: 'not-applicable', reason: 'outside-zone'};
}

/**
 * In-home needs a ZIP inside the zone; pickup is a valid answer while the question applies. Judged without
 * the recorded answer, so changing one's mind works but a forged "in-home" for an out-of-zone or unknown
 * ZIP is refused rather than recorded.
 */
export function mayChoose(
  input: DeliveryChoiceInput,
  choice: DeliveryChoice,
): boolean {
  const state = deliveryChoiceState({...input, choice: null});
  switch (state.status) {
    case 'pending':
      return true;
    case 'needs-zip':
      return choice === 'pickup';
    case 'not-applicable':
    case 'answered':
      return false;
    default: {
      const unreachable: never = state;
      return unreachable;
    }
  }
}
