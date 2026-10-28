// The products the sleep quiz may recommend, read from the `mattresses` collection and mapped to the plain
// `CatalogProduct` model the scoring works on (REQ-QZ-002, REQ-QZ-003, P3B-01). Server side only.
//
// Scoring is data driven (score.ts): a product is eligible when it has a variant in the chosen size, and it scores
// on its `custom.*` metafields. Nothing is listed here by handle, so a product added in Shopify admin joins the quiz
// with no code change. Prices and availability are read with the 60 s strategy (DEC-024): the quiz shows a price
// and an add-to-cart button, so a stale price would mislead before checkout corrects it.
//
// A variant whose Size option is not one of our sizes, or whose price is unreadable, is skipped, not guessed at
// (NFR-013): one malformed record must not take the quiz down.

import type {QuizProductsQuery} from 'storefrontapi.generated';
import {
  BENEFITS,
  COMFORT_LEVELS,
  MATTRESS_TYPES,
  PRODUCT_METAFIELD_KEYS,
  SIZE_OPTION_NAME,
  SIZES,
  SLEEP_POSITIONS,
  matchCanonical,
  toSlug,
  type Size,
} from '~/lib/catalog/attributes';
import {cleanText} from '~/lib/catalog/text';
import type {
  CatalogProduct,
  ProductImage,
  SizeVariant,
} from '~/lib/catalog/types';
import type {Storefront} from '~/lib/hydrogen/storefront';
import {errorFields, logError, logWarn} from '~/lib/logging/logger';
import {pricedCache} from '~/lib/shopify/cache';
import {centsOf, mapImage, mapMoney} from '~/lib/shopify/common';
import {PRIMARY_COLLECTION_HANDLE} from '~/lib/shopify/config';
import {
  indexMetafields,
  readChoice,
  readChoices,
  readPositiveNumber,
  readText,
} from '~/lib/shopify/metafields';

/** One Storefront API page; a mattress collection of up to 400 products is well inside this for the SOW catalog. */
export const QUIZ_PRODUCT_LIMIT = 250;

export const QUIZ_PRODUCTS_QUERY = `#graphql
  query QuizProducts(
    $handle: String!
    $first: Int!
    $country: CountryCode
    $language: LanguageCode
  ) @inContext(country: $country, language: $language) {
    collection(handle: $handle) {
      products(first: $first) {
        nodes {
          id
          handle
          title
          vendor
          productType
          featuredImage {
            id
            url
            altText
            width
            height
          }
          # A mattress has at most seven sizes (SIZES); 20 leaves room for an extra option without the cost of 100.
          variants(first: 20) {
            nodes {
              id
              sku
              availableForSale
              price {
                amount
                currencyCode
              }
              compareAtPrice {
                amount
                currencyCode
              }
              selectedOptions {
                name
                value
              }
              dimensions: metafield(namespace: "custom", key: "dimensions") {
                value
              }
            }
          }
          metafields(
            identifiers: [
              {namespace: "custom", key: "comfort_level"}
              {namespace: "custom", key: "mattress_type"}
              {namespace: "custom", key: "sleep_positions"}
              {namespace: "custom", key: "benefits"}
              {namespace: "custom", key: "product_line"}
              {namespace: "custom", key: "height_inches"}
              {namespace: "custom", key: "compare_group"}
            ]
          ) {
            key
            value
          }
        }
        pageInfo {
          hasNextPage
        }
      }
    }
  }
` as const;

type QuizProductNode = NonNullable<
  QuizProductsQuery['collection']
>['products']['nodes'][number];
type QuizVariantNode = QuizProductNode['variants']['nodes'][number];

function sizeOf(variant: QuizVariantNode): Size | null {
  const option = variant.selectedOptions.find(
    (candidate) => toSlug(candidate.name) === toSlug(SIZE_OPTION_NAME),
  );
  return option ? matchCanonical(SIZES, option.value) : null;
}

function mapVariant(variant: QuizVariantNode): SizeVariant | null {
  const size = sizeOf(variant);
  const priceCents = centsOf(mapMoney(variant.price));
  if (size === null || priceCents === null) return null;
  const compareAtCents = centsOf(mapMoney(variant.compareAtPrice));
  const dimensions = variant.dimensions?.value
    ? cleanText(variant.dimensions.value).slice(0, 80)
    : '';
  return {
    id: variant.id,
    size,
    sku: variant.sku && variant.sku.trim() !== '' ? variant.sku : null,
    dimensions: dimensions === '' ? null : dimensions,
    priceCents,
    // A compare-at price only counts above the price (REQ-COL-001).
    compareAtCents:
      compareAtCents !== null && compareAtCents > priceCents
        ? compareAtCents
        : null,
    available: variant.availableForSale,
  };
}

/** One variant per size: if the admin duplicated a size, the first one Shopify returned wins. */
function mapVariants(nodes: readonly QuizVariantNode[]): SizeVariant[] {
  const bySize = new Map<Size, SizeVariant>();
  for (const node of nodes) {
    const mapped = mapVariant(node);
    if (mapped && !bySize.has(mapped.size)) bySize.set(mapped.size, mapped);
  }
  return [...bySize.values()];
}

export function mapQuizProduct(node: QuizProductNode): CatalogProduct | null {
  const variants = mapVariants(node.variants.nodes);
  // No sized variant means the quiz can never recommend it (a pillow, a protector): leave it out.
  if (variants.length === 0) return null;
  const metafields = indexMetafields(node.metafields);
  const image = mapImage(node.featuredImage);
  const images: ProductImage[] = image
    ? [
        {
          url: image.url,
          altText: image.altText,
          width: image.width,
          height: image.height,
        },
      ]
    : [];
  return {
    id: node.id,
    handle: node.handle,
    title: node.title,
    brand: node.vendor,
    productType: node.productType,
    productLine: readText(metafields, PRODUCT_METAFIELD_KEYS.productLine),
    comfortLevel: readChoice(
      metafields,
      PRODUCT_METAFIELD_KEYS.comfortLevel,
      COMFORT_LEVELS,
    ),
    mattressType: readChoice(
      metafields,
      PRODUCT_METAFIELD_KEYS.mattressType,
      MATTRESS_TYPES,
    ),
    sleepPositions: readChoices(
      metafields,
      PRODUCT_METAFIELD_KEYS.sleepPositions,
      SLEEP_POSITIONS,
    ),
    benefits: readChoices(
      metafields,
      PRODUCT_METAFIELD_KEYS.benefits,
      BENEFITS,
    ),
    heightInches: readPositiveNumber(
      metafields,
      PRODUCT_METAFIELD_KEYS.heightInches,
    ),
    compareGroup: readText(metafields, PRODUCT_METAFIELD_KEYS.compareGroup),
    // Reviews arrive with the Judge.me integration, not with the catalog read.
    rating: null,
    images,
    variants,
  };
}

export function mapQuizProducts(
  nodes: readonly QuizProductNode[],
): CatalogProduct[] {
  return nodes.flatMap((node) => {
    const product = mapQuizProduct(node);
    return product ? [product] : [];
  });
}

/**
 * The mattress collection's products. A missing collection, no sized product or a failed read is an empty list:
 * the quiz reports "no mattresses" instead of inventing some. Failures are logged by class name only (T-05).
 */
export async function loadQuizProducts(
  storefront: Storefront,
): Promise<readonly CatalogProduct[]> {
  try {
    const {collection} = await storefront.query(QUIZ_PRODUCTS_QUERY, {
      cache: pricedCache(storefront),
      variables: {handle: PRIMARY_COLLECTION_HANDLE, first: QUIZ_PRODUCT_LIMIT},
    });
    if (!collection) return [];
    if (collection.products.pageInfo.hasNextPage) {
      logWarn('quiz.catalog_truncated', {limit: QUIZ_PRODUCT_LIMIT});
    }
    return mapQuizProducts(collection.products.nodes);
  } catch (error: unknown) {
    logError('quiz.catalog_read_failed', errorFields(error));
    return [];
  }
}
