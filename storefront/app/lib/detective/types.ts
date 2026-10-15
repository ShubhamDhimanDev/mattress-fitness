// Types for the detective order check (P5B-05, ADR-0006 decision 3, REQ-PRE-003, REQ-PRE-006, REQ-PROMO-003).
//
// On the Basic plan we cannot stop a cart built straight through Shopify's public Storefront API (ADR-0006), so every
// order is judged AFTER it was placed. The outputs here are ids and short codes only: no names, emails, addresses or
// ZIP codes (T-05). A ZIP is read to answer yes or no and is never copied into a result.

import type {DeliveryZone} from '~/lib/delivery/zone';
import type {ShopifyOrderLike} from '~/lib/extend/orders';
import type {OfferRules} from '~/lib/offers/types';

/**
 * What a violation is called in logs, reports and the runbook (docs/handover/RUNBOOKS.md section 8). Adding a code needs
 * a runbook row; removing or renaming one needs a note there, because staff search for these words.
 */
export const VIOLATION_CODES = [
  // Haul-away (REQ-PRE-003)
  'haul-away-outside-zone',
  'haul-away-no-shipping-zip',
  'haul-away-zip-invalid',
  'haul-away-pickup',
  'haul-away-delivery-not-recorded',
  'haul-away-over-max',
  // Gifts (REQ-CART-002, REQ-PROMO-001)
  'gift-without-qualifier',
  'gift-over-allowance',
  // Comfort-guarantee protector (REQ-PRE-002)
  'protector-without-mattress',
  'wrong-size-protector',
  'protector-exceeds-mattresses',
  // Extend protection (REQ-PRE-004, ADR-0009 decision 7)
  'coverage-without-covered-item',
  'coverage-unlinked',
  'coverage-on-ineligible-item',
  'coverage-duplicate',
  'coverage-quantity-mismatch',
] as const;
export type ViolationCode = (typeof VIOLATION_CODES)[number];

/**
 * Why part (or all) of an order could not be judged. "Could not judge" is never reported as clean: an order with any of
 * these is `unjudgeable` unless it also has a proven violation.
 */
export const UNJUDGED_REASONS = [
  /** The order could not be read completely (malformed answer, too many lines). */
  'order_unreadable',
  /** The order has a shape the checks refuse to guess about (bad id, currency, quantity, duplicate line ids). */
  'invalid_order',
  'malformed_lines',
  /** No offer rules were available (missing or invalid OFFER_CONFIG_JSON), so no line can be recognised. */
  'rules_unavailable',
  /** A haul-away line exists but the delivery zone is unknown, so its ZIP cannot be judged. */
  'zone_unavailable',
  /** A gift rule qualifies by collection and an order line does not carry its product's collections. */
  'gift_collection_qualifier',
  /** A qualifying mattress has no readable Size option, so protector sizes cannot be compared. */
  'mattress_size_unreadable',
  /** Shopify did not keep the nested-line parent, and two lines share the covered product. */
  'coverage_link_ambiguous',
  /**
   * The order holds a standing protection line, and nothing in this run judged its price or plan. The detective is offline
   * and Extend's quote needs the network and credentials, so a $5 price point on a $2,000 mattress passes every
   * structural check. Reported unless the Extend order sync really verified the price (see `DetectOptions`).
   */
  'coverage_price_unjudged',
  /** A check returned something it cannot return for an order. A defect, not an order problem. */
  'internal_error',
] as const;
export type UnjudgedReason = (typeof UNJUDGED_REASONS)[number];

/** Who else looks at what the detective cannot. The safe default (nothing set) is "nobody", which is reported. */
export type DetectOptions = {
  /**
   * True only when the Extend order sync actually ran for THIS order and verified each coverage line's plan and price
   * against Extend's quote (it ended `synced`). EXTEND_ORDER_SYNC=self alone is not enough: a failed or skipped sync, an
   * open breaker or Extend down verified nothing. Without it every order with protection says `coverage_price_unjudged`.
   */
  readonly coveragePriceJudgedElsewhere?: boolean;
};

export type OrderViolation = {
  readonly code: ViolationCode;
  /** Numeric Shopify line item ids the code is about. Never titles, never customer data. */
  readonly lineIds: readonly string[];
};

/**
 * Order facts the offer engine needs that `ShopifyOrderLike` does not carry. Read by `parseDetectiveOrder`
 * (app/lib/extend/admin-order.ts).
 */
export type DetectiveFacts = {
  /**
   * The order's custom attributes. Shopify copies cart attributes to the order (ASSUMPTION V-20, verify on the
   * development store). A shopper can write any cart attribute through the public API, so these are CLAIMS: `delivery_choice`
   * proves what the cart said, not what the shopper picked in checkout.
   */
  readonly attributes: Readonly<Record<string, string>>;
  /** Raw Shopify line item id -> value of the line's `Size` option, or null (no variant or no Size option). */
  readonly sizeByLineId: ReadonlyMap<string, string | null>;
};

export type DetectiveOrder = {
  readonly order: ShopifyOrderLike;
  readonly facts: DetectiveFacts;
};

export type DetectiveResult =
  | {
      readonly status: 'clean';
      readonly orderId: string;
      readonly violations: readonly [];
      readonly unjudged: readonly [];
    }
  | {
      readonly status: 'violations';
      readonly orderId: string;
      readonly violations: readonly OrderViolation[];
      /** Parts of the order that could not be judged even though something was found. */
      readonly unjudged: readonly UnjudgedReason[];
    }
  | {
      readonly status: 'unjudgeable';
      readonly orderId: string;
      readonly violations: readonly [];
      readonly unjudged: readonly UnjudgedReason[];
    };

/** The rules the checks run against: the same OfferConfig the cart gate uses (offers-runtime/config.ts). */
export type DetectiveConfig =
  | {
      readonly status: 'ready';
      readonly rules: OfferRules;
      /** null = no delivery zone known: haul-away lines are then `unjudged: zone_unavailable`. */
      readonly zone: DeliveryZone | null;
    }
  | {
      readonly status: 'unavailable';
      readonly reason: 'no_config' | 'invalid_config';
    };
