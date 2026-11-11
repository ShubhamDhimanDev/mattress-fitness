// SERVER ONLY. The offer tags for a list of products or one product, from the gift rules Shopify holds (cached for a minute by
// shopify-rules.ts). Never throws and costs nothing without an Admin token: no rules means no tags, and the page is as before.

import {
  offerTagIndex,
  offerTagsOf,
  withOfferTags,
  type OfferTag,
} from '~/lib/offers/card-tags';
import {offerRulesOf} from './shopify-rules';

async function indexFor(env: object) {
  try {
    return offerTagIndex((await offerRulesOf(env)).gifts);
  } catch {
    return offerTagIndex([]);
  }
}

export async function tagProducts<T extends {readonly id: string}>(
  env: object,
  products: readonly T[],
): Promise<(T & {readonly offerTags?: readonly OfferTag[]})[]> {
  return withOfferTags(products, await indexFor(env));
}

export async function offerTagsForProduct(
  env: object,
  productId: string,
): Promise<readonly OfferTag[]> {
  return offerTagsOf(await indexFor(env), productId);
}
