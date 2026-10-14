// Gift with purchase (REQ-CART-002, REQ-PROMO-001, CLR-011). The gift price is a Shopify discount; this
// module decides only which gift lines may exist. The important rule is the orphan rule: Shopify drops
// the discount when the qualifying line leaves the cart but keeps the gift line, which would then be
// charged at full price, so the gift line must be removed by us (BASIC_PLAN_WORKAROUNDS item 8).

import {limitOrZero, sizeMap} from './helpers';
import type {ClassifiedLine, PreparedCart} from './lines';
import {prepareCart} from './lines';
import type {
  CartLike,
  Correction,
  GiftOffer,
  GiftRule,
  GiftSizeOption,
  OfferRules,
} from './types';

/** Size choices for a gift, in the order the rule lists them. Blank sizes and variant ids are skipped. */
export function giftSizeOptions(rule: GiftRule): GiftSizeOption[] {
  return [...sizeMap(rule.giftVariantIdsBySize).values()].map(({size, id}) => ({
    size,
    variantId: id,
  }));
}

function qualifies(rule: GiftRule, lines: readonly ClassifiedLine[]): boolean {
  const products = new Set(rule.qualifyingProductIds);
  const collections = new Set(rule.qualifyingCollectionIds);
  // Only ordinary lines qualify: a gift, a service line or coverage cannot unlock another gift.
  return lines.some(
    ({line, kind}) =>
      kind === 'regular' &&
      (products.has(line.productId) ||
        (line.collectionIds ?? []).some((id) => collections.has(id))),
  );
}

export type GiftResult = {
  readonly offers: readonly GiftOffer[];
  readonly corrections: readonly Correction[];
};

export function evaluateGifts(
  prepared: PreparedCart,
  rules: readonly GiftRule[],
): GiftResult {
  const qualified = rules.map((rule) => qualifies(rule, prepared.lines));
  const variantSets = rules.map(
    (rule) => new Set(giftSizeOptions(rule).map((option) => option.variantId)),
  );
  const remaining = rules.map((rule) => limitOrZero(rule.maxQuantity));
  const corrections: Correction[] = [];

  for (const {line, kind} of prepared.lines) {
    if (kind !== 'gift') continue;

    const candidates = variantSets.flatMap((variants, index) =>
      variants.has(line.variantId) ? [index] : [],
    );
    if (candidates.length === 0) {
      // Tagged as a gift but no rule offers this variant any more (an expired or disabled gift).
      corrections.push({
        type: 'remove-line',
        lineId: line.id,
        reason: 'gift-not-offered',
      });
      continue;
    }

    // Entitlement follows the rule (a qualifying line is in the cart), not a particular parent line: while
    // any qualifying line remains, Shopify's discount still applies and the gift stays at $0.
    const qualifiedCandidates = candidates.filter((index) => qualified[index]);
    if (qualifiedCandidates.length === 0) {
      corrections.push({
        type: 'remove-line',
        lineId: line.id,
        reason: 'orphan-gift',
      });
      continue;
    }

    const target = qualifiedCandidates.find((index) => remaining[index] > 0);
    if (target === undefined) {
      corrections.push({
        type: 'remove-line',
        lineId: line.id,
        reason: 'duplicate-gift',
      });
      continue;
    }
    const kept = Math.min(line.quantity, remaining[target]);
    remaining[target] -= kept;
    if (kept < line.quantity) {
      corrections.push({
        type: 'set-quantity',
        lineId: line.id,
        quantity: kept,
        previousQuantity: line.quantity,
        reason: 'gift-over-limit',
      });
    }
  }

  const offers: GiftOffer[] = [];
  rules.forEach((rule, index) => {
    const sizes = giftSizeOptions(rule);
    if (qualified[index] && remaining[index] > 0 && sizes.length > 0) {
      offers.push({
        ruleId: rule.id,
        name: rule.name,
        remainingQuantity: remaining[index],
        sizes,
      });
    }
  });

  return {offers, corrections};
}

/** Gifts the shopper may add now: a qualifying line is present and the rule's allowance is not used up. */
export function eligibleGifts(cart: CartLike, rules: OfferRules): GiftOffer[] {
  return [...evaluateGifts(prepareCart(cart, rules), rules.gifts).offers];
}

/**
 * Gift lines that must go: the qualifying line is gone, the promotion no longer offers the variant, or the
 * allowance is used up. Used by the cart action after any removal and by revalidation.
 */
export function giftRemovals(cart: CartLike, rules: OfferRules): Correction[] {
  return [...evaluateGifts(prepareCart(cart, rules), rules.gifts).corrections];
}
