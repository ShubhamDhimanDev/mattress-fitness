// Shopify facts the cart offers need, read on the server (never cached: availability must be fresh and the
// ids come from a cart, ARCHITECTURE section 7). A failed read hides the offers and never blocks the cart
// (NFR-013): every loader here resolves to "nothing known" instead of throwing.

import type {Storefront} from '@shopify/hydrogen';
import {noCache} from '~/lib/shopify/cache';
import {
  OFFER_PRODUCTS_QUERY,
  OFFER_SWAP_TARGET_QUERY,
  OFFER_VARIANTS_QUERY,
} from './queries';
import type {OptionPair, VariantOptions} from './sizes';
import type {OfferedVariant} from './view';

const MAX_IDS = 100;

function logFailure(what: string, error: unknown): void {
  // No request data in the log: the message of the error only (T-05).
  console.error(
    `Cart offers: ${what} read failed:`,
    error instanceof Error ? error.message : 'unknown error',
  );
}

function unique(ids: readonly string[]): string[] {
  return [...new Set(ids)].slice(0, MAX_IDS);
}

/** Details of the variants that are in stock; a sold-out or unknown id is simply absent. */
export async function loadOfferedVariants(
  storefront: Storefront,
  variantIds: readonly string[],
): Promise<Map<string, OfferedVariant>> {
  const variants = new Map<string, OfferedVariant>();
  const ids = unique(variantIds);
  if (ids.length === 0) return variants;
  try {
    const result = await storefront.query(OFFER_VARIANTS_QUERY, {
      cache: noCache(storefront),
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
  } catch (error) {
    logFailure('variants', error);
  }
  return variants;
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

export async function loadProductFacts(
  storefront: Storefront,
  productIds: readonly string[],
  withCollections: boolean,
): Promise<ProductFacts> {
  const ids = unique(productIds);
  if (ids.length === 0) return NO_PRODUCT_FACTS;
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
    return {collectionIds, variants};
  } catch (error) {
    logFailure('products', error);
    return NO_PRODUCT_FACTS;
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
