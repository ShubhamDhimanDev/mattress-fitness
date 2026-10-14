// Brand pages (REQ-COL-005, P3B-06): `/brands` lists the `brand` metaobjects and `/brands/<handle>` shows one
// brand with its products in the shared listing. The brand's content (logo, about, warranty terms) is the
// same entry the product page's brand section reads, so one edit in admin updates both.
//
// ASSUMPTION(V-05): the metaobject handle equals the `slug` field (the definition says so) and the brand name
// equals the Shopify vendor of its products. Both are checked on the development store.
//
// While a development or mock store has no `brand` entries at all, fictional fixtures stand in (source
// 'fixtures'; the pages then say so and are kept out of search engines). A store that has brands never shows
// fixtures, and neither does production: callers pass `allowFixtures` from the build mode, so a live store
// with no brands yet answers 404 / "not available" instead of publishing fictional brands.

import type {Storefront} from '@shopify/hydrogen';
import type {
  CatalogBrandPageQuery,
  CatalogBrandsIndexQuery,
} from 'storefrontapi.generated';
import {cleanText} from '~/lib/catalog/text';
import {normalizeFilterState, type FilterState} from '~/lib/filters';
import {catalogCache} from '~/lib/shopify/cache';
import {fieldRecord, mapImage} from '~/lib/shopify/common';
import {BRAND_FIELDS, PRIMARY_COLLECTION_HANDLE} from '~/lib/shopify/config';
import {
  FIXTURE_BRANDS,
  findFixtureBrand,
  fixtureProductCards,
} from '~/lib/shopify/brand-fixtures';
import {isValidHandle, loadCollectionPage} from '~/lib/shopify/collection-data';
import type {FilterGroupView} from '~/lib/shopify/listing';
import {richTextToParagraphs} from '~/lib/shopify/rich-text';
import type {
  BrandView,
  ImageView,
  PageInfoView,
  ProductCardView,
} from '~/lib/shopify/types';
import type {DataSource} from '~/lib/pages/data-source';

/** Names and logos only (no price or availability), so the long cache applies. */
export const BRANDS_INDEX_QUERY = `#graphql
  query CatalogBrandsIndex($country: CountryCode, $language: LanguageCode)
  @inContext(country: $country, language: $language) {
    brands: metaobjects(type: "brand", first: 100) {
      nodes {
        id
        handle
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

/**
 * One brand by handle, plus a one-item probe of the brand list so a missing handle can be told apart from a
 * store that has no brands yet (only the latter falls back to fixtures).
 */
export const BRAND_PAGE_QUERY = `#graphql
  query CatalogBrandPage(
    $handle: String!
    $country: CountryCode
    $language: LanguageCode
  ) @inContext(country: $country, language: $language) {
    brand: metaobject(handle: {handle: $handle, type: "brand"}) {
      id
      handle
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
    anyBrand: metaobjects(type: "brand", first: 1) {
      nodes {
        id
      }
    }
  }
` as const;

type BrandNode = NonNullable<CatalogBrandPageQuery['brand']>;
type IndexNode = CatalogBrandsIndexQuery['brands']['nodes'][number];

/** A brand with the handle its page lives at. */
export type BrandPageView = BrandView & {readonly handle: string};

export type BrandSummary = {
  readonly handle: string;
  readonly name: string;
  readonly logo: ImageView | null;
  readonly to: string;
};

const HANDLE_LIKE = /^[a-z0-9][a-z0-9-]{0,99}$/;

/** The handle of a brand's page, or null when the stored slug cannot be used in a URL. */
export function normalizeBrandSlug(
  raw: string | null | undefined,
): string | null {
  const slug = (raw ?? '').trim().toLowerCase();
  return HANDLE_LIKE.test(slug) ? slug : null;
}

export function brandPath(handle: string): string {
  return `/brands/${encodeURIComponent(handle)}`;
}

function logoOf(node: BrandNode | IndexNode): ImageView | null {
  const field = node.fields.find((f) => f.key === BRAND_FIELDS.logo);
  const reference = field?.reference;
  return reference && 'image' in reference ? mapImage(reference.image) : null;
}

/** A brand entry as a page view; null when it has no usable name or handle. */
export function mapBrandNode(
  node: BrandNode | IndexNode,
): BrandPageView | null {
  const fields = fieldRecord(node.fields);
  const name = fields[BRAND_FIELDS.name]
    ? cleanText(fields[BRAND_FIELDS.name]).slice(0, 120)
    : '';
  // The Shopify handle is canonical (the slug field is documented to equal it); the field is the fallback.
  const handle =
    normalizeBrandSlug(node.handle) ??
    normalizeBrandSlug(fields[BRAND_FIELDS.slug]);
  if (name === '' || handle === null) return null;
  return {
    handle,
    name,
    slug: handle,
    logo: logoOf(node),
    about: richTextToParagraphs(fields[BRAND_FIELDS.about]),
    warranty: richTextToParagraphs(fields[BRAND_FIELDS.warranty]),
  };
}

export type BrandsIndex = {
  readonly source: DataSource;
  readonly brands: readonly BrandSummary[];
};

function summaryOf(brand: BrandPageView): BrandSummary {
  return {
    handle: brand.handle,
    name: brand.name,
    logo: brand.logo,
    to: brandPath(brand.handle),
  };
}

/** Fixtures are a development and mock-store aid only; the default is the safe one. */
export type FixtureOption = {readonly allowFixtures?: boolean};

export function buildBrandsIndex(
  nodes: readonly IndexNode[] | null | undefined,
  options: FixtureOption = {},
): BrandsIndex {
  const seen = new Set<string>();
  const brands: BrandSummary[] = [];
  for (const node of nodes ?? []) {
    const brand = mapBrandNode(node);
    if (brand === null || seen.has(brand.handle)) continue;
    seen.add(brand.handle);
    brands.push(summaryOf(brand));
  }
  if (brands.length > 0) {
    brands.sort((a, b) => a.name.localeCompare(b.name, 'en'));
    return {source: 'shopify', brands};
  }
  if (options.allowFixtures !== true) return {source: 'shopify', brands: []};
  return {
    source: 'fixtures',
    brands: FIXTURE_BRANDS.map((brand) => summaryOf(brand)),
  };
}

export async function loadBrandsIndex(
  storefront: Storefront,
  options: FixtureOption = {},
): Promise<BrandsIndex> {
  try {
    const {brands} = await storefront.query(BRANDS_INDEX_QUERY, {
      cache: catalogCache(storefront),
    });
    return buildBrandsIndex(brands.nodes, options);
  } catch {
    // An empty list with a message, never the fictional preview list: the store may well have real brands.
    // Nothing from the request is logged (T-05).
    console.error('[brands] could not read the brand list');
    return {source: 'shopify', brands: []};
  }
}

export type BrandPage =
  | {
      readonly status: 'ok';
      readonly source: DataSource;
      readonly brand: BrandPageView;
      readonly products: readonly ProductCardView[];
      readonly pageInfo: PageInfoView;
      readonly filterGroups: readonly FilterGroupView[];
    }
  | {readonly status: 'not-found'}
  /** The brand read failed; the page shows a fixed message and the shopper can retry (NFR-013). */
  | {readonly status: 'unavailable'};

const NO_MORE: PageInfoView = {hasNextPage: false, endCursor: null};

/**
 * The listing state for a brand page: the shopper's filters and sort, with the brand forced to this one.
 * Null when the brand name cannot be expressed as a filter value, in which case no products are listed
 * (listing every product under a brand's name would be worse than listing none).
 */
export function brandListingState(
  state: FilterState,
  brandName: string,
): FilterState | null {
  const forced = normalizeFilterState({
    ...state,
    selected: {...state.selected, brand: [brandName]},
  });
  return forced.selected.brand.length === 1 &&
    forced.selected.brand[0] === brandName
    ? forced
    : null;
}

async function listBrandProducts(
  storefront: Storefront,
  brand: BrandPageView,
  state: FilterState,
) {
  const forced = brandListingState(state, brand.name);
  if (forced === null) return null;
  // ASSUMPTION(V-05): a rule-based collection named after the brand's handle may exist (REQ-CAT-005); if not,
  // the main mattress collection filtered by vendor is used. The vendor filter applies either way.
  for (const handle of [brand.handle, PRIMARY_COLLECTION_HANDLE]) {
    const page = await loadCollectionPage(storefront, handle, forced);
    if (page.status === 'ok') return page;
  }
  return null;
}

/** The brand filter is fixed on a brand page, so its group is not offered. */
function withoutBrandGroup(
  groups: readonly FilterGroupView[],
): FilterGroupView[] {
  return groups.filter((group) => group.dimension !== 'brand');
}

function readBrand(storefront: Storefront, handle: string) {
  return storefront.query(BRAND_PAGE_QUERY, {
    cache: catalogCache(storefront),
    variables: {handle},
  });
}

export async function loadBrandPage(
  storefront: Storefront,
  handle: string,
  state: FilterState,
  options: FixtureOption = {},
): Promise<BrandPage> {
  if (!isValidHandle(handle)) return {status: 'not-found'};

  let read: Awaited<ReturnType<typeof readBrand>>;
  try {
    read = await readBrand(storefront, handle);
  } catch {
    // Degrades like the index: a fixed state, not a 500. Nothing from the request is logged (T-05).
    console.error('[brands] could not read the brand');
    return {status: 'unavailable'};
  }
  const {brand: node, anyBrand} = read;

  const brand = node ? mapBrandNode(node) : null;
  if (brand !== null) {
    const listing = await listBrandProducts(storefront, brand, state);
    return {
      status: 'ok',
      source: 'shopify',
      brand,
      products: listing?.products ?? [],
      pageInfo: listing?.pageInfo ?? NO_MORE,
      filterGroups: listing ? withoutBrandGroup(listing.filterGroups) : [],
    };
  }

  // Not found in Shopify. Fixtures answer only outside production, and only when the store has no brand
  // entries at all.
  if (options.allowFixtures !== true || anyBrand.nodes.length > 0) {
    return {status: 'not-found'};
  }
  const fixture = findFixtureBrand(handle);
  if (fixture === null) return {status: 'not-found'};
  return {
    status: 'ok',
    source: 'fixtures',
    brand: fixture,
    products: fixtureProductCards(fixture.name),
    pageInfo: NO_MORE,
    filterGroups: [],
  };
}

/**
 * Brand structured data from the same fields the page shows (nothing is added that the page does not say).
 * `url` needs the site's absolute origin; without one it is left out rather than emitted as a relative path,
 * which structured-data consumers reject.
 */
export function buildBrandJsonLd(
  brand: BrandPageView,
  origin: string | null,
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Brand',
    name: brand.name,
    ...(origin ? {url: `${origin}${brandPath(brand.handle)}`} : {}),
    ...(brand.logo ? {logo: brand.logo.url} : {}),
    ...(brand.about.length > 0
      ? {description: brand.about.join(' ').slice(0, 1000)}
      : {}),
  };
}
