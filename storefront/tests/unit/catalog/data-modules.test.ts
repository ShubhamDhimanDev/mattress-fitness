import {describe, expect, it} from 'vitest';
import collection from '../../fixtures/shopify/collection.json';
import product from '../../fixtures/shopify/product.json';
import availability from '../../fixtures/shopify/product-availability.json';
import search from '../../fixtures/shopify/search.json';
import searchContent from '../../fixtures/shopify/search-content.json';
import searchEmpty from '../../fixtures/shopify/search-empty.json';
import home from '../../fixtures/shopify/home.json';
import {fakeStorefront} from './fake-storefront';
import {recorded} from './recorded';
import type {CatalogHomeQuery} from 'storefrontapi.generated';
import {emptyFilterState, parseFilterParams} from '~/lib/filters';
import {
  isValidHandle,
  loadAllProductsPage,
  loadCollectionPage,
} from '~/lib/shopify/collection-data';
import {loadProductPage} from '~/lib/shopify/product-data';
import {
  PRODUCT_AVAILABILITY_QUERY,
  PRODUCT_QUERY,
  SEARCH_CONTENT_QUERY,
  SEARCH_PRODUCTS_QUERY,
} from '~/lib/shopify/queries';
import {
  articleLinks,
  loadSearchPage,
  normalizeSearchTerm,
  pageLinks,
  searchStateFor,
} from '~/lib/shopify/search-data';
import {buildHomeData, loadHome, sizeTileHref} from '~/lib/shopify/home-data';

// Integration of the query modules against responses recorded on bedding.mock.shop (P3B-01).

// DEC-024: anything that carries a price or availability is fresh for 60 s and stale-while-revalidate 300 s.
const PRICED = {
  mode: 'public',
  maxAge: 60,
  staleWhileRevalidate: 300,
  custom: true,
};

describe('isValidHandle (T-07)', () => {
  it.each(['mattresses', 'a', 'queen-size_1', 'A1'])('accepts %s', (handle) => {
    expect(isValidHandle(handle)).toBe(true);
  });
  it.each([
    '',
    '-x',
    '../etc',
    'a b',
    'a/b',
    '<script>',
    'x'.repeat(300),
    5,
    null,
  ])('rejects %j', (handle) => {
    expect(isValidHandle(handle)).toBe(false);
  });
});

const wholeCollection = {
  collection: {
    ...collection.collection,
    products: {
      ...collection.collection.products,
      pageInfo: {hasNextPage: false, endCursor: null},
    },
  },
};

describe('loadCollectionPage', () => {
  it('queries with the filters from the URL as variables and uses the 60 s priced cache', async () => {
    // The whole-collection read is one page (the recorded response claims a next page, which only a 12 product page has).
    const {storefront, calls} = fakeStorefront((call) =>
      call.variables.first === 250 ? wholeCollection : collection,
    );
    const state = parseFilterParams(
      new URLSearchParams(
        'size=queen&brand=CloudHaven+Linens&price_min=50&sort=price-desc',
      ),
    );
    const result = await loadCollectionPage(
      storefront,
      'sun-drenched-morning-bedding',
      state,
    );

    expect(result.status).toBe('ok');
    // The recorded mock store offers no filter groups, so Shopify ignored the size and brand filters: the page is then
    // filtered by our own code from a second read of the whole collection (price and sort still go to Shopify).
    expect(calls).toHaveLength(2);
    expect(calls[0].cache).toEqual(PRICED);
    expect(calls[0].variables).toMatchObject({
      handle: 'sun-drenched-morning-bedding',
      first: 12,
      after: null,
      sortKey: 'PRICE',
      reverse: true,
      filters: [
        {variantOption: {name: 'Size', value: 'Queen'}},
        {productVendor: 'CloudHaven Linens'},
        {price: {min: 50}},
      ],
    });
    expect(calls[1].cache).toEqual(PRICED);
    expect(calls[1].variables).toMatchObject({
      first: 250,
      after: null,
      sortKey: 'PRICE',
      reverse: true,
      filters: [{price: {min: 50}}],
    });
    if (result.status === 'ok') {
      expect(result.products).toHaveLength(4);
      expect(result.pageInfo.hasNextPage).toBe(false);
      // Counts come from the whole collection, so the selected values are real numbers, not 0.
      expect(result.filterGroups.map((g) => g.dimension)).toEqual([
        'size',
        'brand',
        'productType',
      ]);
      expect(
        result.filterGroups[0]?.options.find((o) => o.value === 'Queen'),
      ).toMatchObject({count: 4, selected: true});
      expect(result.collection.faqs).toEqual([]);
    }
  });

  it('passes the cursor for Load more and drops hostile URL values before they reach Shopify', async () => {
    const {storefront, calls} = fakeStorefront(() => collection);
    const state = parseFilterParams(
      new URLSearchParams(
        'cursor=abc123&size=bogus&sort=hack&comfort=<script>',
      ),
    );
    await loadCollectionPage(storefront, 'x', state);
    expect(calls[0].variables).toMatchObject({
      after: 'abc123',
      filters: [],
      sortKey: 'COLLECTION_DEFAULT',
    });
  });

  it('reports not-found for a missing collection or a bad handle without calling Shopify', async () => {
    const missing = fakeStorefront(() => ({collection: null}));
    expect(
      await loadCollectionPage(missing.storefront, 'nope', emptyFilterState()),
    ).toEqual({status: 'not-found'});
    const bad = fakeStorefront(() => collection);
    expect(
      await loadCollectionPage(bad.storefront, '../x', emptyFilterState()),
    ).toEqual({status: 'not-found'});
    expect(bad.calls).toHaveLength(0);
  });
});

describe('loadAllProductsPage', () => {
  it('sorts with the root products keys', async () => {
    const {storefront, calls} = fakeStorefront(() => ({
      products: collection.collection.products,
    }));
    const page = await loadAllProductsPage(
      storefront,
      parseFilterParams(new URLSearchParams('sort=newest')),
    );
    expect(page.products).toHaveLength(4);
    expect(calls[0].variables).toMatchObject({
      sortKey: 'CREATED_AT',
      reverse: true,
    });
  });
});

describe('loadProductPage (REQ-PDP-001)', () => {
  const respond = (call: {query: string}) =>
    call.query === PRODUCT_QUERY ? product : availability;

  it('runs the content query long-cached and the availability query on the 60 s priced cache', async () => {
    const {storefront, calls} = fakeStorefront(respond);
    const result = await loadProductPage(
      storefront,
      'linen-pillowcase-pair-in-warm-clay',
    );
    expect(result.status).toBe('ok');
    const byQuery = new Map(calls.map((c) => [c.query, c.cache]));
    expect(byQuery.get(PRODUCT_QUERY)).toEqual({mode: 'long'});
    expect(byQuery.get(PRODUCT_AVAILABILITY_QUERY)).toEqual(PRICED);
  });

  it('still renders when the availability read fails', async () => {
    const {storefront} = fakeStorefront((call) => {
      if (call.query === PRODUCT_AVAILABILITY_QUERY) throw new Error('timeout');
      return product;
    });
    const result = await loadProductPage(
      storefront,
      'linen-pillowcase-pair-in-warm-clay',
    );
    expect(result.status).toBe('ok');
  });

  it('is not-found for a missing product, a product without variants or a bad handle', async () => {
    const none = fakeStorefront(() => ({product: null}));
    expect(await loadProductPage(none.storefront, 'x')).toEqual({
      status: 'not-found',
    });
    const noVariants = fakeStorefront((call) =>
      call.query === PRODUCT_QUERY
        ? {product: {...product.product, variants: {nodes: []}}}
        : availability,
    );
    expect(await loadProductPage(noVariants.storefront, 'x')).toEqual({
      status: 'not-found',
    });
    expect(await loadProductPage(none.storefront, '../..')).toEqual({
      status: 'not-found',
    });
  });
});

describe('search (REQ-SRCH-002)', () => {
  const respond = (call: {query: string}) => {
    if (call.query === SEARCH_PRODUCTS_QUERY) return search;
    if (call.query === SEARCH_CONTENT_QUERY) return searchContent;
    return searchEmpty;
  };

  it('normalises the term to bounded plain text', () => {
    expect(normalizeSearchTerm('  queen   <b>firm</b> ')).toBe('queen firm');
    expect(normalizeSearchTerm('x'.repeat(500))).toHaveLength(100);
    expect(normalizeSearchTerm(null)).toBe('');
  });

  it('does not call Shopify for an empty term', async () => {
    const {storefront, calls} = fakeStorefront(respond);
    const page = await loadSearchPage(storefront, '  ', emptyFilterState());
    expect(page.products).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('searches with the shared filters, relevance sort and the 60 s priced cache', async () => {
    const {storefront, calls} = fakeStorefront(respond);
    const state = parseFilterParams(
      new URLSearchParams('size=king&sort=title-asc'),
    );
    const page = await loadSearchPage(storefront, 'linen', state);
    const productCall = calls.find((c) => c.query === SEARCH_PRODUCTS_QUERY);
    expect(productCall?.cache).toEqual(PRICED);
    expect(productCall?.variables).toMatchObject({
      term: 'linen',
      sortKey: 'RELEVANCE', // search cannot sort by title
      productFilters: [{variantOption: {name: 'Size', value: 'King'}}],
    });
    expect(page.totalCount).toBe(search.products.totalCount);
    expect(page.products.length).toBeGreaterThan(0);
    expect(page.suggestedCollections.length).toBeGreaterThan(0);
  });

  it('sends the lower-cased term to Shopify so the cache key does not hold raw input', async () => {
    const {storefront, calls} = fakeStorefront(respond);
    const page = await loadSearchPage(
      storefront,
      '  Linen SHEETS ',
      emptyFilterState(),
    );
    expect(page.term).toBe('Linen SHEETS'); // displayed as typed
    expect(calls.map((c) => c.variables.term)).toEqual([
      'linen sheets',
      'linen sheets',
    ]);
  });

  it('skips the pages and articles query on later pages', async () => {
    const {storefront, calls} = fakeStorefront(respond);
    await loadSearchPage(
      storefront,
      'linen',
      parseFilterParams(new URLSearchParams('cursor=abc')),
    );
    expect(calls.some((c) => c.query === SEARCH_CONTENT_QUERY)).toBe(false);
  });

  it('returns no products for a term that matches nothing', async () => {
    const {storefront} = fakeStorefront((call) =>
      call.query === SEARCH_PRODUCTS_QUERY ? searchEmpty : searchContent,
    );
    const page = await loadSearchPage(
      storefront,
      'zzzzqqqq',
      emptyFilterState(),
    );
    expect(page.totalCount).toBe(0);
    expect(page.products).toEqual([]);
    expect(page.suggestedCollections.length).toBeGreaterThan(0);
  });

  it('falls back to relevance for sorts search does not support', () => {
    expect(
      searchStateFor(parseFilterParams(new URLSearchParams('sort=newest')))
        .sort,
    ).toBe('featured');
    expect(
      searchStateFor(parseFilterParams(new URLSearchParams('sort=price-asc')))
        .sort,
    ).toBe('price-asc');
  });

  it('keeps only complete page and article nodes and encodes handles', () => {
    expect(
      pageLinks([
        {},
        {id: '1', handle: 'a b', title: 'T'},
        {id: '2', title: 'No handle'},
      ]),
    ).toEqual([{id: '1', title: 'T', to: '/pages/a%20b'}]);
    expect(
      articleLinks([
        {id: '1', handle: 'post', title: 'P', blog: {handle: 'news'}},
        {id: '2', handle: 'orphan', title: 'O'},
      ]),
    ).toEqual([{id: '1', title: 'P', to: '/blogs/news/post'}]);
  });
});

describe('home (REQ-HOME-001)', () => {
  it('builds sections from a store without the mattress collection or brand entries', () => {
    const data = buildHomeData(recorded<CatalogHomeQuery>(home));
    expect(data.featured?.title).toBe('Best sellers');
    expect(data.featured?.products.length).toBeGreaterThan(0);
    // Sizes come from the products' Size options, in the standard order, linking into the first collection.
    expect(data.sizeTiles.map((t) => t.label)).toEqual([
      'Twin',
      'Full',
      'Queen',
      'King',
    ]);
    expect(data.sizeTiles[0].to).toBe(
      `/collections/${home.collections.nodes[0].handle}?size=twin`,
    );
    expect(data.brandTiles.map((b) => b.name)).toEqual(['CloudHaven Linens']);
    expect(data.collectionTiles).toHaveLength(4);
  });

  it('tolerates an empty catalog', () => {
    const data = buildHomeData({
      collections: {nodes: []},
      primary: null,
      fallbackProducts: {nodes: []},
      brands: {nodes: []},
    });
    expect(data.featured).toBeNull();
    expect(data.brandTiles).toEqual([]);
    expect(data.collectionTiles).toEqual([]);
    // With no size data the six regular sizes are offered, linking to the collections index.
    expect(data.sizeTiles).toHaveLength(6);
    expect(data.sizeTiles[0].to).toBe('/collections?size=twin');
  });

  it("REQ-HOME-001: leaves Shopify's built-in frontpage collection out of the category tiles", () => {
    const data = buildHomeData({
      collections: {
        nodes: [
          {
            id: 'gid://shopify/Collection/1',
            handle: 'frontpage',
            title: 'Home page',
            image: null,
          },
          {
            id: 'gid://shopify/Collection/2',
            handle: 'mattresses',
            title: 'Mattresses',
            image: null,
          },
        ],
      },
      primary: null,
      fallbackProducts: {nodes: []},
      brands: {nodes: []},
    });
    expect(data.collectionTiles.map((tile) => tile.to)).toEqual([
      '/collections/mattresses',
    ]);
  });

  it('prefers brand entries from Shopify and the primary collection', () => {
    const typedHome = recorded<CatalogHomeQuery>(home);
    const data = buildHomeData({
      ...typedHome,
      primary: {
        id: 'gid://shopify/Collection/1',
        handle: 'mattresses',
        title: 'Mattresses',
        products: typedHome.fallbackProducts,
      },
      brands: {
        nodes: [
          {
            id: 'gid://shopify/Metaobject/1',
            fields: [
              {key: 'name', value: 'Acme Sleep', reference: null},
              {key: 'slug', value: 'acme', reference: null},
            ],
          },
          {
            id: 'gid://shopify/Metaobject/2',
            fields: [{key: 'slug', value: 'nameless', reference: null}],
          },
        ],
      },
    });
    expect(data.featured?.title).toBe('Mattresses');
    expect(data.featured?.handle).toBe('mattresses');
    expect(data.brandTiles).toEqual([
      {
        name: 'Acme Sleep',
        to: '/brands/acme', // a brand with a slug has its own page (REQ-COL-005)
        logo: null,
      },
    ]);
    expect(data.sizeTiles[0].to).toBe('/collections/mattresses?size=twin');
  });

  it('loads through the storefront with the 60 s priced cache (cards carry price)', async () => {
    const {storefront, calls} = fakeStorefront(() => home);
    await loadHome(storefront);
    expect(calls[0].cache).toEqual(PRICED);
    expect(calls[0].variables).toMatchObject({primaryHandle: 'mattresses'});
  });

  it('builds a size link the collection filter codec understands', () => {
    expect(sizeTileHref('mattresses', 'California King')).toBe(
      '/collections/mattresses?size=california-king',
    );
  });
});
