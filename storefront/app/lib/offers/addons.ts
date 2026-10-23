// Size-matched add-ons for the mattresses in the cart (REQ-ADD-001, REQ-CART-003, REQ-CAT-007): foundations,
// protectors, pillows and bedding from admin-configured relations. These are suggestions only. They are
// ordinary catalog products a shopper may also buy on their own, so the engine never corrects or removes them
// (unlike the offer-only comfort protector and gift variants). Availability is the caller's filter: pass the
// variant ids you already know are in stock.

import {normalizeSize} from './helpers';
import type {PreparedCart} from './lines';
import type {
  AddOnCategory,
  AddOnRelation,
  MatchingAddOnOffer,
  MatchingAddOnRules,
} from './types';

const CATEGORIES: readonly {
  readonly category: AddOnCategory;
  readonly key: keyof MatchingAddOnRules;
}[] = [
  {category: 'foundation', key: 'foundations'},
  {category: 'protector', key: 'protectors'},
  {category: 'pillow', key: 'pillows'},
  {category: 'bedding', key: 'bedding'},
];

/** A relation with no size fits every size of its mattress; otherwise the sizes must match once normalised. */
export function relationFitsSize(
  relation: AddOnRelation,
  size: string | null,
): boolean {
  if (relation.size === null) return true;
  const wanted = normalizeSize(relation.size);
  return wanted !== null && wanted === normalizeSize(size);
}

export function matchingAddOnOffers(
  prepared: PreparedCart,
  rules: MatchingAddOnRules,
): MatchingAddOnOffer[] {
  const inCart = new Set(prepared.lines.map(({line}) => line.variantId));
  const offered = new Set<string>();
  const offers: MatchingAddOnOffer[] = [];

  for (const {line, kind} of prepared.lines) {
    if (kind !== 'regular') continue;
    for (const {category, key} of CATEGORIES) {
      for (const relation of rules[key]) {
        if (relation.mattressProductId !== line.productId) continue;
        if (!relationFitsSize(relation, line.size)) continue;
        // A variant already in the cart is not offered again; two mattresses of one size share one offer.
        const dedupeKey = `${category}:${relation.variantId}`;
        if (inCart.has(relation.variantId) || offered.has(dedupeKey)) continue;
        offered.add(dedupeKey);
        offers.push({
          category,
          mattressLineId: line.id,
          mattressProductId: line.productId,
          size: line.size,
          productId: relation.productId,
          variantId: relation.variantId,
        });
      }
    }
  }
  return offers;
}

export type ProductAddOnRelation = {
  readonly category: AddOnCategory;
  readonly relation: AddOnRelation;
};

const ALL_CATEGORIES: readonly AddOnCategory[] = CATEGORIES.map(
  ({category}) => category,
);

/**
 * The admin-configured relations of one mattress PRODUCT, before any size is chosen (REQ-ADD-001). The product page has
 * no cart, so it asks the rules the question `matchingAddOnOffers` asks of a cart line, for a product instead; the size
 * is applied afterwards with `relationFitsSize`, so one answer serves every size on the page. Order follows the rules
 * (category order, then the order the admin listed them).
 */
export function addOnRelationsFor(
  rules: MatchingAddOnRules,
  mattressProductId: string,
  categories: readonly AddOnCategory[] = ALL_CATEGORIES,
): ProductAddOnRelation[] {
  return CATEGORIES.flatMap(({category, key}) =>
    categories.includes(category)
      ? rules[key]
          .filter(
            (relation) => relation.mattressProductId === mattressProductId,
          )
          .map((relation) => ({category, relation}))
      : [],
  );
}
