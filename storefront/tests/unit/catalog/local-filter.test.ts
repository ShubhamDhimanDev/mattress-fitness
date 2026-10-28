import {describe, expect, it} from 'vitest';
import type {CatalogProductCardFragment} from 'storefrontapi.generated';
import collection from '../../fixtures/shopify/collection.json';
import {fakeStorefront} from './fake-storefront';
import {recorded} from './recorded';
import {
  emptyFilterState,
  parseFilterParams,
  type ShopifyFilterGroup,
} from '~/lib/filters';
import {loadCollectionPage} from '~/lib/shopify/collection-data';
import {
  listLocally,
  localCursor,
  parseLocalCursor,
  shopifyHonoursFilters,
} from '~/lib/shopify/local-filter';

// REQ-COL-002 / V-04: a store without Search & Discovery filters ignores size, comfort and type filters ("Shop by size > Twin"
// showed the whole collection with "Twin (0)"). The collection is then filtered here.

const base = recorded<CatalogProductCardFragment>(
  collection.collection.products.nodes[0],
);

function mattress(
  handle: string,
  sizes: readonly string[],
  extra: {vendor?: string; comfort?: string; type?: string} = {},
): CatalogProductCardFragment {
  const node = structuredClone(base);
  node.id = `gid://shopify/Product/${handle}`;
  node.handle = handle;
  node.title = handle;
  node.vendor = extra.vendor ?? 'Serta';
  node.productType = 'Mattress';
  node.variants.nodes = sizes.map((size) => ({
    id: `${handle}:${size}`,
    availableForSale: true,
    price: {amount: '999.0', currencyCode: 'USD'},
    compareAtPrice: null,
    selectedOptions: [{name: 'Size', value: size}],
  }));
  node.metafields = [
    extra.comfort ? {key: 'comfort_level', value: extra.comfort} : null,
    extra.type ? {key: 'mattress_type', value: extra.type} : null,
    null,
    null,
    null,
    null,
  ];
  return node;
}

const WORLD = [
  mattress('a', ['Twin', 'Queen'], {comfort: 'Plush', type: 'Hybrid'}),
  mattress('b', ['Queen', 'King'], {comfort: 'Firm', type: 'Hybrid'}),
  mattress('c', ['Twin XL'], {vendor: 'Sealy', comfort: 'Plush', type: 'Foam'}),
  mattress('d', ['Twin'], {vendor: 'Sealy', comfort: 'Medium'}),
];

const state = (query: string) => parseFilterParams(new URLSearchParams(query));
const handles = (products: readonly CatalogProductCardFragment[]) =>
  products.map((p) => p.handle);

describe('listLocally (REQ-COL-002)', () => {
  it('keeps the products that have the selected size, and Twin does not match Twin XL', () => {
    const result = listLocally(WORLD, state('size=twin'), 0, 12);
    expect(handles(result.products)).toEqual(['a', 'd']);
  });

  it('ORs values of one dimension and ANDs different dimensions', () => {
    expect(
      handles(listLocally(WORLD, state('size=twin&size=king'), 0, 12).products),
    ).toEqual(['a', 'b', 'd']);
    expect(
      handles(
        listLocally(WORLD, state('size=twin&comfort=plush'), 0, 12).products,
      ),
    ).toEqual(['a']);
    expect(
      handles(listLocally(WORLD, state('brand=Sealy'), 0, 12).products),
    ).toEqual(['c', 'd']);
  });

  it('counts each value as a click would give it, with the dimension itself left open', () => {
    const groups = listLocally(WORLD, state('size=twin'), 0, 12).filterGroups;
    const size = groups.find((g) => g.dimension === 'size');
    expect(size?.options.map((o) => [o.value, o.count, o.selected])).toEqual([
      ['Twin', 2, true],
      ['Twin XL', 1, false],
      ['Queen', 2, false],
      ['King', 1, false],
    ]);
    // Comfort counts respect the size selection: only Twin products count.
    const comfort = groups.find((g) => g.dimension === 'comfortLevel');
    expect(comfort?.options.map((o) => [o.value, o.count])).toEqual([
      ['Plush', 1],
      ['Medium', 1],
    ]);
  });

  it('cuts pages with a cursor of its own', () => {
    const first = listLocally(WORLD, emptyFilterState(), 0, 3);
    expect(handles(first.products)).toEqual(['a', 'b', 'c']);
    expect(first.pageInfo).toEqual({
      hasNextPage: true,
      endCursor: localCursor(3),
      totalCount: 4,
    });
    const second = listLocally(WORLD, emptyFilterState(), 3, 3);
    expect(handles(second.products)).toEqual(['d']);
    expect(second.pageInfo).toEqual({
      hasNextPage: false,
      endCursor: null,
      totalCount: 4,
    });
  });

  it('returns nothing, not everything, when no product matches', () => {
    expect(
      listLocally(WORLD, state('comfort=extra-firm'), 0, 12).products,
    ).toEqual([]);
  });
});

describe('local cursor', () => {
  it.each([
    ['local:12', 12],
    ['local:0', 0],
    ['eyJjIjoicG9zaXRpb24i', null],
    ['local:-1', null],
    ['local:abc', null],
    [null, null],
  ])('reads %s as %s', (cursor, offset) => {
    expect(parseLocalCursor(cursor)).toBe(offset);
  });
});

describe('shopifyHonoursFilters', () => {
  const priceOnly: ShopifyFilterGroup[] = [{values: []}];
  const sizeGroup: ShopifyFilterGroup[] = [
    {
      values: [
        {
          count: 3,
          input: '{"variantOption":{"name":"Size","value":"Twin"}}',
        },
      ],
    },
  ];

  it('does not when the store offers no filter of ours, even with nothing selected', () => {
    expect(shopifyHonoursFilters(priceOnly, emptyFilterState())).toBe(false);
  });

  it('does when the selected dimension is offered', () => {
    expect(shopifyHonoursFilters(sizeGroup, state('size=twin'))).toBe(true);
  });

  it('does not when the shopper selected a dimension the store does not offer', () => {
    expect(shopifyHonoursFilters(sizeGroup, state('comfort=plush'))).toBe(
      false,
    );
  });
});

describe('loadCollectionPage on a store without filters', () => {
  it('serves "Load more" from our own cursor without sending it to Shopify', async () => {
    const wide = {
      collection: {
        ...collection.collection,
        products: {
          ...collection.collection.products,
          nodes: WORLD,
          pageInfo: {hasNextPage: false, endCursor: null},
        },
      },
    };
    const {storefront, calls} = fakeStorefront(() => wide);
    const page = await loadCollectionPage(
      storefront,
      'mattresses',
      state('size=twin&cursor=local:1'),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.variables).toMatchObject({after: null, first: 250});
    expect(page.status === 'ok' && page.products.map((p) => p.handle)).toEqual([
      'd',
    ]);
  });
});
