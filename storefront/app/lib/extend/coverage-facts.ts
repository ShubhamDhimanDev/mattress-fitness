// SERVER ONLY. Storefront reads of the facts the Extend Offers call needs, taken from Shopify and never from the
// browser: a variant's product, list price and availability, and the Extend category of a product (the
// `custom.extend_category` metafield; REQ-EXT-005: a product without one is not eligible and is never sent to Extend).

import type {Storefront} from '~/lib/hydrogen/storefront';
import {normalizeShopifyId} from '~/lib/extend/ids';
import {toCents} from '~/lib/money';
import {pricedCache} from '~/lib/shopify/cache';
import {errorFields, logError} from '~/lib/logging/logger';

const MAX_IDS = 100;
const CATEGORY = /^[A-Za-z0-9][A-Za-z0-9 _&/-]{0,63}$/;

export const EXTEND_VARIANT_FACTS_QUERY = `#graphql
  query ExtendVariantFacts($ids: [ID!]!, $country: CountryCode, $language: LanguageCode)
  @inContext(country: $country, language: $language) {
    nodes(ids: $ids) {
      ... on ProductVariant {
        id
        availableForSale
        price {
          amount
          currencyCode
        }
        product {
          id
          metafield(namespace: "custom", key: "extend_category") {
            value
          }
        }
      }
    }
  }
` as const;

export const EXTEND_PRODUCT_CATEGORY_QUERY = `#graphql
  query ExtendProductCategories($ids: [ID!]!, $country: CountryCode, $language: LanguageCode)
  @inContext(country: $country, language: $language) {
    nodes(ids: $ids) {
      ... on Product {
        id
        metafield(namespace: "custom", key: "extend_category") {
          value
        }
      }
    }
  }
` as const;

export type FactsStorefront = Pick<
  Storefront,
  'query' | 'CacheLong' | 'CacheShort' | 'CacheNone' | 'CacheCustom'
>;

export type VariantFact = {
  variantId: string;
  /** Shopify product GID. */
  productId: string;
  /** Extend category, or null when the product is not eligible. */
  category: string | null;
  /** The variant's list price in cents: what Extend's price band is judged on, and what the order cross-check compares. */
  unitPriceCents: number;
  available: boolean;
};

export type FactsResult<T> = {status: 'ok'; facts: T} | {status: 'unavailable'};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A category is free text from the admin: only a plain short label is accepted (T-07, T-15). */
function categoryOf(metafield: unknown): string | null {
  if (!isRecord(metafield) || typeof metafield.value !== 'string') return null;
  const value = metafield.value.trim();
  return CATEGORY.test(value) ? value : null;
}

export function parseVariantFacts(raw: unknown): Map<string, VariantFact> {
  const facts = new Map<string, VariantFact>();
  if (!isRecord(raw) || !Array.isArray(raw.nodes)) return facts;
  for (const node of raw.nodes) {
    if (!isRecord(node) || !isRecord(node.product) || !isRecord(node.price)) {
      continue;
    }
    const variantId = typeof node.id === 'string' ? node.id : null;
    const productId =
      typeof node.product.id === 'string' ? node.product.id : null;
    if (
      variantId === null ||
      productId === null ||
      node.price.currencyCode !== 'USD' ||
      typeof node.price.amount !== 'string'
    ) {
      continue;
    }
    try {
      facts.set(variantId, {
        variantId,
        productId,
        category: categoryOf(node.product.metafield),
        unitPriceCents: toCents(node.price.amount),
        available: node.availableForSale === true,
      });
    } catch {
      // An unreadable price: the variant is simply unknown, so no offer is made for it.
    }
  }
  return facts;
}

export function parseProductCategories(raw: unknown): Map<string, string> {
  const categories = new Map<string, string>();
  if (!isRecord(raw) || !Array.isArray(raw.nodes)) return categories;
  for (const node of raw.nodes) {
    if (!isRecord(node) || typeof node.id !== 'string') continue;
    const category = categoryOf(node.metafield);
    if (category !== null) categories.set(node.id, category);
  }
  return categories;
}

function logFailure(what: string, error: unknown): void {
  logError('coverage.facts_read_failed', {what, ...errorFields(error)});
}

function unique(ids: readonly string[]): string[] {
  return [...new Set(ids)].slice(0, MAX_IDS);
}

export async function loadVariantFacts(
  storefront: FactsStorefront,
  variantIds: readonly string[],
): Promise<FactsResult<Map<string, VariantFact>>> {
  const ids = unique(variantIds);
  if (ids.length === 0) return {status: 'ok', facts: new Map()};
  try {
    const raw: unknown = await storefront.query(EXTEND_VARIANT_FACTS_QUERY, {
      cache: pricedCache(storefront),
      variables: {ids},
    });
    return {status: 'ok', facts: parseVariantFacts(raw)};
  } catch (error) {
    logFailure('variant facts', error);
    return {status: 'unavailable'};
  }
}

export async function loadProductCategories(
  storefront: FactsStorefront,
  productIds: readonly string[],
): Promise<FactsResult<Map<string, string>>> {
  const ids = unique(productIds);
  if (ids.length === 0) return {status: 'ok', facts: new Map()};
  try {
    const raw: unknown = await storefront.query(EXTEND_PRODUCT_CATEGORY_QUERY, {
      cache: pricedCache(storefront),
      variables: {ids},
    });
    return {status: 'ok', facts: parseProductCategories(raw)};
  } catch (error) {
    logFailure('product categories', error);
    return {status: 'unavailable'};
  }
}

/** Shopify GID to the id Extend sees (the numeric tail), or null for anything that is not a Shopify id. */
export function extendProductId(productGid: string): string | null {
  return normalizeShopifyId(productGid);
}
