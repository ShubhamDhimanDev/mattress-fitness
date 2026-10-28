import {describe, expect, it} from 'vitest';
import type {QuizProductsQuery} from 'storefrontapi.generated';
import {getQuizProducts} from '~/lib/pages/data-source';
import {scoreProducts} from '~/lib/quiz/score';
import {DEFAULT_QUIZ_CONFIG} from '~/lib/quiz/default-config';
import {
  loadQuizProducts,
  mapQuizProduct,
  mapQuizProducts,
} from '~/lib/shopify/quiz-products';
import {fakeStorefront} from './fake-storefront';

// P3B-01 / REQ-QZ-002: the quiz recommends live Shopify products, not the fixtures.

type Node = NonNullable<
  QuizProductsQuery['collection']
>['products']['nodes'][number];

function variant(
  size: string,
  amount: string,
  edit: Partial<Node['variants']['nodes'][number]> = {},
): Node['variants']['nodes'][number] {
  return {
    id: `gid://shopify/ProductVariant/${size}`,
    sku: null,
    availableForSale: true,
    price: {amount, currencyCode: 'USD'},
    compareAtPrice: null,
    selectedOptions: [{name: 'Size', value: size}],
    dimensions: null,
    ...edit,
  };
}

function node(edit: Partial<Node> = {}): Node {
  return {
    id: 'gid://shopify/Product/1',
    handle: 'cloud-hybrid',
    title: 'Cloud Hybrid',
    vendor: 'Cloud Co',
    productType: 'Mattress',
    featuredImage: {
      id: 'gid://shopify/Image/1',
      url: 'https://cdn.shopify.com/a.jpg',
      altText: 'A mattress',
      width: 800,
      height: 600,
    },
    variants: {
      nodes: [variant('Queen', '1299.00'), variant('King', '1599.00')],
    },
    metafields: [
      {key: 'comfort_level', value: 'Medium'},
      {key: 'mattress_type', value: 'hybrid'},
      {key: 'sleep_positions', value: '["Side","Back"]'},
      {key: 'benefits', value: '["Cooling","Not a benefit"]'},
      null,
      null,
      null,
    ],
    ...edit,
  };
}

describe('mapQuizProduct', () => {
  it('maps attributes, sizes and prices into the catalog model', () => {
    const product = mapQuizProduct(node());
    expect(product).toMatchObject({
      handle: 'cloud-hybrid',
      brand: 'Cloud Co',
      comfortLevel: 'Medium',
      mattressType: 'Hybrid',
      sleepPositions: ['Back', 'Side'],
      benefits: ['Cooling'],
    });
    expect(product?.variants.map((v) => [v.size, v.priceCents])).toEqual([
      ['Queen', 129900],
      ['King', 159900],
    ]);
    expect(product?.images).toHaveLength(1);
  });

  it('skips products with no recognised size and variants with a bad price', () => {
    expect(
      mapQuizProduct(node({variants: {nodes: [variant('One Size', '20.00')]}})),
    ).toBeNull();
    const product = mapQuizProduct(
      node({
        variants: {nodes: [variant('Queen', 'abc'), variant('King', '10.00')]},
      }),
    );
    expect(product?.variants.map((v) => v.size)).toEqual(['King']);
  });

  it('keeps the first variant of a duplicated size and ignores compare-at at or below the price', () => {
    const product = mapQuizProduct(
      node({
        variants: {
          nodes: [
            variant('Queen', '100.00', {
              compareAtPrice: {amount: '100.00', currencyCode: 'USD'},
            }),
            variant('Queen', '50.00'),
          ],
        },
      }),
    );
    expect(product?.variants).toHaveLength(1);
    expect(product?.variants[0]?.priceCents).toBe(10000);
    expect(product?.variants[0]?.compareAtCents).toBeNull();
  });

  it('drops non-https images', () => {
    const product = mapQuizProduct(
      node({
        featuredImage: {
          id: null,
          url: 'http://insecure.test/a.jpg',
          altText: null,
          width: null,
          height: null,
        },
      }),
    );
    expect(product?.images).toEqual([]);
  });
});

describe('quiz scoring over mapped Shopify products', () => {
  it('recommends a live product with no code change', () => {
    const products = mapQuizProducts([
      node(),
      node({
        id: 'gid://shopify/Product/2',
        handle: 'plain-foam',
        metafields: [],
      }),
    ]);
    const outcome = scoreProducts(
      {'sleep-position': ['side'], size: ['queen']},
      products,
      DEFAULT_QUIZ_CONFIG,
    );
    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') {
      expect(outcome.matches[0]?.handle).toBe('cloud-hybrid');
      expect(outcome.matches[0]?.image?.url).toBe(
        'https://cdn.shopify.com/a.jpg',
      );
    }
  });
});

describe('getQuizProducts', () => {
  it('reads the mattresses collection through the priced cache', async () => {
    const {storefront, calls} = fakeStorefront(() => ({
      collection: {
        products: {nodes: [node()], pageInfo: {hasNextPage: false}},
      },
    }));
    const result = await getQuizProducts(storefront);
    expect(result.source).toBe('shopify');
    expect(result.products.map((p) => p.handle)).toEqual(['cloud-hybrid']);
    expect(calls[0]?.variables).toMatchObject({handle: 'mattresses'});
    expect(calls[0]?.cache).toMatchObject({maxAge: 60, custom: true});
  });

  it.each([
    ['a missing collection', {collection: null}],
    [
      'a collection with no sized product',
      {
        collection: {
          products: {
            nodes: [node({variants: {nodes: []}})],
            pageInfo: {hasNextPage: false},
          },
        },
      },
    ],
  ])('shows no mattresses, not fixtures, for %s', async (_name, response) => {
    const {storefront} = fakeStorefront(() => response);
    expect(await getQuizProducts(storefront)).toEqual({
      source: 'shopify',
      products: [],
    });
  });

  it('shows no mattresses when the read throws; fixtures only without a client', async () => {
    const {storefront} = fakeStorefront(() => {
      throw new Error('boom');
    });
    expect(await loadQuizProducts(storefront)).toEqual([]);
    expect(await getQuizProducts(storefront)).toEqual({
      source: 'shopify',
      products: [],
    });
    expect((await getQuizProducts()).source).toBe('fixtures');
  });
});
