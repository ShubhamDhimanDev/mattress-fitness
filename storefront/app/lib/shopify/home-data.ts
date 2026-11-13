// Home page data (REQ-HOME-001). Every section is built from catalog data and tolerates its absence: no
// featured collection, no brands and no size data each simply remove their section. The mapping is pure
// (`buildHomeData`) so it is tested against recorded responses; `loadHome` only runs the query.

import type {Storefront} from '~/lib/hydrogen/storefront';
import type {
  CatalogHomeFaqsQuery,
  CatalogHomeQuery,
  CatalogHomeSectionsQuery,
} from 'storefrontapi.generated';
import {SIZES, matchCanonical, type Size} from '~/lib/catalog/attributes';
import {bundledBrandLogo} from '~/lib/brand-logos';
import {cleanText} from '~/lib/catalog/text';
import {
  emptyFilterState,
  serializeFilterParams,
  toggleSelection,
} from '~/lib/filters';
import {catalogCache, pricedCache} from '~/lib/shopify/cache';
import {mapProductCards} from '~/lib/shopify/card';
import {brandOffersPath, normalizeBrandSlug} from '~/lib/shopify/brand-path';
import {fieldRecord, mapImage} from '~/lib/shopify/common';
import {BRAND_FIELDS, PRIMARY_COLLECTION_HANDLE} from '~/lib/shopify/config';
import {buildFinder, type HomeFinderData} from '~/lib/shopify/home-finder';
import {
  PLACEHOLDER_HOME_SECTIONS,
  mapHomeSections,
  type HomeSection,
} from '~/lib/shopify/home-sections';
import {mapFaqs} from '~/lib/shopify/product';
import {HOME_QUERY} from '~/lib/shopify/queries';
import type {FaqView, ImageView, ProductCardView} from '~/lib/shopify/types';
import {logError} from '~/lib/logging/logger';

// Fourteen: the thirteen brands of the store (Skechers was added 2026-11-12) and room for one more.
const MAX_BRAND_TILES = 14;
const MAX_COLLECTION_TILES = 6;
const MAX_HOME_FAQS = 10;
/** `faq.scope` value for entries that belong on general pages such as the home page. */
const GENERAL_FAQ_SCOPE = 'general';
const FAQ_SCOPE_FIELD = 'scope';
/** Shopify's built-in "Home page" list (`frontpage`) is an internal collection, not a category a shopper would browse (seen on the real store). */
const INTERNAL_COLLECTION_HANDLES: ReadonlySet<string> = new Set(['frontpage']);
/** Sizes offered in the hero finder when the catalog has no size data yet: the six regular sizes. */
const DEFAULT_SIZE_TILES: readonly Size[] = SIZES.slice(0, 6);

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
 * cards it uses the long cache; the client's edits show after the cache window. `references` carries the
 * `homepage_card` entries of the `cards` field (CR-31); on every other field it is null.
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
          references(first: 6) {
            nodes {
              ... on Metaobject {
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
        }
      }
    }
  }
` as const;

/**
 * The FAQ entries for the home `faq` block. Read only when admin has such a block (see `loadHome`), with the long cache
 * like the sections. Which entries belong on the home page is decided by their `scope` field (`general`), not here.
 */
export const HOME_FAQS_QUERY = `#graphql
  query CatalogHomeFaqs($country: CountryCode, $language: LanguageCode)
  @inContext(country: $country, language: $language) {
    faqs: metaobjects(type: "faq", first: 50) {
      nodes {
        id
        fields {
          key
          value
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
  readonly brandTiles: readonly BrandTile[];
  readonly collectionTiles: readonly CollectionTile[];
  /** The hero's finder card; null when there is nothing to choose from (the card is then left out). */
  readonly finder: HomeFinderData | null;
  /** The general FAQ entries for the home `faq` block; empty when there are none or the page has no such block. */
  readonly faqs: readonly FaqView[];
  /** Blocks in display order: from admin when it has usable entries, else the placeholder layout. */
  readonly sections: readonly HomeSection[];
  readonly sectionsSource: 'admin' | 'placeholder';
};

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
      to: slug ? brandOffersPath(slug) : brandHref(collectionHandle, name),
      logo:
        (reference && 'image' in reference
          ? mapImage(reference.image)
          : null) ?? bundledBrandLogo(slug, name),
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
    logo: bundledBrandLogo(name),
  }));
}

/**
 * The FAQ entries whose `scope` is `general` (case and spacing forgiven), in the order Shopify returned them. An entry
 * missing its question or answer is skipped by `mapFaqs`; at most ten are shown.
 */
export function mapGeneralFaqs(
  nodes: CatalogHomeFaqsQuery['faqs']['nodes'] | null | undefined,
): FaqView[] {
  const general = (nodes ?? []).filter(
    (node) =>
      fieldRecord(node.fields)[FAQ_SCOPE_FIELD]?.trim().toLowerCase() ===
      GENERAL_FAQ_SCOPE,
  );
  return mapFaqs(general).slice(0, MAX_HOME_FAQS);
}

export function buildHomeData(
  home: CatalogHomeQuery,
  sectionNodes: CatalogHomeSectionsQuery['sections']['nodes'] = [],
  faqNodes: CatalogHomeFaqsQuery['faqs']['nodes'] = [],
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
  const brandTiles = brandTilesFrom(home, products, collectionHandle);

  return {
    featured:
      products.length === 0
        ? null
        : {
            title: primary?.title ?? 'Best sellers',
            handle: usedFallback ? null : (primary?.handle ?? null),
            products,
          },
    brandTiles,
    finder: buildFinder(
      collectionHandle,
      sizeList,
      brandTiles.map((tile) => tile.name),
    ),
    faqs: mapGeneralFaqs(faqNodes),
    collectionTiles: home.collections.nodes
      .filter(
        (collection) => !INTERNAL_COLLECTION_HANDLES.has(collection.handle),
      )
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

/** Three full rows on desktop; the query reads more (36) so the pick has several brands to choose from. */
export const HOME_FEATURED_COUNT = 9;

/** How far from 1:1 a photo may be and still count as square (owner request 2026-11-12): 1200x1100 passes, 1200x886 does not. */
export const SQUARE_PHOTO_TOLERANCE = 0.05;

/** True when the card's photo is square. A card with no photo, or no known size, is not. */
export function hasSquarePhoto(product: {
  readonly image: {
    readonly width?: number | null;
    readonly height?: number | null;
  } | null;
}): boolean {
  const width = product.image?.width;
  const height = product.image?.height;
  if (typeof width !== 'number' || typeof height !== 'number') return false;
  if (!(width > 0) || !(height > 0)) return false;
  return Math.abs(width / height - 1) <= SQUARE_PHOTO_TOLERANCE;
}

/** Fisher-Yates on a copy; `random` is injectable so the order can be fixed in tests. */
export function shuffled<T>(
  items: readonly T[],
  random: () => number = Math.random,
): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const a = copy[i];
    const b = copy[j];
    if (a === undefined || b === undefined) continue;
    copy[i] = b;
    copy[j] = a;
  }
  return copy;
}

/**
 * Picks `count` items spread across brands: brands are shuffled, then one random item is taken from each in turn, and
 * the rounds repeat until `count` is reached. Mattresses of one brand look alike, so a plain random pick can show
 * nine near-identical cards. Items without a brand count as one brand together.
 */
export function pickAcrossBrands<T>(
  items: readonly T[],
  brandOf: (item: T) => string,
  count: number,
  random: () => number = Math.random,
): T[] {
  const byBrand = new Map<string, T[]>();
  for (const item of shuffled(items, random)) {
    const brand = brandOf(item).trim().toLowerCase();
    const group = byBrand.get(brand);
    if (group) group.push(item);
    else byBrand.set(brand, [item]);
  }
  const groups = shuffled([...byBrand.values()], random);
  const picked: T[] = [];
  for (let round = 0; picked.length < count; round++) {
    let added = false;
    for (const group of groups) {
      const item = group[round];
      if (item === undefined) continue;
      picked.push(item);
      added = true;
      if (picked.length === count) break;
    }
    if (!added) break;
  }
  // Rounds fill the front with one of each brand first; shuffle so the same brands are not always at the top.
  return shuffled(picked, random);
}

/**
 * The featured block shows a different pick on each page load, spread across brands. Done per request in the loader,
 * after the (cached) catalog read, so the server and browser render the same order and nothing is cached per shopper.
 *
 * Only products with a square photo are picked (owner request 2026-11-12): cards take their photo's shape, and a row that
 * mixes square and landscape photos leaves blank space under the shorter ones. If no product has a square photo, every
 * product stays a candidate, so the block is never empty because of this rule.
 *
 * Mattresses on sale come first (owner request 2026-11-13): a card is on sale when it has a compare-at price above its price.
 * Each group is picked at random and spread across brands; when fewer are on sale than there are places, the places that are
 * left are filled with ordinary mattresses (same square-photo rule), so the block is always as full as the catalog allows.
 */
export function withRandomFeatured(
  home: HomeData,
  random: () => number = Math.random,
): HomeData {
  if (!home.featured) return home;
  const square = home.featured.products.filter(hasSquarePhoto);
  const candidates = square.length > 0 ? square : home.featured.products;
  const onSale = candidates.filter((product) => Boolean(product.compareAt));
  const ordinary = candidates.filter((product) => !product.compareAt);
  const brandOf = (product: {readonly vendor: string}) => product.vendor;
  const picked = pickAcrossBrands(onSale, brandOf, HOME_FEATURED_COUNT, random);
  const topUp =
    picked.length < HOME_FEATURED_COUNT
      ? pickAcrossBrands(
          ordinary,
          brandOf,
          HOME_FEATURED_COUNT - picked.length,
          random,
        )
      : [];
  return {
    ...home,
    featured: {...home.featured, products: [...picked, ...topUp]},
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
  // The FAQ entries are read only when admin placed a `faq` block: a page without one does not ask for them.
  const wantsFaqs = mapHomeSections(sections).some(
    (section) => section.kind === 'block' && section.type === 'faq',
  );
  return withRandomFeatured(
    buildHomeData(
      home,
      sections,
      wantsFaqs ? await loadHomeFaqs(storefront) : [],
    ),
  );
}

/** A failed FAQ read leaves the block out and nothing else (NFR-013). */
async function loadHomeFaqs(
  storefront: Storefront,
): Promise<CatalogHomeFaqsQuery['faqs']['nodes']> {
  try {
    const {faqs} = await storefront.query(HOME_FAQS_QUERY, {
      cache: catalogCache(storefront),
    });
    return faqs.nodes;
  } catch {
    logError('home.faqs_read_failed');
    return [];
  }
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
    logError('home.sections_read_failed');
    return [];
  }
}
