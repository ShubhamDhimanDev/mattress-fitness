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
  readonly code: Violation['code'] | 'unverified' | 'gift-not-free';
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
    case 'coverage-price-mismatch':
      return 'A protection plan was removed because its price no longer matches the item it covers. You can add protection again.';
    case 'orphan-coverage':
      return 'A protection plan was removed because it is not linked to an item it can cover, or protection is not available right now.';
    case 'coverage-exceeds-item':
      return 'A protection plan was adjusted because it has to stay linked to the item it covers.';
    default: {
      const unreachable: never = reason;
      return unreachable;
    }
  }
}

/**
 * The offer rules (or the facts they need) could not be loaded, so the cart cannot be judged. Checkout is
 * paused rather than handed on unchecked: a gift, protector or service line would otherwise pass as an
 * ordinary line (ADR-0006: our storefront path fails closed; direct Storefront API carts are detective only).
 */
export const OFFERS_UNAVAILABLE_REASON: BlockReason = {
  code: 'unverified',
  message:
    'We cannot confirm the offers on your cart right now, so checkout is paused. Please try again in a moment.',
  lineIds: [],
};

/** Why a delivery or haul-away step could not be applied (P5B-04). Fixed text; nothing from the request is echoed. */
export type DeliveryStepFailure =
  | 'delivery-choice-invalid'
  | 'delivery-choice-unavailable'
  | 'quantity-invalid'
  | 'haul-away-unavailable'
  | 'haul-away-in-cart';

export const DELIVERY_STEP_FAILURE_TEXT: Record<DeliveryStepFailure, string> = {
  'delivery-choice-invalid': 'Choose in-home delivery or store pickup.',
  'delivery-choice-unavailable':
    'In-home delivery is not available for your ZIP code. You can choose store pickup or continue to checkout.',
  'quantity-invalid': 'Choose how many pieces you would like us to take away.',
  'haul-away-in-cart':
    'Recycling and disposal is already in your cart. Remove it from your cart first if you no longer want it.',
  'haul-away-unavailable':
    'Recycling and disposal is not available right now. You can continue to checkout without it.',
};

/**
 * Why adding or declining Extend protection could not be applied (P5A-05, P5A-07). Fixed text; nothing from the request
 * is echoed. Wording is placeholder copy until the client approves it (Q-005, CLR-010). Every code leaves the shopper
 * able to continue without protection.
 */
export type ProtectionStepFailure =
  | 'protection-unavailable'
  | 'protection-plan-unknown'
  | 'protection-not-allowed'
  | 'protection-not-offered'
  | 'protection-add-failed'
  | 'protection-partial';

export const PROTECTION_STEP_FAILURE_TEXT: Record<
  ProtectionStepFailure,
  string
> = {
  'protection-unavailable':
    'Protection is not available for this item right now. Your cart was not changed. You can add the item without protection.',
  'protection-plan-unknown':
    'That protection plan is no longer offered for this item. Your cart was not changed. Please choose again or continue without protection.',
  'protection-not-allowed': 'Protection cannot be added to that item.',
  'protection-not-offered':
    'Protection is not being offered on your cart right now. You can continue to checkout.',
  'protection-add-failed':
    'We could not add protection to your cart. Your cart was not changed. You can try again or continue without it.',
  'protection-partial':
    'Your item was added, but we could not add its protection plan. You can add protection from your cart or continue without it.',
};

/**
 * A gift line that Shopify does not price at 0 (REQ-PROMO-001, T-02): the promotion that makes it a gift is not applying,
 * so the shopper would pay for it. Checkout is paused until the line is removed; the line stays so the shopper can see it.
 */
export function giftNotFreeReason(lineIds: readonly string[]): BlockReason {
  return {
    code: 'gift-not-free',
    message:
      'A gift in your cart is not showing its promotion price right now, so checkout is paused. Remove the gift to continue, or try again in a moment.',
    lineIds,
  };
}

/** Why adding a gift, add-on or bundle from the cart picker could not be applied (P4-04 to P4-06). Fixed text; nothing from the request is echoed. */
export type PickerStepFailure =
  | 'gift-not-offered'
  | 'gift-choice-invalid'
  | 'addon-not-offered'
  | 'addon-already-in-cart'
  | 'cart-changed'
  | 'bundle-not-offered'
  | 'bundle-partial'
  | 'bundle-add-failed';

export const PICKER_STEP_FAILURE_TEXT: Record<PickerStepFailure, string> = {
  'gift-not-offered': 'That gift is not available on your cart right now.',
  'gift-choice-invalid': 'Choose one of the gifts shown.',
  'cart-changed':
    'Your cart changed while you were choosing, for example in another tab. Nothing was added. Please check your cart and try again.',
  'addon-not-offered': 'That item is not offered for your cart right now.',
  'addon-already-in-cart':
    'That item and its mattress are already in your cart. You can change the quantity in your cart.',
  'bundle-not-offered': 'That set is not available on your cart right now.',
  'bundle-partial':
    'Some items in the set could not be added. Please check your cart or try again.',
  'bundle-add-failed':
    'We could not add the set to your cart. Your cart was not changed. You can try again or continue without it.',
};

/**
 * Wording for the cart pickers (gift, add-ons, bundle). Placeholder copy until the client approves it (CLR-010, CLR-011).
 * Deliberately no price claim: a gift or bundle price is Shopify's discount and is shown only as Shopify returns it on
 * the cart line.
 */
export const PICKER_COPY = {
  region: 'Offers for your cart',
  gift: {
    badge: 'Gift offer',
    legend: 'Choose your gift',
    help: 'Choose one. The store applies the promotion and shows the final price on the cart line.',
    add: 'Add gift to cart',
    adding: 'Adding',
  },
  addOns: {
    heading: 'Goes with your mattress',
    add: 'Add',
    adding: 'Adding',
    categories: {
      foundation: 'Matching foundation',
      protector: 'Matching protector',
      pillow: 'Matching pillow',
      bedding: 'Matching bedding',
    },
  },
  bundle: {
    heading: 'Complete your set',
    help: 'Any saving is applied by the store and shown on your cart lines.',
    add: 'Add missing items',
    adding: 'Adding',
    completeHeading: 'Set complete',
  },
} as const;

/**
 * Wording for the product page's add-on slot (P4-03, REQ-ADD-001). Placeholder copy until the client approves it
 * (CLR-010, CLR-011). No price claim: every price shown is Shopify's, and the item is an ordinary cart line.
 */
export const PRODUCT_ADDON_COPY = {
  heading: 'Foundations, bases and frames',
  help: 'Sized for the mattress size you selected. Adding one also puts this mattress in your cart if it is not there yet.',
  loading: 'Loading foundations, bases and frames for this size',
  add: 'Add with mattress',
  adding: 'Adding',
  added: 'Added to cart',
  viewCart: 'View cart',
  error: 'We could not load the matching foundations, bases and frames.',
  retry: 'Try again',
  soldOutMattress: 'Available again when this mattress size is back in stock.',
} as const;
