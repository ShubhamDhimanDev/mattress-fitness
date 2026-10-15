// Types for the offer engine (ADR-0003, ADR-0006, P4-01). Everything here is plain data: the engine never
// computes a payable price, it only decides which lines should exist and what to correct or reject.
// Prices come from Shopify (cart cost, automatic discounts); money is integer cents (NFR-008).

import type {DeliveryZone} from '~/lib/delivery/zone';

export const LINE_ROLES = [
  'mattress',
  'foundation',
  'protector',
  'pillow',
  'bedding',
  'gift',
  'haul-away',
  'coverage',
] as const;
export type LineRole = (typeof LINE_ROLES)[number];

export type DeliveryChoice = 'in-home' | 'pickup';

/** The offer steps a shopper can decline; the declines are recorded as cart attributes (REQ-PRE-005). */
export type DeclinableOffer =
  'comfort-guarantee' | 'haul-away' | 'accident-protection';

// ---------------------------------------------------------------------------------------------------
// Cart
// ---------------------------------------------------------------------------------------------------

export type CartLineLike = {
  /** Shopify cart line id. */
  readonly id: string;
  readonly variantId: string;
  readonly productId: string;
  readonly quantity: number;
  /** Line attributes (properties); passed through, the engine does not trust them. */
  readonly attributes: Readonly<Record<string, string>>;
  /**
   * Set by the server from Shopify data (product type, tags). Only a hint: the engine recognises gifts,
   * haul-away and comfort protectors by variant id from the rules, and uses the role for lines the rules
   * no longer know (an expired gift) and for Extend coverage (role 'coverage', set by the Extend adapter).
   */
  readonly role?: LineRole | null;
  /** Value of the Size option, or null when the product has none. */
  readonly size: string | null;
  /** Nested cart line parent (F-26), or a parent mapped from a line-attribute pair if V-02 rules nesting out. */
  readonly parentLineId: string | null;
  /**
   * Shopify's unit price of the variant in cents, set by the server from the cart it just read (never by the browser).
   * Only coverage lines need it: their price must be one of the plans quoted for the item they hang off.
   */
  readonly unitPriceCents?: number;
  /** Collections of the line's product, for gift rules that qualify by collection. */
  readonly collectionIds?: readonly string[];
};

export type CartLike = {
  readonly lines: readonly CartLineLike[];
  /** Cart attributes as written by us or by a shopper; only the documented keys are read (attributes.ts). */
  readonly attributes?: Readonly<Record<string, string>>;
  /** Shopify's cart subtotal in cents (never computed here), used for the free-delivery progress. */
  readonly subtotalCents: number;
};

// ---------------------------------------------------------------------------------------------------
// Rules (built from Shopify metaobjects and product relations; changing them needs no deploy)
// ---------------------------------------------------------------------------------------------------

export type GiftRule = {
  readonly id: string;
  /** Promotion name shown on the $0 gift line (REQ-PROMO-001). */
  readonly name: string;
  readonly qualifyingProductIds: readonly string[];
  readonly qualifyingCollectionIds: readonly string[];
  readonly giftVariantIdsBySize: Readonly<Record<string, string>>;
  /**
   * Gift units allowed per order for this rule. It must equal the "get" quantity of the matching Shopify
   * discount: any unit above it would be charged at full price, so the engine never lets it stay.
   */
  readonly maxQuantity: number;
};

export type BundleMemberRule = {
  readonly productId: string;
  readonly quantity: number;
  readonly variants:
    | {readonly type: 'single'; readonly variantId: string}
    | {
        readonly type: 'by-size';
        readonly variantIdBySize: Readonly<Record<string, string>>;
      };
};

export type BundleRule = {
  readonly id: string;
  readonly name: string;
  /** The product whose page shows the bundle; the shopper's selected variant is the anchor line. */
  readonly anchorProductId: string;
  readonly members: readonly BundleMemberRule[];
  /**
   * The title of the Shopify AUTOMATIC discount that gives this bundle its saving. Only an allocation with this title
   * counts as the bundle's saving in the cart (REQ-PROMO-002); without it no saving figure is shown, because a code or an
   * unrelated sale on the same lines would otherwise read as the bundle saving.
   */
  readonly discountTitle?: string;
};

export type ComfortGuaranteeRules = {
  readonly qualifyingProductIds: readonly string[];
  readonly protectorVariantIdBySize: Readonly<Record<string, string>>;
};

export type AddOnRelation = {
  readonly mattressProductId: string;
  /** null = the add-on fits every size of that mattress. */
  readonly size: string | null;
  readonly productId: string;
  readonly variantId: string;
};

export type MatchingAddOnRules = {
  readonly foundations: readonly AddOnRelation[];
  readonly protectors: readonly AddOnRelation[];
  readonly pillows: readonly AddOnRelation[];
  readonly bedding: readonly AddOnRelation[];
};

export type HaulAwayRules = {
  /** The single "Recycle and disposal service" variant; its quantity is the number of pieces. */
  readonly variantId: string;
  readonly maxPieces: number;
};

export type FreeDeliveryRules = {readonly thresholdCents: number};

export type OfferRules = {
  readonly gifts: readonly GiftRule[];
  readonly bundles: readonly BundleRule[];
  /** null = the comfort-guarantee offer is switched off. */
  readonly comfortGuarantee: ComfortGuaranteeRules | null;
  readonly matchingAddOns: MatchingAddOnRules;
  /** null = the haul-away offer is switched off. */
  readonly haulAway: HaulAwayRules | null;
  /** null = no free-delivery message. */
  readonly freeDelivery: FreeDeliveryRules | null;
};

/** "No offers": what the storefront degrades to when rules cannot be loaded or every offer is disabled. */
export const EMPTY_OFFER_RULES: OfferRules = {
  gifts: [],
  bundles: [],
  comfortGuarantee: null,
  matchingAddOns: {foundations: [], protectors: [], pillows: [], bedding: []},
  haulAway: null,
  freeDelivery: null,
};

export type OfferContext = {
  /** The shopper's ZIP as stored (cookie, buyer identity); the engine validates it. */
  readonly zip: string | null;
  /** From the delivery_choice cart attribute (parseOfferAttributes). */
  readonly deliveryChoice: DeliveryChoice | null;
  readonly zone: DeliveryZone | null;
  /** Cart lines the Extend adapter says can be covered; empty when Extend is off or unavailable. */
  readonly protectionEligibleLineIds: readonly string[];
  /**
   * Eligible line id -> the plan prices (cents) Extend quoted for it. A coverage line under that parent whose own price is
   * not in the list is removed: the price-point SKU must equal a quoted plan (ADR-0009 decision 1), and a cart built
   * through our own endpoints could otherwise pair a cheap SKU with an expensive item. A parent with no entry (Extend
   * unavailable, or not judged) is not price-checked here; the order sync cross-checks it later.
   */
  readonly coveragePlanPricesByLineId?: ReadonlyMap<string, readonly number[]>;
};

// ---------------------------------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------------------------------

/**
 * not-applicable: the offer does not apply to this cart.
 * pending: applies and the shopper has not answered; accepted: nothing left to offer;
 * declined: the shopper declined (recorded as a cart attribute).
 */
export type OfferStepStatus =
  'not-applicable' | 'pending' | 'accepted' | 'declined';

export type ComfortGuaranteeOption = {
  readonly protectorVariantId: string;
  readonly size: string;
  readonly mattressLineIds: readonly string[];
  /** Protectors still to add: one per qualifying mattress of this size. */
  readonly quantityMissing: number;
};

export type ComfortGuaranteeStep = {
  readonly id: 'comfort-guarantee';
  readonly applies: boolean;
  readonly reason:
    | 'qualifying-mattress-in-cart'
    | 'not-configured'
    | 'no-qualifying-mattress'
    | 'no-protector-for-size';
  readonly status: OfferStepStatus;
  /** What is still missing; empty once every qualifying mattress has its protector. */
  readonly options: readonly ComfortGuaranteeOption[];
};

export type HaulAwayIneligibleReason =
  | 'not-configured'
  | 'delivery-not-chosen'
  | 'pickup-selected'
  | 'zip-missing'
  | 'zip-invalid'
  | 'zone-unavailable'
  | 'outside-zone';

export type HaulAwayOption = {
  readonly variantId: string;
  readonly maxPieces: number;
  /** Pieces already in the cart after corrections. */
  readonly currentQuantity: number;
};

export type HaulAwayStep = {
  readonly id: 'haul-away';
  readonly applies: boolean;
  readonly reason: 'eligible' | HaulAwayIneligibleReason;
  readonly status: OfferStepStatus;
  /** One quantity picker (0 to maxPieces) when the step applies. */
  readonly options: readonly HaulAwayOption[];
};

export type AccidentProtectionOption = {
  readonly lineId: string;
  readonly quantity: number;
  readonly uncoveredQuantity: number;
};

export type AccidentProtectionStep = {
  readonly id: 'accident-protection';
  readonly applies: boolean;
  readonly reason: 'eligible-items-in-cart' | 'no-eligible-items';
  readonly status: OfferStepStatus;
  /** Eligible lines that still have units without coverage. */
  readonly options: readonly AccidentProtectionOption[];
};

export type OfferStep =
  ComfortGuaranteeStep | HaulAwayStep | AccidentProtectionStep;

export type RemoveReason =
  | 'orphan-gift'
  | 'duplicate-gift'
  | 'gift-not-offered'
  | 'protector-without-mattress'
  | 'wrong-size-protector'
  | 'protector-exceeds-mattresses'
  | 'haul-away-disabled'
  | 'haul-away-over-max'
  | 'orphan-coverage'
  | 'coverage-exceeds-item'
  | 'coverage-price-mismatch';

export type SetQuantityReason =
  | 'gift-over-limit'
  | 'protector-exceeds-mattresses'
  | 'haul-away-over-max'
  | 'coverage-exceeds-item';

/** A safe repair. Corrections only ever lower a quantity or remove a line; they never add or raise. */
export type Correction =
  | {
      readonly type: 'remove-line';
      readonly lineId: string;
      readonly reason: RemoveReason;
    }
  | {
      readonly type: 'set-quantity';
      readonly lineId: string;
      /** The new quantity: an integer from 1 up to previousQuantity minus 1. */
      readonly quantity: number;
      readonly previousQuantity: number;
      readonly reason: SetQuantityReason;
    };

/** A cart that must be refused before the hand-off; the server returns the shopper to the cart. */
export type Violation =
  | {readonly code: 'invalid-quantity'; readonly lineId: string}
  | {readonly code: 'duplicate-line-id'; readonly lineId: string}
  | {
      readonly code: 'haul-away-not-eligible';
      readonly reason: Exclude<HaulAwayIneligibleReason, 'not-configured'>;
      readonly lineIds: readonly string[];
    };

export type FreeDeliveryProgress =
  | {readonly enabled: false}
  | {
      readonly enabled: true;
      readonly thresholdCents: number;
      readonly subtotalCents: number;
      readonly remainingCents: number;
      readonly reached: boolean;
      /** Whole percent from 0 to 100, for a progress bar. */
      readonly percent: number;
    };

export type GiftSizeOption = {
  readonly size: string;
  readonly variantId: string;
};

export type GiftOffer = {
  readonly ruleId: string;
  readonly name: string;
  /** Gift units the shopper may still add under this rule. */
  readonly remainingQuantity: number;
  readonly sizes: readonly GiftSizeOption[];
};

export type AddOnCategory = 'foundation' | 'protector' | 'pillow' | 'bedding';

export type MatchingAddOnOffer = {
  readonly category: AddOnCategory;
  readonly mattressLineId: string;
  readonly mattressProductId: string;
  readonly size: string | null;
  readonly productId: string;
  readonly variantId: string;
};

export type OfferEvaluation = {
  /** Always in checkout order: comfort guarantee, haul-away, accident protection. */
  readonly steps: readonly [
    ComfortGuaranteeStep,
    HaulAwayStep,
    AccidentProtectionStep,
  ];
  readonly corrections: readonly Correction[];
  readonly violations: readonly Violation[];
  readonly freeDelivery: FreeDeliveryProgress;
  /** Gifts the shopper may add now (REQ-CART-002). */
  readonly gifts: readonly GiftOffer[];
  /** Size-matched foundations, protectors, pillows and bedding to suggest (REQ-ADD-001, REQ-CART-003). */
  readonly matchingAddOns: readonly MatchingAddOnOffer[];
};
