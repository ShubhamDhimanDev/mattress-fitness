// Price-point matching (ADR-0009 decision 1, REQ-EXT-002). On the Basic plan we cannot override a line price in
// checkout, so a quoted plan can be sold only if a coverage variant with EXACTLY that price exists. Otherwise the
// plan is hidden: we never charge a different price than the one quoted. Pure functions, safe for the browser too.

import type {ExtendOffer, ExtendPlan, ExtendPlanType} from '~/lib/extend/types';

/** Extend's Price Points pattern names coverage SKUs "Extend-Protection-Plan-<price>", at most 250 of them (F-27). */
export const PRICE_POINT_PREFIX = 'Extend-Protection-Plan-';
export const MAX_PRICE_POINTS = 250;
/** $99,999.99: a sanity ceiling, far above any coverage price. */
const MAX_PRICE_CENTS = 9_999_999;

export type PricePointNameParse =
  | {status: 'ok'; priceCents: number}
  | {status: 'error'; reason: 'malformed_name'};

/**
 * "Extend-Protection-Plan-14.99" -> 1499. Strict on purpose: exact prefix, plain decimal with at most two places,
 * no sign, no exponent, no leading zeros, no thousands separators, price above zero.
 */
export function parsePricePointName(name: string): PricePointNameParse {
  const trimmed = name.trim();
  if (!trimmed.startsWith(PRICE_POINT_PREFIX)) {
    return {status: 'error', reason: 'malformed_name'};
  }
  const price = /^(0|[1-9]\d{0,5})(?:\.(\d{1,2}))?$/.exec(
    trimmed.slice(PRICE_POINT_PREFIX.length),
  );
  if (!price) return {status: 'error', reason: 'malformed_name'};
  const cents =
    Number(price[1]) * 100 + Number((price[2] ?? '').padEnd(2, '0'));
  if (cents <= 0 || cents > MAX_PRICE_CENTS) {
    return {status: 'error', reason: 'malformed_name'};
  }
  return {status: 'ok', priceCents: cents};
}

export function isPricePointName(name: string): boolean {
  return parsePricePointName(name).status === 'ok';
}

/** A coverage variant from the catalog. `priceCents` is the variant's real Shopify price. */
export type PricePointVariant = {
  variantId: string;
  name: string;
  priceCents: number;
};

export type RejectedPricePoint = {
  variantId: string;
  reason:
    | 'malformed_name'
    | 'invalid_price'
    | 'price_mismatch'
    | 'duplicate_price'
    | 'over_limit';
};

export type PricePointIndex = {
  byPriceCents: ReadonlyMap<number, PricePointVariant>;
  rejected: readonly RejectedPricePoint[];
};

/**
 * Indexes valid price points by price. A variant whose name disagrees with its actual price is rejected: the name
 * is what Extend's table uses, the price is what the customer pays, and a disagreement means a catalog error that
 * must not turn into a wrong charge. Input order does not matter (sorted by variant id) so results are stable.
 */
export function buildPricePointIndex(
  variants: readonly PricePointVariant[],
): PricePointIndex {
  const byPriceCents = new Map<number, PricePointVariant>();
  const rejected: RejectedPricePoint[] = [];
  const ordered = [...variants].sort((a, b) =>
    a.variantId < b.variantId ? -1 : a.variantId > b.variantId ? 1 : 0,
  );

  for (const variant of ordered) {
    if (byPriceCents.size >= MAX_PRICE_POINTS) {
      rejected.push({variantId: variant.variantId, reason: 'over_limit'});
      continue;
    }
    const parsed = parsePricePointName(variant.name);
    if (parsed.status === 'error') {
      rejected.push({variantId: variant.variantId, reason: parsed.reason});
      continue;
    }
    if (!Number.isSafeInteger(variant.priceCents) || variant.priceCents <= 0) {
      rejected.push({variantId: variant.variantId, reason: 'invalid_price'});
      continue;
    }
    if (parsed.priceCents !== variant.priceCents) {
      rejected.push({variantId: variant.variantId, reason: 'price_mismatch'});
      continue;
    }
    if (byPriceCents.has(variant.priceCents)) {
      rejected.push({variantId: variant.variantId, reason: 'duplicate_price'});
      continue;
    }
    byPriceCents.set(variant.priceCents, variant);
  }
  return {byPriceCents, rejected};
}

export type MatchedPlan = {
  planType: ExtendPlanType;
  recommended: boolean;
  plan: ExtendPlan;
  /** The coverage variant to add as the nested cart line. */
  variantId: string;
};

export type HiddenPlan = {
  planId: string;
  priceCents: number;
  reason: 'no_price_point';
};

export type PlanMatch = {matched: MatchedPlan[]; hidden: HiddenPlan[]};

/** Keeps only plans whose price exactly equals an existing price-point variant price; hides the rest. */
export function matchPlansToPricePoints(
  offer: ExtendOffer,
  index: PricePointIndex,
): PlanMatch {
  const matched: MatchedPlan[] = [];
  const hidden: HiddenPlan[] = [];
  for (const planType of ['adh', 'base'] as const) {
    for (const plan of offer.plans[planType]) {
      const variant = index.byPriceCents.get(plan.priceCents);
      if (variant === undefined) {
        hidden.push({
          planId: plan.id,
          priceCents: plan.priceCents,
          reason: 'no_price_point',
        });
        continue;
      }
      matched.push({
        planType,
        // Extend names one plan family as recommended; the UI may highlight it.
        recommended: offer.plans.recommended === planType,
        plan,
        variantId: variant.variantId,
      });
    }
  }
  return {matched, hidden};
}
