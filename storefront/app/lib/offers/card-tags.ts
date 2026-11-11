// Offer tags on product cards and the product page: "Free Adjustable Base!!", "Free Gift with Purchase!!" (owner request
// 2026-11-11). Pure: the rules come from Shopify (offers-runtime/shopify-rules.ts, ADR-0013) and this only says which products
// a gift rule names, so a tag appears exactly when a real, active Shopify discount gives the gift. Nothing is invented here.
//
// Limits, stated so they are not mistaken for a bug: a gift that qualifies by COLLECTION, or with ANY purchase, is not tagged
// on a card (a card does not know its collections, and tagging every product "free gift" would be noise); only a gift that
// lists the product itself is. The free-base offer (scripts/setup/free-base-offer.mjs) lists its mattresses, so it is tagged.

import type {GiftRule} from '~/lib/offers/types';

export const OFFER_TAGS = ['free-base', 'free-gift'] as const;
export type OfferTag = (typeof OFFER_TAGS)[number];

export const OFFER_TAG_LABELS: Readonly<Record<OfferTag, string>> = {
  'free-base': 'Free Adjustable Base!!',
  'free-gift': 'Free Gift with Purchase!!',
};

/**
 * The gift's own kind. The discount title is the only text the rule carries about the gift ("Free adjustable base with
 * Aireloom and Kingsdown"), so a title naming a base is the adjustable-base offer; any other gift is a plain free gift.
 */
export function offerTagOfGift(rule: Pick<GiftRule, 'name'>): OfferTag {
  return /\b(adjustable\s+)?base\b/i.test(rule.name) ? 'free-base' : 'free-gift';
}

export type OfferTagIndex = ReadonlyMap<string, readonly OfferTag[]>;

export function offerTagIndex(gifts: readonly GiftRule[]): OfferTagIndex {
  const byProduct = new Map<string, Set<OfferTag>>();
  for (const rule of gifts) {
    const tag = offerTagOfGift(rule);
    for (const productId of rule.qualifyingProductIds) {
      const tags = byProduct.get(productId) ?? new Set<OfferTag>();
      tags.add(tag);
      byProduct.set(productId, tags);
    }
  }
  // Fixed order, so the same product always shows its tags the same way.
  return new Map(
    [...byProduct].map(([id, tags]) => [
      id,
      OFFER_TAGS.filter((tag) => tags.has(tag)),
    ]),
  );
}

export function offerTagsOf(
  index: OfferTagIndex,
  productId: string,
): readonly OfferTag[] {
  return index.get(productId) ?? [];
}

/** The products with their `offerTags`; a product with none is returned as it is. */
export function withOfferTags<T extends {readonly id: string}>(
  products: readonly T[],
  index: OfferTagIndex,
): (T & {readonly offerTags?: readonly OfferTag[]})[] {
  return products.map((product) => {
    const offerTags = offerTagsOf(index, product.id);
    return offerTags.length === 0 ? product : {...product, offerTags};
  });
}
