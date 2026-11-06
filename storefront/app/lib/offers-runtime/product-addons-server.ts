// SERVER ONLY. The product page's add-on slot reads (P4-03, REQ-ADD-001, REQ-CAT-007).
//
// The relations come from the same offer rules the cart engine uses (the offer_rule metaobjects, loaded by shopify-rules.ts,
// ADR-0013), asked by mattress product through `addOnRelationsFor`. Prices and availability are
// Shopify's: one `nodes()` read of the related variants, and a sold-out or unknown variant is never offered. The answer
// holds every size, so the page swaps the offered variants when the size changes. Nothing here depends on a shopper or a
// cart, so it is safe to cache for the short priced window (DEC-024).

import type {Storefront} from '~/lib/hydrogen/storefront';
import {addOnRelationsFor} from '~/lib/offers/addons';
import {readOfferedVariants} from './facts';
import {
  PRODUCT_PAGE_CATEGORIES,
  type ProductAddOnItem,
  type ProductAddOnsAnswer,
} from './product-addons';
import {offerRulesOf} from './shopify-rules';

export type ProductAddOnsUnavailable = {readonly status: 'unavailable'};

/** True when the rules relate anything the product page offers to this product (no Shopify read). */
export async function productHasAddOns(
  env: object,
  productId: string,
): Promise<boolean> {
  return (
    addOnRelationsFor(
      (await offerRulesOf(env)).matchingAddOns,
      productId,
      PRODUCT_PAGE_CATEGORIES,
    ).length > 0
  );
}

/**
 * The in-stock add-ons for a mattress product, every size. Empty when no rule relates anything to the product (it is
 * not a mattress with add-ons), when the rules are unreadable, and when every related
 * variant is sold out. A failed Shopify read is logged by the facts module and answers `unavailable` (the route
 * maps it to an uncacheable error and the slot offers a retry): the slot is an extra and never blocks the page
 * (NFR-013).
 */
export async function loadProductAddOns(
  storefront: Storefront,
  env: object,
  productId: string,
): Promise<ProductAddOnsAnswer | ProductAddOnsUnavailable> {
  const relations = addOnRelationsFor(
    (await offerRulesOf(env)).matchingAddOns,
    productId,
    PRODUCT_PAGE_CATEGORIES,
  );
  if (relations.length === 0) return {status: 'ok', items: []};

  const read = await readOfferedVariants(
    storefront,
    relations.map(({relation}) => relation.variantId),
    {priced: true},
  );
  // A failed read is NOT "nothing is offered": the route must not cache it as an empty list for a minute.
  if (read.status === 'error') return {status: 'unavailable'};
  const {variants} = read;
  const items: ProductAddOnItem[] = relations.flatMap(
    ({category, relation}) => {
      const variant = variants.get(relation.variantId);
      return variant ? [{category, size: relation.size, variant}] : [];
    },
  );
  return {status: 'ok', items};
}
