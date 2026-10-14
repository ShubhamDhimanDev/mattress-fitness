// Product card view model (REQ-COL-001): "From $" is the lowest *available* variant price, the sale badge
// needs compare-at above that variant's price, and attribute badges exist only when the metafield does.

import type {CatalogProductCardFragment} from 'storefrontapi.generated';
import {
  BENEFITS,
  COMFORT_LEVELS,
  MATTRESS_TYPES,
  PRODUCT_METAFIELD_KEYS,
  SIZES,
  SIZE_OPTION_NAME,
  indexIn,
  toSlug,
} from '~/lib/catalog/attributes';
import {centsOf, mapImage, mapMoney} from '~/lib/shopify/common';
import {
  indexMetafields,
  readChoice,
  readChoices,
  readText,
} from '~/lib/shopify/metafields';
import type {ProductCardView} from '~/lib/shopify/types';
import type {MoneyV2Like} from '~/lib/money';

type CardVariant = CatalogProductCardFragment['variants']['nodes'][number];

type PricedVariant = {
  readonly price: MoneyV2Like;
  readonly priceCents: number;
  readonly compareAt: MoneyV2Like | null;
  readonly compareAtCents: number | null;
};

function priceVariant(variant: CardVariant): PricedVariant | null {
  const price = mapMoney(variant.price);
  const priceCents = centsOf(price);
  if (price === null || priceCents === null) return null;
  const compareAt = mapMoney(variant.compareAtPrice);
  return {price, priceCents, compareAt, compareAtCents: centsOf(compareAt)};
}

/** Size option values of the variants in the standard order, then any size we do not know. */
export function sizesOfVariants(
  variants: readonly Pick<CardVariant, 'selectedOptions'>[],
): string[] {
  const found = new Set<string>();
  for (const variant of variants) {
    for (const option of variant.selectedOptions) {
      if (toSlug(option.name) === toSlug(SIZE_OPTION_NAME)) {
        found.add(option.value);
      }
    }
  }
  // Array.sort is stable, so unknown sizes (equal rank) keep the order Shopify returned them in.
  return [...found].sort((a, b) => indexIn(SIZES, a) - indexIn(SIZES, b));
}

/**
 * Lowest-priced buyable variant. Ties keep the first one Shopify returned, so the card is stable
 * between requests.
 */
function lowestAvailable(variants: readonly CardVariant[]): {
  best: PricedVariant | null;
  distinctPrices: number;
} {
  let best: PricedVariant | null = null;
  const prices = new Set<number>();
  for (const variant of variants) {
    if (!variant.availableForSale) continue;
    const priced = priceVariant(variant);
    if (!priced) continue;
    prices.add(priced.priceCents);
    if (best === null || priced.priceCents < best.priceCents) best = priced;
  }
  return {best, distinctPrices: prices.size};
}

export function mapProductCard(
  product: CatalogProductCardFragment,
): ProductCardView {
  const variants = product.variants.nodes;
  const {best, distinctPrices} = lowestAvailable(variants);
  const onSale =
    best !== null &&
    best.compareAtCents !== null &&
    best.compareAtCents > best.priceCents;
  const metafields = indexMetafields(product.metafields);

  return {
    id: product.id,
    handle: product.handle,
    title: product.title,
    vendor: product.vendor,
    image: mapImage(product.featuredImage),
    price: best?.price ?? null,
    compareAt: onSale ? (best?.compareAt ?? null) : null,
    priceIsFrom: distinctPrices > 1,
    soldOut: best === null,
    sizes: sizesOfVariants(variants),
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
    benefits: readChoices(
      metafields,
      PRODUCT_METAFIELD_KEYS.benefits,
      BENEFITS,
    ),
    productLine: readText(metafields, PRODUCT_METAFIELD_KEYS.productLine),
    rating: null,
  };
}

/**
 * Search returns a union of node types (`... on Product`), so a node that is not a product arrives as an
 * empty object. Narrowing helper: only a node carrying the card fields is treated as a product.
 */
function isProductNode(node: object): node is CatalogProductCardFragment {
  return 'handle' in node && 'variants' in node && 'title' in node;
}

export function mapProductCards(
  products: readonly object[],
): ProductCardView[] {
  return products.filter(isProductNode).map(mapProductCard);
}
