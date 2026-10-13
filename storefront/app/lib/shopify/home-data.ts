// Home page data (REQ-HOME-001). Every section is built from catalog data and tolerates its absence: no
// featured collection, no brands and no size data each simply remove their section. The mapping is pure
// (`buildHomeData`) so it is tested against recorded responses; `loadHome` only runs the query.

import type {Storefront} from '@shopify/hydrogen';
import type {CatalogHomeQuery} from 'storefrontapi.generated';
import {SIZES, matchCanonical, type Size} from '~/lib/catalog/attributes';
import {cleanText} from '~/lib/catalog/text';
import {
  emptyFilterState,
  serializeFilterParams,
  toggleSelection,
} from '~/lib/filters';
import {catalogCache} from '~/lib/shopify/cache';
import {mapProductCards} from '~/lib/shopify/card';
import {fieldRecord, mapImage} from '~/lib/shopify/common';
import {BRAND_FIELDS, PRIMARY_COLLECTION_HANDLE} from '~/lib/shopify/config';
import {HOME_QUERY} from '~/lib/shopify/queries';
import type {ImageView, ProductCardView} from '~/lib/shopify/types';

const MAX_BRAND_TILES = 8;
const MAX_COLLECTION_TILES = 6;
/** Sizes offered as tiles when the catalog has no size data yet: the six regular sizes. */
const DEFAULT_SIZE_TILES: readonly Size[] = SIZES.slice(0, 6);

export type SizeTile = {readonly label: string; readonly to: string};

export type BrandTile = {
  readonly name: string;
  readonly to: string;
  readonly logo: ImageView | null;
};

export type CollectionTile = {
  readonly title: string;
  readonly to: string;
  readonly image: ImageView | null;
};

export type HomeData = {
  readonly featured: {
    readonly title: string;
    readonly handle: string | null;
    readonly products: readonly ProductCardView[];
  } | null;
  readonly sizeTiles: readonly SizeTile[];
  readonly brandTiles: readonly BrandTile[];
  readonly collectionTiles: readonly CollectionTile[];
};

/** `/collections/<handle>?size=queen`: a link the collection page understands through the filter codec. */
export function sizeTileHref(collectionHandle: string | null, size: Size) {
  const base = collectionHandle
    ? `/collections/${collectionHandle}`
    : '/collections';
  const state = toggleSelection(emptyFilterState(), {
    kind: 'value',
    dimension: 'size',
    value: size,
  });
  return `${base}?${serializeFilterParams(state).toString()}`;
}

function brandHref(collectionHandle: string | null, name: string): string {
  const base = collectionHandle
    ? `/collections/${collectionHandle}`
    : '/collections';
  const state = toggleSelection(emptyFilterState(), {
    kind: 'value',
    dimension: 'brand',
    value: name,
  });
  return `${base}?${serializeFilterParams(state).toString()}`;
}

function knownSizes(products: readonly ProductCardView[]): Size[] {
  const found = new Set<Size>();
  for (const product of products) {
    for (const size of product.sizes) {
      const known = matchCanonical(SIZES, size);
      if (known !== null) found.add(known);
    }
  }
  return SIZES.filter((size) => found.has(size));
}

function brandTilesFrom(
  home: CatalogHomeQuery,
  products: readonly ProductCardView[],
  collectionHandle: string | null,
): BrandTile[] {
  const tiles: BrandTile[] = [];
  for (const entry of home.brands.nodes) {
    const fields = fieldRecord(entry.fields);
    const name = fields[BRAND_FIELDS.name]
      ? cleanText(fields[BRAND_FIELDS.name])
      : '';
    if (name === '') continue;
    const logoField = entry.fields.find(
      (field) => field.key === BRAND_FIELDS.logo,
    );
    const reference = logoField?.reference;
    tiles.push({
      name,
      to: brandHref(collectionHandle, name),
      logo:
        reference && 'image' in reference ? mapImage(reference.image) : null,
    });
  }
  if (tiles.length > 0) return tiles.slice(0, MAX_BRAND_TILES);

  // No brand metaobjects yet: fall back to the vendors of the featured products.
  const vendors = [
    ...new Set(
      products.map((product) => cleanText(product.vendor)).filter(Boolean),
    ),
  ];
  return vendors.slice(0, MAX_BRAND_TILES).map((name) => ({
    name,
    to: brandHref(collectionHandle, name),
    logo: null,
  }));
}

export function buildHomeData(home: CatalogHomeQuery): HomeData {
  const primary = home.primary;
  const usedFallback = primary === null || primary === undefined;
  const products = mapProductCards(
    primary ? primary.products.nodes : home.fallbackProducts.nodes,
  );
  // Size and brand tiles filter a collection; without the mattress collection, use the first one there is.
  const collectionHandle =
    primary?.handle ?? home.collections.nodes[0]?.handle ?? null;

  const sizes = knownSizes(products);
  const sizeList = sizes.length > 0 ? sizes : DEFAULT_SIZE_TILES;

  return {
    featured:
      products.length === 0
        ? null
        : {
            title: primary?.title ?? 'Best sellers',
            handle: usedFallback ? null : (primary?.handle ?? null),
            products,
          },
    sizeTiles: sizeList.map((size) => ({
      label: size,
      to: sizeTileHref(collectionHandle, size),
    })),
    brandTiles: brandTilesFrom(home, products, collectionHandle),
    collectionTiles: home.collections.nodes
      .slice(0, MAX_COLLECTION_TILES)
      .map((collection) => ({
        title: collection.title,
        to: `/collections/${collection.handle}`,
        image: mapImage(collection.image),
      })),
  };
}

export async function loadHome(storefront: Storefront): Promise<HomeData> {
  const home = await storefront.query(HOME_QUERY, {
    cache: catalogCache(storefront),
    variables: {primaryHandle: PRIMARY_COLLECTION_HANDLE},
  });
  return buildHomeData(home);
}
