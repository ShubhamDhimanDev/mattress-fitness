// What the cart UI needs from an evaluation, as plain serialisable data (P4-04, P4-07, P4-09). The engine
// returns ids; this joins them with the Shopify variant details (names, prices as Shopify states them) and
// drops anything that cannot be bought right now: "unavailable variants are never offered" (REQ-ADD-001).
// Nothing here computes a payable price, and a gift is shown as free only because the engine says the rule
// applies (its price is a Shopify discount, ADR-0003).

import type {DeliveryChoiceState} from '~/lib/delivery/choice-step';
import type {
  AddOnCategory,
  DeliveryChoice,
  FreeDeliveryProgress,
  OfferEvaluation,
  OfferStepStatus,
} from '~/lib/offers/types';
import type {BlockReason} from './messages';

/**
 * Steps the pre-checkout flow can ask today, in the order they are asked. The delivery question comes before
 * haul-away because haul-away exists only for in-home delivery (P5B-04). These are the steps whose form commands
 * delivery-runtime/step-command.ts parses; accident protection (P5A-07) has its own command parser
 * (protection-command.ts) and is the LAST question, after the comfort guarantee, delivery and haul-away.
 */
export const SUPPORTED_STEPS = [
  'comfort-guarantee',
  'delivery-choice',
  'haul-away',
] as const;
export type SupportedStepId = (typeof SUPPORTED_STEPS)[number];

export const PROTECTION_STEP = 'protection' as const;
/** Every step the /checkout-steps page can show. */
export type PreCheckoutStepId = SupportedStepId | typeof PROTECTION_STEP;

/** Narrows a URL value to a step this build can show; anything else is null (never trusted, never echoed). */
export function parsePreCheckoutStepId(
  value: unknown,
): PreCheckoutStepId | null {
  if (value === PROTECTION_STEP) return PROTECTION_STEP;
  return SUPPORTED_STEPS.find((step) => step === value) ?? null;
}

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

/** The recycling and disposal service (REQ-PRE-003): one variant, its quantity is the number of pieces. */
export type HaulAwayView = {
  /** pending = not yet answered; accepted = pieces are in the cart; declined = recorded as a cart attribute. */
  readonly status: OfferStepStatus;
  readonly variant: OfferedVariant;
  readonly maxPieces: number;
  readonly currentQuantity: number;
};

/** The in-home or pickup question; present only while it is pending or already answered. */
export type DeliveryChoiceView = {
  readonly status: 'pending' | 'answered';
  readonly choice: DeliveryChoice | null;
  /** Client-approved wording per method, plain text; null when none was supplied. */
  readonly promises: {
    readonly inHome: string | null;
    readonly pickup: string | null;
  };
};

/** One plan Extend quoted for an item, as the shopper may see it. The price equals a real price-point variant. */
export type ProtectionPlanView = {
  /** Extend's plan id: the only handle the browser sends back; the server re-derives everything else. */
  readonly planId: string;
  readonly title: string;
  readonly priceCents: number;
  /** Months of coverage, when Extend states a term. */
  readonly termMonths: number | null;
  /** https link to the plan details and terms (REQ-EXT-004). */
  readonly termsUrl: string;
  readonly recommended: boolean;
};

export type ProtectionLineView = {
  readonly lineId: string;
  readonly productTitle: string;
  readonly variantTitle: string | null;
  readonly quantity: number;
  /** Units of this line that have no coverage yet; an accept covers exactly these. */
  readonly uncoveredQuantity: number;
  readonly plans: readonly ProtectionPlanView[];
};

/** Extend accident protection per uncovered eligible cart line (REQ-PRE-004). Present only with the Extend flag on. */
export type AccidentProtectionView = {
  readonly status: OfferStepStatus;
  readonly lines: readonly ProtectionLineView[];
  /** Extend's branding rule (REQ-EXT-004): shown next to every offer. */
  readonly poweredBy: 'Extend';
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
  readonly nextStep: PreCheckoutStepId | null;
  readonly comfortGuarantee: ComfortGuaranteeView | null;
  readonly deliveryChoice: DeliveryChoiceView | null;
  readonly haulAway: HaulAwayView | null;
  readonly accidentProtection: AccidentProtectionView | null;
  readonly gifts: readonly GiftView[];
  readonly addOns: readonly AddOnView[];
  /** Cart line id -> the sizes it can be swapped to (regular lines of multi-size products only). */
  readonly lineSizes: Readonly<Record<string, readonly SizeChoice[]>>;
  /** Why the hand-off is refused; empty when it may go ahead. */
  readonly blocked: readonly BlockReason[];
  readonly notices: readonly string[];
};

/**
 * Every variant id the evaluation wants to show, so one lookup covers the whole view. `extraIds` are
 * variants the view needs that the evaluation cannot name yet (the haul-away service before in-home is chosen).
 */
export function offeredVariantIds(
  evaluation: OfferEvaluation,
  extraIds: readonly string[] = [],
): string[] {
  const ids = new Set<string>(extraIds);
  const [comfort, haulAway] = evaluation.steps;
  for (const option of comfort.options) ids.add(option.protectorVariantId);
  for (const option of haulAway.options) ids.add(option.variantId);
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
  /** The delivery question, decided from ZIP, zone and rules by the server (choice-step.ts). */
  readonly deliveryChoice: DeliveryChoiceState;
  readonly promises: DeliveryChoiceView['promises'];
  /** Server data for the accident-protection step; absent when Extend is off (the view then carries no protection). */
  readonly protection?: {
    readonly plansByLineId: ReadonlyMap<string, readonly ProtectionPlanView[]>;
    readonly titles: ReadonlyMap<
      string,
      {readonly productTitle: string; readonly variantTitle: string | null}
    >;
  };
};

function protectionViewOf(
  input: BuildViewInput,
): AccidentProtectionView | null {
  const [, , accident] = input.evaluation.steps;
  const lines = accident.options.flatMap((option) => {
    const plans = input.protection?.plansByLineId.get(option.lineId) ?? [];
    const title = input.protection?.titles.get(option.lineId);
    if (plans.length === 0 || !title) return [];
    return [
      {
        lineId: option.lineId,
        productTitle: title.productTitle,
        variantTitle: title.variantTitle,
        quantity: option.quantity,
        uncoveredQuantity: option.uncoveredQuantity,
        // Field by field: nothing else Extend sent (an image address, a raw payload) travels to the browser.
        plans: plans.map((plan) => ({
          planId: plan.planId,
          title: plan.title,
          priceCents: plan.priceCents,
          termMonths: plan.termMonths,
          termsUrl: plan.termsUrl,
          recommended: plan.recommended,
        })),
      },
    ];
  });
  // Like the protector: a step with nothing to buy is not a step, so it can never stall checkout.
  return accident.applies && (lines.length > 0 || accident.status !== 'pending')
    ? {status: accident.status, lines, poweredBy: 'Extend'}
    : null;
}

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
  const [, haulAway] = evaluation.steps;
  const haulOption = haulAway.options[0];
  const haulVariant = haulOption
    ? variants.get(haulOption.variantId)
    : undefined;
  // Like the protector: a service that cannot be bought now (sold out, unreadable) is not a step.
  const haulAwayView: HaulAwayView | null =
    haulAway.applies && haulOption && haulVariant
      ? {
          status: haulAway.status,
          variant: haulVariant,
          maxPieces: haulOption.maxPieces,
          currentQuantity: haulOption.currentQuantity,
        }
      : null;

  const deliveryState = input.deliveryChoice;
  const deliveryView: DeliveryChoiceView | null =
    deliveryState.status === 'pending' || deliveryState.status === 'answered'
      ? {
          status: deliveryState.status,
          choice:
            deliveryState.status === 'answered' ? deliveryState.choice : null,
          promises: input.promises,
        }
      : null;

  // First unanswered question wins, in the order the shopper meets them.
  const protectionView = protectionViewOf(input);
  const nextStep: PreCheckoutStepId | null =
    comfortView?.status === 'pending' && comfortOptions.length > 0
      ? 'comfort-guarantee'
      : deliveryView?.status === 'pending'
        ? 'delivery-choice'
        : haulAwayView?.status === 'pending'
          ? 'haul-away'
          : protectionView?.status === 'pending' &&
              protectionView.lines.length > 0
            ? PROTECTION_STEP
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
    deliveryChoice: deliveryView,
    haulAway: haulAwayView,
    accidentProtection: protectionView,
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
    deliveryChoice: null,
    haulAway: null,
    accidentProtection: null,
    gifts: [],
    addOns: [],
    lineSizes: {},
    blocked: [reason],
    notices: [],
  };
}
