// SERVER ONLY. The server's list of Extend price-point coverage variants (P5A-06, security review O-M2, ADR-0009
// decision 1). Roles in the cart gate come from THIS list, never from a role or attribute that arrived with the cart.
//
// How the products are found is our own catalog convention, not Extend's: the coverage products carry the Shopify
// product tag `extend-coverage`. ASSUMPTION(V-16, V-20): the Storefront `products(query:)` search returns tagged
// products even when they are hidden from storefront search and collections; confirm on the development store.
// A layout of one product with up to 250 variants, or a few products with fewer in total, fits one read.
// The variant names themselves follow the documented `Extend-Protection-Plan-<price>` pattern (F-27).

import type {Storefront} from '@shopify/hydrogen';
import {
  buildPricePointIndex,
  MAX_PRICE_POINTS,
  parsePricePointName,
  type PricePointIndex,
  type PricePointVariant,
} from '~/lib/extend/price-points';
import {toCents} from '~/lib/money';
import {errorFields, logError} from '~/lib/logging/logger';

export const COVERAGE_PRODUCT_TAG = 'extend-coverage';

/**
 * The catalog read has its own, longer window (review of d068db6, item E; the 60 s priced strategy of DEC-024 is for
 * cards the shopper reads a price from). Here the list is used to RECOGNISE coverage lines, which needs no price
 * freshness, and a failed read pauses checkout for every cart while Extend is on. Fresh for 5 minutes, then served stale
 * for up to an hour while a refresh runs, so a short Storefront hiccup never reaches the shopper. A stale price point is
 * safe: the coverage line's real price is Shopify's, and the cart gate compares it with the quoted plan on every pass.
 */
export const COVERAGE_CATALOG_MAX_AGE_SECONDS = 300;
export const COVERAGE_CATALOG_STALE_WHILE_REVALIDATE_SECONDS = 3600;
const MAX_COVERAGE_PRODUCTS = 10;

export const EXTEND_COVERAGE_VARIANTS_QUERY = `#graphql
  query ExtendCoverageVariants($query: String!, $country: CountryCode, $language: LanguageCode)
  @inContext(country: $country, language: $language) {
    products(first: ${MAX_COVERAGE_PRODUCTS}, query: $query) {
      pageInfo {
        hasNextPage
      }
      nodes {
        id
        title
        variants(first: 250) {
          pageInfo {
            hasNextPage
          }
          nodes {
            id
            title
            sku
            availableForSale
            price {
              amount
              currencyCode
            }
          }
        }
      }
    }
  }
` as const;

export type CoverageCatalog = {
  /** Every variant that is a coverage price point by NAME, sellable or not, even with a wrong price: the gate must still treat it as coverage. */
  readonly coverageVariantIds: ReadonlySet<string>;
  /** Only variants that can be sold: an exact name/price match and in stock. */
  readonly index: PricePointIndex;
  /** False when the read may have missed variants (more products or variants than one page). */
  readonly complete: boolean;
};

export type CoverageCatalogResult =
  | {status: 'ok'; catalog: CoverageCatalog}
  | {status: 'unavailable'; reason: 'read-failed' | 'malformed'};

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** The first of SKU, variant title, product title that follows the price-point pattern. */
function pricePointName(names: readonly (string | null)[]): string | null {
  for (const name of names) {
    if (name !== null && parsePricePointName(name).status === 'ok') {
      return name;
    }
  }
  return null;
}

/** Pure: Storefront `products` result to the catalog. Anything malformed makes the whole read unavailable. */
export function parseCoverageCatalog(raw: unknown): CoverageCatalogResult {
  const malformed = {status: 'unavailable', reason: 'malformed'} as const;
  if (!isRecord(raw) || !isRecord(raw.products)) return malformed;
  const products = raw.products;
  if (!Array.isArray(products.nodes)) return malformed;
  let complete =
    isRecord(products.pageInfo) && products.pageInfo.hasNextPage === false;

  const coverageVariantIds = new Set<string>();
  const sellable: PricePointVariant[] = [];

  for (const product of products.nodes) {
    if (!isRecord(product) || !isRecord(product.variants)) return malformed;
    const variants = product.variants;
    if (!Array.isArray(variants.nodes)) return malformed;
    if (
      !isRecord(variants.pageInfo) ||
      variants.pageInfo.hasNextPage !== false
    ) {
      complete = false;
    }
    for (const variant of variants.nodes) {
      if (!isRecord(variant)) return malformed;
      const id = str(variant.id);
      if (id === null) return malformed;
      const name = pricePointName([
        str(variant.sku),
        str(variant.title),
        str(product.title),
      ]);
      if (name === null) continue;
      coverageVariantIds.add(id);

      const price = isRecord(variant.price) ? variant.price : null;
      if (
        variant.availableForSale !== true ||
        price === null ||
        price.currencyCode !== 'USD' ||
        typeof price.amount !== 'string'
      ) {
        continue;
      }
      try {
        sellable.push({
          variantId: id,
          name,
          priceCents: toCents(price.amount),
        });
      } catch {
        // An unreadable price is a catalog error: the variant stays a coverage variant but is never offered.
      }
    }
  }
  if (coverageVariantIds.size > MAX_PRICE_POINTS) complete = false;
  return {
    status: 'ok',
    catalog: {
      coverageVariantIds,
      index: buildPricePointIndex(sellable),
      complete,
    },
  };
}

export type CatalogStorefront = Pick<
  Storefront,
  'query' | 'CacheLong' | 'CacheShort' | 'CacheNone' | 'CacheCustom'
>;

export async function loadCoverageCatalog(
  storefront: CatalogStorefront,
): Promise<CoverageCatalogResult> {
  try {
    // The key holds only the tag (no personal data).
    const raw: unknown = await storefront.query(
      EXTEND_COVERAGE_VARIANTS_QUERY,
      {
        cache: storefront.CacheCustom({
          mode: 'public',
          maxAge: COVERAGE_CATALOG_MAX_AGE_SECONDS,
          staleWhileRevalidate: COVERAGE_CATALOG_STALE_WHILE_REVALIDATE_SECONDS,
        }),
        variables: {query: `tag:${COVERAGE_PRODUCT_TAG}`},
      },
    );
    return parseCoverageCatalog(raw);
  } catch (error) {
    // Class name only: the error cause holds the query and variables (security review O-L7).
    logError('coverage.catalog_read_failed', errorFields(error));
    return {status: 'unavailable', reason: 'read-failed'};
  }
}
