// SERVER ONLY. The product page's "Frequently bought together" reads (P4-06, REQ-ADD-002, REQ-CAT-008).
//
// Which products belong together comes from the admin-configured bundle rules (the same ones the cart engine uses). Prices
// and availability are Shopify's: one `nodes()` read of the companion variants for every size, and a set is offered only
// when EVERY companion of that size is in stock, because a partial set would not earn the Shopify saving. Nothing here
// depends on a shopper or a cart, so it is safe to cache for the short priced window (DEC-024). No saving figure is
// produced: it is a Shopify automatic discount, shown only after the cart reports it.

import type {Storefront} from '~/lib/hydrogen/storefront';
import {
  bundleCompanionsForSize,
  bundleMembership,
  bundleOfferedSizes,
  type BundleCompanion,
} from '~/lib/offers/bundles';
import type {BundleRule} from '~/lib/offers/types';
import {offerRulesOf} from './config';
import {readOfferedVariants} from './facts';
import type {
  ProductBundleAnswer,
  ProductBundleItem,
  ProductBundleSet,
} from './product-bundle';

export type ProductBundleUnavailable = {readonly status: 'unavailable'};

/** The bundles whose page this product is (as the anchor). A companion's own page does not show the card. */
function anchoredBundles(env: object, productId: string): BundleRule[] {
  return bundleMembership(offerRulesOf(env).bundles, productId)
    .filter(({role}) => role === 'anchor')
    .map(({bundle}) => bundle);
}

/** True when the rules make this product the anchor of a bundle (no Shopify read). */
export function productHasBundle(env: object, productId: string): boolean {
  return anchoredBundles(env, productId).length > 0;
}

type Candidate = {
  readonly bundle: BundleRule;
  readonly size: string | null;
  readonly companions: readonly BundleCompanion[];
};

function candidatesOf(bundles: readonly BundleRule[]): Candidate[] {
  return bundles.flatMap((bundle) =>
    bundleOfferedSizes(bundle).flatMap((size) => {
      const companions = bundleCompanionsForSize(bundle, size);
      return companions === null ? [] : [{bundle, size, companions}];
    }),
  );
}

/**
 * The in-stock sets of the first bundle that has any, every size. `bundle: null` when no rule makes this product an anchor,
 * when no size has a complete set in stock, when offers are switched off or the rules are unreadable. A failed Shopify
 * read answers `unavailable` (the route maps it to an uncacheable error and the card offers a retry): the card is an extra
 * and never blocks the page (NFR-013).
 */
export async function loadProductBundle(
  storefront: Storefront,
  env: object,
  productId: string,
): Promise<ProductBundleAnswer | ProductBundleUnavailable> {
  const candidates = candidatesOf(anchoredBundles(env, productId));
  if (candidates.length === 0) return {status: 'ok', bundle: null};

  const read = await readOfferedVariants(
    storefront,
    candidates.flatMap(({companions}) =>
      companions.map(({variantId}) => variantId),
    ),
    {priced: true},
  );
  // A failed read is NOT "nothing is offered": the route must not cache it as an empty answer for a minute.
  if (read.status === 'error') return {status: 'unavailable'};

  for (const bundle of new Set(
    candidates.map((candidate) => candidate.bundle),
  )) {
    const sets: ProductBundleSet[] = [];
    for (const candidate of candidates) {
      if (candidate.bundle !== bundle) continue;
      const items: ProductBundleItem[] = [];
      for (const companion of candidate.companions) {
        const variant = read.variants.get(companion.variantId);
        if (variant) items.push({quantity: companion.quantity, variant});
      }
      // All or nothing: one sold-out or unknown companion removes the whole set for this size.
      if (items.length === candidate.companions.length) {
        sets.push({size: candidate.size, items});
      }
    }
    if (sets.length > 0) {
      return {status: 'ok', bundle: {bundleId: bundle.id, sets}};
    }
  }
  return {status: 'ok', bundle: null};
}
