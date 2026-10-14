import {describe, expect, it} from 'vitest';
import {
  COVERAGE_PRODUCT_TAG,
  loadCoverageCatalog,
  parseCoverageCatalog,
} from '~/lib/extend/coverage-catalog';
import {
  loadProductCategories,
  loadVariantFacts,
  parseProductCategories,
  parseVariantFacts,
} from '~/lib/extend/coverage-facts';
import {fakeStorefront} from '../catalog/fake-storefront';

// REQ-EXT-002 / REQ-EXT-005 / P5A-06: the server's own list of coverage variants, and Shopify-sourced facts for offers.

const variant = (id: string, name: string, amount: string, over = {}) => ({
  id: `gid://shopify/ProductVariant/${id}`,
  title: name,
  sku: null,
  availableForSale: true,
  price: {amount, currencyCode: 'USD'},
  ...over,
});
const page = (variants: unknown[], over = {}) => ({
  products: {
    pageInfo: {hasNextPage: false},
    nodes: [
      {
        id: 'gid://shopify/Product/900',
        title: 'Extend Protection Plan',
        variants: {pageInfo: {hasNextPage: false}, nodes: variants},
      },
    ],
    ...over,
  },
});

function ok(raw: unknown) {
  const result = parseCoverageCatalog(raw);
  if (result.status !== 'ok') throw new Error('expected ok');
  return result.catalog;
}

describe('REQ-EXT-002 coverage catalog', () => {
  it('indexes sellable price points by price and lists every coverage variant', () => {
    const catalog = ok(
      page([
        variant('1', 'Extend-Protection-Plan-14.99', '14.99'),
        variant('2', 'Extend-Protection-Plan-79.99', '79.99'),
        variant('3', 'Unrelated option', '5.00'),
      ]),
    );
    expect([...catalog.coverageVariantIds].sort()).toEqual([
      'gid://shopify/ProductVariant/1',
      'gid://shopify/ProductVariant/2',
    ]);
    expect(
      [...catalog.index.byPriceCents.keys()].sort((a, b) => a - b),
    ).toEqual([1499, 7999]);
    expect(catalog.complete).toBe(true);
  });

  it('reads the name from the SKU when the variant title is generic', () => {
    const catalog = ok(
      page([
        variant('1', 'Default Title', '14.99', {
          sku: 'Extend-Protection-Plan-14.99',
        }),
      ]),
    );
    expect(catalog.index.byPriceCents.has(1499)).toBe(true);
  });

  it('keeps a price-mismatched variant as COVERAGE (so the gate polices it) but never offers it', () => {
    const catalog = ok(
      page([variant('1', 'Extend-Protection-Plan-14.99', '15.99')]),
    );
    expect(catalog.coverageVariantIds.size).toBe(1);
    expect(catalog.index.byPriceCents.size).toBe(0);
    expect(catalog.index.rejected[0]?.reason).toBe('price_mismatch');
  });

  it('keeps a sold-out or non-USD variant as coverage but not sellable', () => {
    const catalog = ok(
      page([
        variant('1', 'Extend-Protection-Plan-14.99', '14.99', {
          availableForSale: false,
        }),
        variant('2', 'Extend-Protection-Plan-24.99', '24.99', {
          price: {amount: '24.99', currencyCode: 'CAD'},
        }),
      ]),
    );
    expect(catalog.coverageVariantIds.size).toBe(2);
    expect(catalog.index.byPriceCents.size).toBe(0);
  });

  it('marks the catalog incomplete when there are more products or variants than one page', () => {
    expect(ok(page([], {pageInfo: {hasNextPage: true}})).complete).toBe(false);
    const more = page([variant('1', 'Extend-Protection-Plan-14.99', '14.99')]);
    const first = more.products.nodes[0];
    if (first) first.variants.pageInfo.hasNextPage = true;
    expect(ok(more).complete).toBe(false);
  });

  it.each([
    ['not an object', null],
    ['no products', {}],
    ['nodes not a list', {products: {nodes: 'x'}}],
    ['variant without id', page([{title: 'Extend-Protection-Plan-1.00'}])],
    [
      'variants missing',
      {products: {nodes: [{id: 'p'}], pageInfo: {hasNextPage: false}}},
    ],
  ])('treats %s as unavailable', (_name, raw) => {
    expect(parseCoverageCatalog(raw)).toEqual({
      status: 'unavailable',
      reason: 'malformed',
    });
  });

  it('asks Shopify for the tagged products with its own 5 minute fresh / 1 hour stale window (review item E), and survives a failed read', async () => {
    const good = fakeStorefront(() =>
      page([variant('1', 'Extend-Protection-Plan-14.99', '14.99')]),
    );
    const result = await loadCoverageCatalog(good.storefront);
    expect(result.status).toBe('ok');
    expect(good.calls[0]?.variables).toEqual({
      query: `tag:${COVERAGE_PRODUCT_TAG}`,
    });
    expect(good.calls[0]?.cache).toMatchObject({
      maxAge: 300,
      staleWhileRevalidate: 3600,
    });

    const failing = fakeStorefront(() => {
      throw new Error('upstream down');
    });
    expect(await loadCoverageCatalog(failing.storefront)).toEqual({
      status: 'unavailable',
      reason: 'read-failed',
    });
  });
});

describe('REQ-EXT-005 Shopify facts for offers', () => {
  it('parses variant price, product and category; a bad category label is not eligible', () => {
    const facts = parseVariantFacts({
      nodes: [
        {
          id: 'v1',
          availableForSale: true,
          price: {amount: '1299.00', currencyCode: 'USD'},
          product: {id: 'p1', metafield: {value: 'mattress'}},
        },
        {
          id: 'v2',
          availableForSale: false,
          price: {amount: '10.00', currencyCode: 'USD'},
          product: {id: 'p2', metafield: {value: '<script>alert(1)</script>'}},
        },
        null,
        {
          id: 'v3',
          price: {amount: 'abc', currencyCode: 'USD'},
          product: {id: 'p3'},
        },
        {
          id: 'v4',
          price: {amount: '1.00', currencyCode: 'EUR'},
          product: {id: 'p4'},
        },
      ],
    });
    expect([...facts.keys()]).toEqual(['v1', 'v2']);
    expect(facts.get('v1')).toEqual({
      variantId: 'v1',
      productId: 'p1',
      category: 'mattress',
      unitPriceCents: 129_900,
      available: true,
    });
    expect(facts.get('v2')?.category).toBeNull();
  });

  it('parses product categories and ignores blanks and hostile text', () => {
    const categories = parseProductCategories({
      nodes: [
        {id: 'p1', metafield: {value: 'mattress'}},
        {id: 'p2', metafield: {value: ''}},
        {id: 'p3', metafield: null},
        {id: 'p4', metafield: {value: 'x'.repeat(200)}},
        'junk',
      ],
    });
    expect([...categories]).toEqual([['p1', 'mattress']]);
  });

  it('reads through the storefront, caps the id list, and reports a failed read as unavailable', async () => {
    const calls = fakeStorefront(() => ({nodes: []}));
    const ids = Array.from(
      {length: 150},
      (_, i) => `gid://shopify/Product/${i}`,
    );
    expect((await loadProductCategories(calls.storefront, ids)).status).toBe(
      'ok',
    );
    expect((calls.calls[0]?.variables.ids as string[]).length).toBe(100);
    expect(await loadVariantFacts(calls.storefront, [])).toEqual({
      status: 'ok',
      facts: new Map(),
    });
    expect(calls.calls).toHaveLength(1);

    const failing = fakeStorefront(() => {
      throw new Error('down');
    });
    expect(await loadVariantFacts(failing.storefront, ['v1'])).toEqual({
      status: 'unavailable',
    });
    expect(await loadProductCategories(failing.storefront, ['p1'])).toEqual({
      status: 'unavailable',
    });
  });
});
