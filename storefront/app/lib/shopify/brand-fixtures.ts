// SYNTHETIC brands for the brand pages, used only while the store has no `brand` metaobjects at all
// (REQ-COL-005, P3B-06). Names come from the fictional fixture catalog (app/lib/catalog/fixtures.ts), so a
// page built from them must say it is a preview and stay out of search engines (NFR-007, previewRobotsMeta).
// Removed from runtime paths once the client's brand entries exist and the development store holds them.

import {toSlug} from '~/lib/catalog/attributes';
import {FIXTURE_PRODUCTS} from '~/lib/catalog/fixtures';
import {
  isOnSale,
  isSoldOut,
  lowestAvailablePriceCents,
  sizesInOrder,
} from '~/lib/catalog/pricing';
import type {CatalogProduct} from '~/lib/catalog/types';
import {fromCents} from '~/lib/money';
import type {BrandView, ProductCardView} from '~/lib/shopify/types';

export type FixtureBrand = BrandView & {readonly handle: string};

const SAMPLE_ABOUT =
  'Sample brand description. The real text is written in Shopify admin.';

export const FIXTURE_BRANDS: readonly FixtureBrand[] = [
  ...new Set(FIXTURE_PRODUCTS.map((product) => product.brand)),
].map((name) => ({
  handle: toSlug(name),
  name,
  slug: toSlug(name),
  logo: null,
  about: [SAMPLE_ABOUT],
  warranty: [],
}));

export function findFixtureBrand(handle: string): FixtureBrand | null {
  return FIXTURE_BRANDS.find((brand) => brand.handle === handle) ?? null;
}

/** A card for a synthetic product: the cheapest buyable size, with no image (the fixture URLs never resolve). */
function cardFor(product: CatalogProduct): ProductCardView {
  const cents = lowestAvailablePriceCents(product);
  const cheapest =
    cents === null
      ? null
      : (product.variants.find(
          (variant) => variant.available && variant.priceCents === cents,
        ) ?? null);
  const distinctPrices = new Set(
    product.variants.filter((v) => v.available).map((v) => v.priceCents),
  ).size;

  return {
    id: product.id,
    handle: product.handle,
    title: product.title,
    vendor: product.brand,
    image: null,
    price:
      cheapest === null
        ? null
        : {amount: fromCents(cheapest.priceCents), currencyCode: 'USD'},
    compareAt:
      cheapest !== null &&
      cheapest.compareAtCents !== null &&
      isOnSale(cheapest)
        ? {amount: fromCents(cheapest.compareAtCents), currencyCode: 'USD'}
        : null,
    priceIsFrom: distinctPrices > 1,
    soldOut: isSoldOut(product),
    sizes: sizesInOrder(product),
    comfortLevel: product.comfortLevel,
    mattressType: product.mattressType,
    benefits: product.benefits,
    productLine: product.productLine,
    rating: product.rating,
  };
}

export function fixtureProductCards(brandName: string): ProductCardView[] {
  return FIXTURE_PRODUCTS.filter((product) => product.brand === brandName).map(
    cardFor,
  );
}
