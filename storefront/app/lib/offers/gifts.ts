// Gift with purchase (REQ-CART-002, REQ-PROMO-001, CLR-011). The gift price is a Shopify discount; this
// module decides only which gift lines may exist. The important rule is the orphan rule: Shopify drops
// the discount when the qualifying line leaves the cart but keeps the gift line, which would then be
// charged at full price, so the gift line must be removed by us (BASIC_PLAN_WORKAROUNDS item 8).

import {SIZES} from '~/lib/catalog/attributes';
import {offerTagOfGift} from '~/lib/offers/card-tags';
import {limitOrZero, normalizeSize, sizeMap} from './helpers';
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

/** The ordinary lines that unlock the rule. A gift, a service line or coverage cannot unlock another gift. */
function qualifyingLines(
  rule: GiftRule,
  lines: readonly ClassifiedLine[],
): ClassifiedLine[] {
  if (rule.anyPurchase === true) {
    return lines.filter(({kind}) => kind === 'regular');
  }
  const products = new Set(rule.qualifyingProductIds);
  const collections = new Set(rule.qualifyingCollectionIds);
  return lines.filter(
    ({line, kind}) =>
      kind === 'regular' &&
      (products.has(line.productId) ||
        (line.collectionIds ?? []).some((id) => collections.has(id))),
  );
}

function qualifies(rule: GiftRule, lines: readonly ClassifiedLine[]): boolean {
  return qualifyingLines(rule, lines).length > 0;
}

// Longest first, so "Split California King" is not read as "California King" or "King".
const SIZES_LONGEST_FIRST = SIZES.map((size) => normalizeSize(size) ?? '').sort(
  (a, b) => b.length - a.length,
);

/**
 * The standard size an option key ends with: "Twin XL", or "Silver Base Twin XL" when the rule holds several gift products
 * and prefixes the product title (shopify-rules-map.ts). Null for a key with no standard size ("Standard").
 */
function sizeOfOptionKey(key: string): string | null {
  const text = normalizeSize(key);
  if (text === null) return null;
  return (
    SIZES_LONGEST_FIRST.find(
      (size) => text === size || text.endsWith(` ${size}`),
    ) ?? null
  );
}

/**
 * Only the gift sizes that match the size of the mattress (or other qualifying line) in the cart: a Queen mattress is offered
 * the Queen base and nothing else (owner request 2026-11-11). It applies to a free adjustable base only (a gift a base is
 * named by its discount title, `offerTagOfGift`): a free pillow is the shopper's own choice of size. With no sized qualifying line, or a gift whose options carry no
 * standard size, nothing is known to match against and every option stays. With sized lines and no matching option the gift is
 * not offered: a base in another size would not fit the bed.
 */
export function sizesForCart(
  rule: GiftRule,
  options: readonly GiftSizeOption[],
  qualifying: readonly ClassifiedLine[],
): GiftSizeOption[] {
  if (offerTagOfGift(rule) !== 'free-base') return [...options];
  const wanted = new Set(
    qualifying.flatMap(({line}) => {
      const size = normalizeSize(line.size);
      return size === null || !SIZES_LONGEST_FIRST.includes(size) ? [] : [size];
    }),
  );
  if (wanted.size === 0) return [...options];
  // Bed sizes only: a pillow gift in "Standard" and "King" is not sized to the mattress, so every option stays.
  if (options.some((option) => sizeOfOptionKey(option.size) === null)) {
    return [...options];
  }
  return options.filter((option) => {
    const size = sizeOfOptionKey(option.size);
    return size !== null && wanted.has(size);
  });
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
    const sizes = sizesForCart(
      rule,
      giftSizeOptions(rule),
      qualifyingLines(rule, prepared.lines),
    );
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
