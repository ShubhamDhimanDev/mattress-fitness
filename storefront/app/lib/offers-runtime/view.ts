// What the cart UI needs from an evaluation, as plain serialisable data (P4-04, P4-07, P4-09). The engine
// returns ids; this joins them with the Shopify variant details (names, prices as Shopify states them) and
// drops anything that cannot be bought right now: "unavailable variants are never offered" (REQ-ADD-001).
// Nothing here computes a payable price, and a gift is shown as free only because the engine says the rule
// applies (its price is a Shopify discount, ADR-0003).

import type {
  AddOnCategory,
  FreeDeliveryProgress,
  OfferEvaluation,
  OfferStepStatus,
} from '~/lib/offers/types';
import type {BlockReason} from './messages';

/** Steps the cart can ask today. Haul-away is Phase 5B, accident protection is Phase 5A. */
export const SUPPORTED_STEPS = ['comfort-guarantee'] as const;
export type SupportedStepId = (typeof SUPPORTED_STEPS)[number];

export type OfferedVariant = {
  readonly variantId: string;
  readonly productTitle: string;
  readonly productHandle: string;
  /** The variant title ("Queen"); null for a single-variant product. */
  readonly variantTitle: string | null;
  /** Shopify's price for the variant, as returned; display only. */
  readonly price: {readonly amount: string; readonly currencyCode: string};
};

/** One size of a product, for the size swap on a cart line (REQ-CART-001). */
export type SizeChoice = {
  readonly variantId: string;
  readonly size: string;
  readonly available: boolean;
};

export type ComfortGuaranteeView = {
  readonly status: OfferStepStatus;
  readonly options: ReadonlyArray<{
    readonly variant: OfferedVariant;
    readonly size: string;
    readonly quantityMissing: number;
  }>;
};

export type GiftView = {
  readonly ruleId: string;
  readonly name: string;
  readonly remainingQuantity: number;
  readonly sizes: ReadonlyArray<{
    readonly size: string;
    readonly variant: OfferedVariant;
  }>;
};

export type AddOnView = {
  readonly category: AddOnCategory;
  readonly mattressLineId: string;
  readonly size: string | null;
  readonly variant: OfferedVariant;
};

export type CartOffersView = {
  /** Cart version this view describes; the newest view wins when several arrive (see useCartOffers). */
  readonly updatedAt: string | null;
  readonly freeDelivery: FreeDeliveryProgress;
  /** The first supported step the shopper still has to answer, or null. */
  readonly nextStep: SupportedStepId | null;
  readonly comfortGuarantee: ComfortGuaranteeView | null;
  readonly gifts: readonly GiftView[];
  readonly addOns: readonly AddOnView[];
  /** Cart line id -> the sizes it can be swapped to (regular lines of multi-size products only). */
  readonly lineSizes: Readonly<Record<string, readonly SizeChoice[]>>;
  /** Why the hand-off is refused; empty when it may go ahead. */
  readonly blocked: readonly BlockReason[];
  readonly notices: readonly string[];
};

/** Every variant id the evaluation wants to show, so one lookup covers the whole view. */
export function offeredVariantIds(evaluation: OfferEvaluation): string[] {
  const ids = new Set<string>();
  const [comfort] = evaluation.steps;
  for (const option of comfort.options) ids.add(option.protectorVariantId);
  for (const gift of evaluation.gifts) {
    for (const size of gift.sizes) ids.add(size.variantId);
  }
  for (const addOn of evaluation.matchingAddOns) ids.add(addOn.variantId);
  return [...ids];
}

export type BuildViewInput = {
  readonly evaluation: OfferEvaluation;
  /** Available variants only; an id missing from the map is not offered. */
  readonly variants: ReadonlyMap<string, OfferedVariant>;
  readonly updatedAt: string | null;
  readonly lineSizes: Readonly<Record<string, readonly SizeChoice[]>>;
  readonly blocked: readonly BlockReason[];
  readonly notices: readonly string[];
};

export function buildOffersView(input: BuildViewInput): CartOffersView {
  const {evaluation, variants} = input;
  const [comfort] = evaluation.steps;

  const comfortOptions = comfort.options.flatMap((option) => {
    const variant = variants.get(option.protectorVariantId);
    return variant
      ? [{variant, size: option.size, quantityMissing: option.quantityMissing}]
      : [];
  });
  // A step that cannot show anything to buy is not a step (a sold-out protector must not stall checkout).
  const comfortView: ComfortGuaranteeView | null =
    comfort.applies &&
    (comfortOptions.length > 0 || comfort.status !== 'pending')
      ? {status: comfort.status, options: comfortOptions}
      : null;
  const nextStep: SupportedStepId | null =
    comfortView?.status === 'pending' && comfortOptions.length > 0
      ? 'comfort-guarantee'
      : null;

  const gifts = evaluation.gifts.flatMap((gift) => {
    const sizes = gift.sizes.flatMap((size) => {
      const variant = variants.get(size.variantId);
      return variant ? [{size: size.size, variant}] : [];
    });
    return sizes.length > 0
      ? [
          {
            ruleId: gift.ruleId,
            name: gift.name,
            remainingQuantity: gift.remainingQuantity,
            sizes,
          },
        ]
      : [];
  });

  const addOns = evaluation.matchingAddOns.flatMap((addOn) => {
    const variant = variants.get(addOn.variantId);
    return variant
      ? [
          {
            category: addOn.category,
            mattressLineId: addOn.mattressLineId,
            size: addOn.size,
            variant,
          },
        ]
      : [];
  });

  return {
    updatedAt: input.updatedAt,
    freeDelivery: evaluation.freeDelivery,
    nextStep,
    comfortGuarantee: comfortView,
    gifts,
    addOns,
    lineSizes: input.lineSizes,
    blocked: input.blocked,
    notices: input.notices,
  };
}

/** The view of a cart that could not be checked: no offers, checkout withheld for the stated reason. */
export function unverifiedView(
  updatedAt: string | null,
  reason: BlockReason,
): CartOffersView {
  return {
    updatedAt,
    freeDelivery: {enabled: false},
    nextStep: null,
    comfortGuarantee: null,
    gifts: [],
    addOns: [],
    lineSizes: {},
    blocked: [reason],
    notices: [],
  };
}
