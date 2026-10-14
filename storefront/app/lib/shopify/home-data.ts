// Home page data (REQ-HOME-001). Every section is built from catalog data and tolerates its absence: no
// featured collection, no brands and no size data each simply remove their section. The mapping is pure
// (`buildHomeData`) so it is tested against recorded responses; `loadHome` only runs the query.

import type {Storefront} from '@shopify/hydrogen';
import type {
  CatalogHomeQuery,
  CatalogHomeSectionsQuery,
} from 'storefrontapi.generated';
import {SIZES, matchCanonical, type Size} from '~/lib/catalog/attributes';
import {cleanText} from '~/lib/catalog/text';
import {
  emptyFilterState,
  serializeFilterParams,
  toggleSelection,
} from '~/lib/filters';
import {catalogCache, pricedCache} from '~/lib/shopify/cache';
import {mapProductCards} from '~/lib/shopify/card';
import {brandPath, normalizeBrandSlug} from '~/lib/shopify/brand-data';
import {fieldRecord, mapImage} from '~/lib/shopify/common';
import {BRAND_FIELDS, PRIMARY_COLLECTION_HANDLE} from '~/lib/shopify/config';
import {
  PLACEHOLDER_HOME_SECTIONS,
  mapHomeSections,
  type HomeSection,
} from '~/lib/shopify/home-sections';
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

/**
 * The homepage_section entries (REQ-HOME-001). No price or availability is read here, so unlike the product
 * cards it uses the long cache; the client's edits show after the cache window.
 */
export const HOME_SECTIONS_QUERY = `#graphql
  query CatalogHomeSections($country: CountryCode, $language: LanguageCode)
  @inContext(country: $country, language: $language) {
    sections: metaobjects(type: "homepage_section", first: 30) {
      nodes {
        id
        fields {
          key
          value
          reference {
            ... on MediaImage {
              image {
                url
                altText
                width
                height
              }
            }
          }
        }
      }
    }
  }
` as const;

export type HomeData = {
  readonly featured: {
    readonly title: string;
    readonly handle: string | null;
    readonly products: readonly ProductCardView[];
  } | null;
  readonly sizeTiles: readonly SizeTile[];
  readonly brandTiles: readonly BrandTile[];
  readonly collectionTiles: readonly CollectionTile[];
  /** Blocks in display order: from admin when it has usable entries, else the placeholder layout. */
  readonly sections: readonly HomeSection[];
  readonly sectionsSource: 'admin' | 'placeholder';
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
    // A brand with a usable slug has its own page (REQ-COL-005); without one the tile filters a collection.
    const slug = normalizeBrandSlug(fields[BRAND_FIELDS.slug]);
    tiles.push({
      name,
      to: slug ? brandPath(slug) : brandHref(collectionHandle, name),
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

export function buildHomeData(
  home: CatalogHomeQuery,
  sectionNodes: CatalogHomeSectionsQuery['sections']['nodes'] = [],
): HomeData {
  const adminSections = mapHomeSections(sectionNodes);
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
    sections:
      adminSections.length > 0 ? adminSections : PLACEHOLDER_HOME_SECTIONS,
    sectionsSource: adminSections.length > 0 ? 'admin' : 'placeholder',
  };
}

export async function loadHome(storefront: Storefront): Promise<HomeData> {
  const [home, sections] = await Promise.all([
    storefront.query(HOME_QUERY, {
      // Product cards carry price and availability, so this is the 60 s strategy, not the long one (DEC-024).
      cache: pricedCache(storefront),
      variables: {primaryHandle: PRIMARY_COLLECTION_HANDLE},
    }),
    loadHomeSections(storefront),
  ]);
  return buildHomeData(home, sections);
}

/** A failed sections read must not take the home page down: the placeholder layout is used instead (NFR-013). */
async function loadHomeSections(
  storefront: Storefront,
): Promise<CatalogHomeSectionsQuery['sections']['nodes']> {
  try {
    const {sections} = await storefront.query(HOME_SECTIONS_QUERY, {
      cache: catalogCache(storefront),
    });
    return sections.nodes;
  } catch {
    // No error text is logged: it can quote the request (T-05).
    console.error('[home] could not read the homepage sections');
    return [];
  }
}
