import {afterEach, describe, expect, it, vi} from 'vitest';
import collection from '../../fixtures/shopify/collection.json';
import {fakeStorefront} from './fake-storefront';
import {emptyFilterState, parseFilterParams} from '~/lib/filters';
import {
  BRANDS_INDEX_QUERY,
  BRAND_PAGE_QUERY,
  brandListingState,
  brandPath,
  buildBrandJsonLd,
  buildBrandsIndex,
  loadBrandPage,
  loadBrandsIndex,
  mapBrandNode,
  normalizeBrandSlug,
} from '~/lib/shopify/brand-data';
import {FIXTURE_BRANDS} from '~/lib/shopify/brand-fixtures';

// REQ-COL-005 / P3B-06: brand pages from the `brand` metaobject, fixtures only when the store has none
// AND the caller allows them (development and mock stores, never production).

afterEach(() => {
  vi.restoreAllMocks();
});

type Node = Parameters<typeof mapBrandNode>[0];

function brandNode(
  handle: string,
  fields: Record<string, string>,
  logo?: string,
): Node {
  return {
    id: `gid://shopify/Metaobject/${handle}`,
    handle,
    fields: [
      ...Object.entries(fields).map(([key, value]) => ({
        key,
        value,
        reference: null,
      })),
      ...(logo
        ? [
            {
              key: 'logo',
              value: 'gid://shopify/MediaImage/1',
              reference: {
                image: {url: logo, altText: null, width: 1, height: 1},
              },
            },
          ]
        : []),
    ],
  };
}

const richText = (text: string) =>
  JSON.stringify({
    type: 'root',
    children: [{type: 'paragraph', children: [{type: 'text', value: text}]}],
  });

const ACME = brandNode(
  'acme-sleep',
  {
    name: 'Acme Sleep',
    slug: 'acme-sleep',
    about: richText('About <b>Acme</b>'),
    warranty_terms: richText('Ten years'),
  },
  'https://cdn.shopify.com/logo.png',
);

describe('normalizeBrandSlug', () => {
  it.each(['acme', 'acme-sleep', 'a1'])('accepts %s', (slug) => {
    expect(normalizeBrandSlug(slug)).toBe(slug);
  });
  it('lower-cases and trims', () => {
    expect(normalizeBrandSlug('  Acme-Sleep ')).toBe('acme-sleep');
  });
  it.each(['', '-x', 'a b', '../x', 'a/b', '<x>', null, undefined])(
    'rejects %j',
    (slug) => {
      expect(normalizeBrandSlug(slug)).toBeNull();
    },
  );
});

describe('mapBrandNode', () => {
  it('maps name, logo and flattened rich text (markup is stripped)', () => {
    const brand = mapBrandNode(ACME);
    expect(brand).toMatchObject({
      handle: 'acme-sleep',
      name: 'Acme Sleep',
      logo: {url: 'https://cdn.shopify.com/logo.png'},
      about: ['About Acme'],
      warranty: ['Ten years'],
    });
  });

  it('skips entries without a name or a usable handle', () => {
    expect(mapBrandNode(brandNode('acme', {slug: 'acme'}))).toBeNull();
    expect(mapBrandNode(brandNode('Bad Handle', {name: 'X'}))).toBeNull();
  });

  it('falls back to the slug field when the handle is unusable', () => {
    expect(
      mapBrandNode(brandNode('Bad Handle', {name: 'X', slug: 'x-brand'}))
        ?.handle,
    ).toBe('x-brand');
  });
});

describe('brands index', () => {
  it('lists Shopify brands sorted by name, without duplicates', () => {
    const index = buildBrandsIndex([
      brandNode('zed', {name: 'Zed'}),
      ACME,
      ACME,
    ]);
    expect(index.source).toBe('shopify');
    expect(index.brands.map((b) => b.name)).toEqual(['Acme Sleep', 'Zed']);
    expect(index.brands[0].to).toBe('/brands/acme-sleep');
  });

  it('uses the fictional fixtures only when allowed and the store has no usable brand', () => {
    const index = buildBrandsIndex([], {allowFixtures: true});
    expect(index.source).toBe('fixtures');
    expect(index.brands.map((b) => b.name)).toEqual(
      FIXTURE_BRANDS.map((b) => b.name),
    );
    // Production passes no permission: an empty live store lists nothing rather than fictional brands.
    expect(buildBrandsIndex([])).toEqual({source: 'shopify', brands: []});
    expect(buildBrandsIndex([], {allowFixtures: false})).toEqual({
      source: 'shopify',
      brands: [],
    });
    // A store with brands never shows fixtures, allowed or not.
    expect(buildBrandsIndex([ACME], {allowFixtures: true}).source).toBe(
      'shopify',
    );
  });

  it('reads with the long cache; a failed read is an empty list, not fictional brands', async () => {
    const ok = fakeStorefront(() => ({brands: {nodes: [ACME]}}));
    expect((await loadBrandsIndex(ok.storefront)).brands).toHaveLength(1);
    expect(ok.calls[0]).toMatchObject({
      query: BRANDS_INDEX_QUERY,
      cache: {mode: 'long'},
    });
    const failing = fakeStorefront(() => {
      throw new Error('down');
    });
    expect(await loadBrandsIndex(failing.storefront)).toEqual({
      source: 'shopify',
      brands: [],
    });
  });
});

describe('brandListingState', () => {
  it('forces the brand and replaces one from the URL', () => {
    const state = parseFilterParams(
      new URLSearchParams('brand=Other&size=queen'),
    );
    const forced = brandListingState(state, 'Acme Sleep');
    expect(forced?.selected.brand).toEqual(['Acme Sleep']);
    expect(forced?.selected.size).toEqual(['Queen']);
  });

  it('refuses a name that cannot be a filter value instead of listing every product', () => {
    expect(brandListingState(emptyFilterState(), '<<>>')).toBeNull();
  });
});

// The recorded products belong to another vendor; a store without Search & Discovery filters is filtered by our own code, so
// the brand page only lists products whose vendor is the brand.
const acmeCollection = {
  collection: {
    ...collection.collection,
    products: {
      ...collection.collection.products,
      pageInfo: {hasNextPage: false, endCursor: null},
      nodes: collection.collection.products.nodes.map((node) => ({
        ...node,
        vendor: 'Acme Sleep',
      })),
    },
  },
};

describe('loadBrandPage', () => {
  const respond =
    (brand: Node | null, any: boolean) => (call: {query: string}) =>
      call.query === BRAND_PAGE_QUERY
        ? {brand, anyBrand: {nodes: any ? [{id: 'x'}] : []}}
        : acmeCollection;

  it('lists the brand products from a collection filtered by this vendor', async () => {
    const {storefront, calls} = fakeStorefront(respond(ACME, true));
    const page = await loadBrandPage(
      storefront,
      'acme-sleep',
      emptyFilterState(),
    );
    expect(page.status).toBe('ok');
    if (page.status !== 'ok') return;
    expect(page.source).toBe('shopify');
    expect(page.products.length).toBeGreaterThan(0);
    const listing = calls.find((c) => c.query !== BRAND_PAGE_QUERY);
    expect(listing?.variables).toMatchObject({
      handle: 'acme-sleep',
      filters: [{productVendor: 'Acme Sleep'}],
    });
    expect(page.filterGroups.some((g) => g.dimension === 'brand')).toBe(false);
  });

  it('falls back to the main collection when no brand collection exists', async () => {
    const {storefront, calls} = fakeStorefront((call) =>
      call.query === BRAND_PAGE_QUERY
        ? {brand: ACME, anyBrand: {nodes: [{id: 'x'}]}}
        : call.variables.handle === 'mattresses'
          ? acmeCollection
          : {collection: null},
    );
    const page = await loadBrandPage(
      storefront,
      'acme-sleep',
      emptyFilterState(),
    );
    expect(page.status === 'ok' && page.products.length).toBeGreaterThan(0);
    expect(calls.map((c) => c.variables.handle).filter(Boolean)).toEqual([
      'acme-sleep',
      'acme-sleep',
      'mattresses',
      'mattresses',
    ]);
  });

  it('shows the brand with no products when neither collection exists', async () => {
    const {storefront} = fakeStorefront((call) =>
      call.query === BRAND_PAGE_QUERY
        ? {brand: ACME, anyBrand: {nodes: [{id: 'x'}]}}
        : {collection: null},
    );
    const page = await loadBrandPage(
      storefront,
      'acme-sleep',
      emptyFilterState(),
    );
    expect(page).toMatchObject({status: 'ok', products: []});
  });

  it('is a 404 for an unknown handle in a store that has brands, and for a bad handle', async () => {
    const some = fakeStorefront(respond(null, true));
    expect(
      await loadBrandPage(some.storefront, 'nope', emptyFilterState()),
    ).toEqual({status: 'not-found'});
    const bad = fakeStorefront(respond(null, true));
    expect(
      await loadBrandPage(bad.storefront, '../x', emptyFilterState()),
    ).toEqual({status: 'not-found'});
    expect(bad.calls).toHaveLength(0);
  });

  it('uses a fixture brand only when allowed and the store has no brands at all', async () => {
    const empty = fakeStorefront(respond(null, false));
    const fixture = FIXTURE_BRANDS[0];
    const page = await loadBrandPage(
      empty.storefront,
      fixture.handle,
      emptyFilterState(),
      {allowFixtures: true},
    );
    expect(page).toMatchObject({status: 'ok', source: 'fixtures'});
    if (page.status === 'ok') {
      expect(page.products.length).toBeGreaterThan(0);
      expect(page.products.every((p) => p.vendor === fixture.name)).toBe(true);
    }
    expect(
      await loadBrandPage(empty.storefront, 'unknown', emptyFilterState(), {
        allowFixtures: true,
      }),
    ).toEqual({status: 'not-found'});

    // Production (no permission): an empty live store is a 404, never a fictional brand.
    expect(
      await loadBrandPage(empty.storefront, fixture.handle, emptyFilterState()),
    ).toEqual({status: 'not-found'});

    // A configured store never falls back to the fictional brands.
    const configured = fakeStorefront(respond(null, true));
    expect(
      await loadBrandPage(
        configured.storefront,
        fixture.handle,
        emptyFilterState(),
        {allowFixtures: true},
      ),
    ).toEqual({status: 'not-found'});
  });
});

describe('a failed brand read', () => {
  it('is a fixed unavailable state, not a thrown error, and logs nothing from the request', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing = fakeStorefront(() => {
      throw new Error('token abc123 rejected for acme-sleep');
    });
    expect(
      await loadBrandPage(failing.storefront, 'acme-sleep', emptyFilterState()),
    ).toEqual({status: 'unavailable'});
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).not.toContain('abc123');
  });
});

describe('buildBrandJsonLd', () => {
  it('leaves url out instead of emitting a relative one when no site origin is configured', () => {
    const brand = mapBrandNode(ACME);
    if (!brand) throw new Error('fixture brand');
    const withoutOrigin = buildBrandJsonLd(brand, null);
    expect(withoutOrigin).not.toHaveProperty('url');
    expect(withoutOrigin).toMatchObject({name: 'Acme Sleep'});
    expect(buildBrandJsonLd(brand, '')).not.toHaveProperty('url');
  });

  it('describes only what the page shows', () => {
    const brand = mapBrandNode(ACME);
    if (!brand) throw new Error('fixture brand');
    expect(buildBrandJsonLd(brand, 'https://shop.example')).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Brand',
      name: 'Acme Sleep',
      url: 'https://shop.example/brands/acme-sleep',
      logo: 'https://cdn.shopify.com/logo.png',
      description: 'About Acme',
    });
    expect(brandPath('a b')).toBe('/brands/a%20b');
  });
});
