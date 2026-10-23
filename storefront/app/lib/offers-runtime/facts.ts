// Shopify facts the cart offers need, read on the server (never cached: availability must be fresh and the
// ids come from a cart, ARCHITECTURE section 7). A failed read hides the offers and never blocks the cart
// (NFR-013): every loader here resolves to "nothing known" instead of throwing.

import type {Storefront} from '@shopify/hydrogen';
import {noCache, pricedCache} from '~/lib/shopify/cache';
import {
  OFFER_PRODUCTS_QUERY,
  OFFER_SWAP_TARGET_QUERY,
  OFFER_VARIANTS_QUERY,
} from './queries';
import type {OptionPair, VariantOptions} from './sizes';
import type {OfferedVariant} from './view';
import {errorFields, logError} from '~/lib/logging/logger';

const MAX_IDS = 100;

function logFailure(what: string, error: unknown): void {
  // No request data in the log: the class name of the error only (T-05).
  logError('offers.facts_read_failed', {what, ...errorFields(error)});
}

function unique(ids: readonly string[]): string[] {
  return [...new Set(ids)].slice(0, MAX_IDS);
}

export type OfferedVariantsRead =
  | {readonly status: 'ok'; readonly variants: Map<string, OfferedVariant>}
  | {readonly status: 'error'};

/**
 * Like `loadOfferedVariants` but says when the read FAILED, so a caller that must not present "could not read" as
 * "nothing is offered" (the product page's add-on slot, which would otherwise cache an empty answer) can tell.
 */
export async function readOfferedVariants(
  storefront: Storefront,
  variantIds: readonly string[],
  options: {readonly priced?: boolean} = {},
): Promise<OfferedVariantsRead> {
  const variants = new Map<string, OfferedVariant>();
  const ids = unique(variantIds);
  if (ids.length === 0) return {status: 'ok', variants};
  try {
    const result = await storefront.query(OFFER_VARIANTS_QUERY, {
      cache: options.priced ? pricedCache(storefront) : noCache(storefront),
      variables: {ids},
    });
    for (const node of result.nodes) {
      if (!node || !('product' in node) || !node.availableForSale) continue;
      variants.set(node.id, {
        variantId: node.id,
        productTitle: node.product.title,
        productHandle: node.product.handle,
        variantTitle: node.title === 'Default Title' ? null : node.title,
        price: node.price,
      });
    }
    return {status: 'ok', variants};
  } catch (error) {
    logFailure('variants', error);
    return {status: 'error'};
  }
}

/**
 * Details of the variants that are in stock; a sold-out or unknown id is simply absent. The cart reads fresh (the ids
 * come from a cart, never cached). `priced` is for a page that is the same for every shopper (the product page's
 * add-on slot, P4-03): the 60 second price-and-availability window every catalog card uses (DEC-024); the ids in the
 * cache key are catalog ids from the rules, never personal data. The add itself always re-reads fresh.
 */
export async function loadOfferedVariants(
  storefront: Storefront,
  variantIds: readonly string[],
  options: {readonly priced?: boolean} = {},
): Promise<Map<string, OfferedVariant>> {
  const read = await readOfferedVariants(storefront, variantIds, options);
  return read.status === 'ok' ? read.variants : new Map();
}

export type ProductFacts = {
  /** product id -> collection ids (empty unless collections were requested). */
  readonly collectionIds: ReadonlyMap<string, readonly string[]>;
  /** product id -> its variants with their options, for size swaps. */
  readonly variants: ReadonlyMap<string, readonly VariantOptions[]>;
};

export const NO_PRODUCT_FACTS: ProductFacts = {
  collectionIds: new Map(),
  variants: new Map(),
};

/**
 * A complete read, or an incomplete one that says why. Callers that NEED the facts to judge the cart
 * (collection-qualified gifts) must treat 'incomplete' as unverified and repair nothing: a gift whose
 * qualifying collection could not be read would otherwise look orphaned and be removed.
 */
export type ProductFactsResult =
  | {readonly status: 'ok'; readonly facts: ProductFacts}
  | {
      readonly status: 'incomplete';
      readonly reason: 'read-failed' | 'truncated' | 'missing-products';
      readonly facts: ProductFacts;
    };

export async function loadProductFacts(
  storefront: Storefront,
  productIds: readonly string[],
  withCollections: boolean,
): Promise<ProductFactsResult> {
  const requested = [...new Set(productIds)];
  if (requested.length === 0) return {status: 'ok', facts: NO_PRODUCT_FACTS};
  const ids = requested.slice(0, MAX_IDS);
  try {
    const result = await storefront.query(OFFER_PRODUCTS_QUERY, {
      cache: noCache(storefront),
      variables: {ids, withCollections},
    });
    const collectionIds = new Map<string, readonly string[]>();
    const variants = new Map<string, readonly VariantOptions[]>();
    for (const node of result.nodes) {
      if (!node || !('variants' in node)) continue;
      collectionIds.set(
        node.id,
        node.collections?.nodes.map((collection) => collection.id) ?? [],
      );
      variants.set(
        node.id,
        node.variants.nodes.map((variant) => ({
          variantId: variant.id,
          available: variant.availableForSale,
          options: variant.selectedOptions,
        })),
      );
    }
    const facts = {collectionIds, variants};
    if (requested.length > ids.length) {
      return {status: 'incomplete', reason: 'truncated', facts};
    }
    if (ids.some((id) => !variants.has(id))) {
      return {status: 'incomplete', reason: 'missing-products', facts};
    }
    return {status: 'ok', facts};
  } catch (error) {
    logFailure('products', error);
    return {
      status: 'incomplete',
      reason: 'read-failed',
      facts: NO_PRODUCT_FACTS,
    };
  }
}

export type SwapTarget =
  | {
      readonly status: 'ok';
      readonly productId: string;
      readonly options: readonly OptionPair[];
    }
  | {readonly status: 'unavailable'}
  | {readonly status: 'error'};

/** The product a variant belongs to, and whether it can be bought now. */
export async function loadSwapTarget(
  storefront: Storefront,
  variantId: string,
): Promise<SwapTarget> {
  try {
    const result = await storefront.query(OFFER_SWAP_TARGET_QUERY, {
      cache: noCache(storefront),
      variables: {id: variantId},
    });
    const node = result.node;
    if (!node || !('product' in node)) return {status: 'unavailable'};
    return node.availableForSale
      ? {
          status: 'ok',
          productId: node.product.id,
          options: node.selectedOptions,
        }
      : {status: 'unavailable'};
  } catch (error) {
    logFailure('swap target', error);
    return {status: 'error'};
  }
}
