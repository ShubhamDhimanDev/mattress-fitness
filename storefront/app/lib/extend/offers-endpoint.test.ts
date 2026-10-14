import {describe, expect, it, vi} from 'vitest';
import {parseExtendConfig} from '~/lib/extend/config';
import type {CoverageCatalogResult} from '~/lib/extend/coverage-catalog';
import type {VariantFact} from '~/lib/extend/coverage-facts';
import {
  MAX_ENDPOINT_ITEMS,
  answerOffers,
  parseOffersBody,
  parseOffersQuery,
  type OffersEndpointDeps,
} from '~/lib/extend/offers-endpoint';
import type {CoveragePlan} from '~/lib/extend/offers-service';
import {buildPricePointIndex} from '~/lib/extend/price-points';

// REQ-EXT-001 / REQ-EXT-005 / T-01 / T-13: the browser sends variant ids and quantities only; everything else is server data.

const V1 = 'gid://shopify/ProductVariant/601';
const url = (query: string) =>
  new URL(`https://shop.example.test/api/extend/offers?${query}`);
const post = (body: unknown) =>
  new Request('https://shop.example.test/api/extend/offers', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

describe('input validation (GET)', () => {
  it('accepts one variant GID with an optional quantity', () => {
    expect(
      parseOffersQuery(url(`variantId=${encodeURIComponent(V1)}`)),
    ).toEqual({
      status: 'ok',
      items: [{variantId: V1, quantity: 1}],
    });
    expect(
      parseOffersQuery(url(`variantId=${encodeURIComponent(V1)}&quantity=3`)),
    ).toEqual({
      status: 'ok',
      items: [{variantId: V1, quantity: 3}],
    });
  });

  it.each([
    ['no variant', ''],
    [
      'two variants',
      `variantId=${encodeURIComponent(V1)}&variantId=${encodeURIComponent(V1)}`,
    ],
    [
      'a product GID',
      `variantId=${encodeURIComponent('gid://shopify/Product/1')}`,
    ],
    ['a bare number', 'variantId=601'],
    ['an injected id', `variantId=${encodeURIComponent(`${V1}\nX: 1`)}`],
    ['quantity zero', `variantId=${encodeURIComponent(V1)}&quantity=0`],
    ['quantity 100', `variantId=${encodeURIComponent(V1)}&quantity=100`],
    ['quantity 1.5', `variantId=${encodeURIComponent(V1)}&quantity=1.5`],
    ['quantity text', `variantId=${encodeURIComponent(V1)}&quantity=abc`],
    [
      'quantity twice',
      `variantId=${encodeURIComponent(V1)}&quantity=1&quantity=2`,
    ],
  ])('rejects %s', (_name, query) => {
    expect(parseOffersQuery(url(query))).toEqual({status: 'invalid'});
  });
});

describe('input validation (POST)', () => {
  it('accepts a list, defaults the quantity, merges duplicates and ignores unknown fields (price is never read)', async () => {
    const parsed = await parseOffersBody(
      post({
        items: [
          {variantId: V1, price: 1, discount: 100, plan: 'x'},
          {variantId: V1, quantity: 5},
          {variantId: 'gid://shopify/ProductVariant/602', quantity: 2},
        ],
      }),
    );
    expect(parsed).toEqual({
      status: 'ok',
      items: [
        {variantId: V1, quantity: 1},
        {variantId: 'gid://shopify/ProductVariant/602', quantity: 2},
      ],
    });
  });

  it.each([
    ['not JSON', 'nope'],
    ['no items', {}],
    ['items not a list', {items: 'x'}],
    ['an empty list', {items: []}],
    ['a non-object item', {items: ['x']}],
    ['a bad variant', {items: [{variantId: 'x'}]}],
    ['a bad quantity', {items: [{variantId: V1, quantity: -1}]}],
    [
      'too many items',
      {
        items: Array.from({length: MAX_ENDPOINT_ITEMS + 1}, (_, i) => ({
          variantId: `gid://shopify/ProductVariant/${i + 1}`,
        })),
      },
    ],
    [
      'an oversized body',
      JSON.stringify({items: [{variantId: V1}], pad: 'x'.repeat(5000)}),
    ],
  ])('rejects %s', async (_name, body) => {
    expect(await parseOffersBody(post(body))).toEqual({status: 'invalid'});
  });
});

const plan: CoveragePlan = {
  planId: 'P-79',
  title: 'Plan',
  priceCents: 7999,
  termMonths: 36,
  termsUrl: 'https://extend.example/terms',
  imageUrl: null,
  recommended: true,
};

const catalog: CoverageCatalogResult = {
  status: 'ok',
  catalog: {
    coverageVariantIds: new Set(['gid://shopify/ProductVariant/9']),
    index: buildPricePointIndex([]),
    complete: true,
  },
};

function fact(over: Partial<VariantFact> = {}): VariantFact {
  return {
    variantId: V1,
    productId: 'gid://shopify/Product/501',
    category: 'mattress',
    unitPriceCents: 129_900,
    available: true,
    ...over,
  };
}

function endpoint(over: Partial<OffersEndpointDeps> = {}): OffersEndpointDeps {
  return {
    config: parseExtendConfig(
      {
        PUBLIC_EXTEND_ENABLED: 'true',
        EXTEND_API_HOST: 'https://api-demo.helloextend.com',
        EXTEND_STORE_ID: 'store-1',
        EXTEND_ACCESS_TOKEN: 'fixture-token-not-real',
      },
      {production: false},
    ),
    loadCatalog: () => Promise.resolve(catalog),
    loadFacts: () =>
      Promise.resolve({status: 'ok', facts: new Map([[V1, fact()]])}),
    quote: (items) =>
      Promise.resolve({
        status: 'ok',
        plansByKey: new Map(items.map((i) => [i.key, [plan]])),
      }),
    ...over,
  };
}

describe('answerOffers', () => {
  it('returns plans plus the Extend attribution, and nothing internal', async () => {
    const body = await answerOffers([{variantId: V1, quantity: 2}], endpoint());
    expect(body).toEqual({
      status: 'ok',
      poweredBy: 'Extend',
      items: [{variantId: V1, quantity: 2, plans: [plan]}],
    });
  });

  it('sends Shopify facts, not browser values, to the quote', async () => {
    const quote = vi.fn(endpoint().quote);
    await answerOffers([{variantId: V1, quantity: 2}], endpoint({quote}));
    expect(quote.mock.calls[0]?.[0]).toEqual([
      {
        key: V1,
        productId: 'gid://shopify/Product/501',
        category: 'mattress',
        unitPriceCents: 129_900,
        quantity: 2,
      },
    ]);
  });

  it('makes no Shopify or Extend call when Extend is off', async () => {
    const loadCatalog = vi.fn(endpoint().loadCatalog);
    const off = parseExtendConfig(
      {PUBLIC_EXTEND_ENABLED: 'false'},
      {production: false},
    );
    expect(
      await answerOffers(
        [{variantId: V1, quantity: 1}],
        endpoint({config: off, loadCatalog}),
      ),
    ).toEqual({status: 'unavailable'});
    expect(loadCatalog).not.toHaveBeenCalled();
  });

  it.each([
    [
      'catalog unavailable',
      {
        loadCatalog: () =>
          Promise.resolve({
            status: 'unavailable',
            reason: 'read-failed',
          } as const),
      },
    ],
    [
      'facts unavailable',
      {loadFacts: () => Promise.resolve({status: 'unavailable'} as const)},
    ],
    [
      'Extend down',
      {
        quote: () =>
          Promise.resolve({status: 'unavailable', reason: 'timeout'} as const),
      },
    ],
  ])('hides the offer when %s', async (_name, over) => {
    expect(
      await answerOffers([{variantId: V1, quantity: 1}], endpoint(over)),
    ).toEqual({status: 'unavailable'});
  });

  it('gives no plans to an unknown, sold-out or ineligible variant, and never to a coverage variant itself', async () => {
    const soldOut = await answerOffers(
      [{variantId: V1, quantity: 1}],
      endpoint({
        loadFacts: () =>
          Promise.resolve({
            status: 'ok',
            facts: new Map([[V1, fact({available: false})]]),
          }),
      }),
    );
    expect(soldOut).toMatchObject({status: 'ok', items: [{plans: []}]});

    const coverage = 'gid://shopify/ProductVariant/9';
    const alone = await answerOffers(
      [{variantId: coverage, quantity: 1}],
      endpoint({
        loadFacts: () =>
          Promise.resolve({
            status: 'ok',
            facts: new Map([[coverage, fact({variantId: coverage})]]),
          }),
      }),
    );
    expect(alone).toMatchObject({status: 'ok', items: [{plans: []}]});

    const unknown = await answerOffers(
      [{variantId: 'gid://shopify/ProductVariant/77', quantity: 1}],
      endpoint({
        quote: () => Promise.resolve({status: 'ok', plansByKey: new Map()}),
      }),
    );
    expect(unknown).toMatchObject({status: 'ok', items: [{plans: []}]});
  });
});
