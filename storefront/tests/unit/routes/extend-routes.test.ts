import {afterEach, describe, expect, it, vi} from 'vitest';
import {fakeStorefront} from '../catalog/fake-storefront';
import {
  action as offersAction,
  loader as offersLoader,
} from '~/routes/api.extend.offers';
import {
  action as webhookAction,
  loader as webhookLoader,
} from '~/routes/webhooks.shopify';
import {WEBHOOK_SECRET, webhookRequest} from '~/lib/extend/test-fixtures';

// P5A-04 (offers route) and P5A-08 (webhook route): REQ-EXT-001, REQ-EXT-003, REQ-EXT-005, NFR-013, T-01, T-03, T-13.
// The real route functions run against fakes for Shopify and Extend. Route argument types are framework-generated, so
// the helper builds them from plain parts (a documented test-only narrowing, as in cart-routes.test.ts).

const ORIGIN = 'https://shop.example.test';
const EXTEND_ENV = {
  PUBLIC_EXTEND_ENABLED: 'true',
  EXTEND_API_HOST: 'https://api-demo.helloextend.com',
  EXTEND_STORE_ID: 'store-1',
  EXTEND_ACCESS_TOKEN: 'fixture-token-not-real',
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function args(request: Request, context: object) {
  return {request, context, params: {}} as never;
}

const PRICE_POINTS = {
  products: {
    pageInfo: {hasNextPage: false},
    nodes: [
      {
        id: 'gid://shopify/Product/900',
        title: 'Extend Protection Plan',
        variants: {
          pageInfo: {hasNextPage: false},
          nodes: [
            {
              id: 'gid://shopify/ProductVariant/9001',
              title: 'Extend-Protection-Plan-79.99',
              sku: null,
              availableForSale: true,
              price: {amount: '79.99', currencyCode: 'USD'},
            },
          ],
        },
      },
    ],
  },
};

function shopify(productId: string, variantId: string) {
  return fakeStorefront((call) => {
    if (call.query.includes('query ExtendCoverageVariants'))
      return PRICE_POINTS;
    if (call.query.includes('query ExtendVariantFacts')) {
      return {
        nodes: [
          {
            id: variantId,
            availableForSale: true,
            price: {amount: '1299.00', currencyCode: 'USD'},
            product: {id: productId, metafield: {value: 'mattress'}},
          },
        ],
      };
    }
    return {};
  });
}

function stubExtend(productNumericId: string) {
  const fetchMock = vi.fn((_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as {
      items: Array<{productId: string}>;
    };
    return Promise.resolve(
      new Response(
        JSON.stringify({
          offerCartId: 'c1',
          storeId: 'store-1',
          offers: body.items.map((item) => ({
            offerId: `o-${item.productId}`,
            plans: {
              adh: [
                {
                  id: 'PLAN-79',
                  price: 7999,
                  title: '3 Year Plan',
                  contract: {termLength: 36},
                  url: 'https://extend.example/terms',
                },
                {
                  id: 'PLAN-OFF-LIST',
                  price: 12_345,
                  title: 'No price point',
                  contract: {termLength: 12},
                  url: 'https://extend.example/terms2',
                },
              ],
              base: [],
              recommended: 'adh',
            },
            coveredProducts: [
              {
                productId: productNumericId,
                quantity: 1,
                purchasePrice: 129_900,
              },
            ],
          })),
        }),
      ),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const variantGid = (n: number) => `gid://shopify/ProductVariant/${n}`;
const query = (id: string, extra = '') =>
  `${ORIGIN}/api/extend/offers?variantId=${encodeURIComponent(id)}${extra}`;

describe('P5A-04 offers route', () => {
  it('GET returns the sellable plans, private and uncached, with the token never in the answer', async () => {
    const {storefront, calls} = shopify(
      'gid://shopify/Product/5001',
      variantGid(6001),
    );
    const fetchMock = stubExtend('5001');
    const response = await offersLoader(
      args(new Request(query(variantGid(6001), '&quantity=1')), {
        storefront,
        env: EXTEND_ENV,
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    const text = await response.text();
    expect(text).not.toContain('fixture-token-not-real');
    expect(JSON.parse(text)).toEqual({
      status: 'ok',
      poweredBy: 'Extend',
      items: [
        {
          variantId: variantGid(6001),
          quantity: 1,
          plans: [
            {
              planId: 'PLAN-79',
              title: '3 Year Plan',
              priceCents: 7999,
              termMonths: 36,
              termsUrl: 'https://extend.example/terms',
              imageUrl: null,
              recommended: true,
            },
          ],
        },
      ],
    });
    // The Extend call carried the token server to server and Shopify's price, not a browser value.
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe('https://api-demo.helloextend.com/offers');
    expect(
      (init?.headers as Record<string, string>)['X-Extend-Access-Token'],
    ).toBe('fixture-token-not-real');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      items: [{purchasePrice: 129_900}],
    });
    expect(calls.map((c) => c.query.match(/query (\w+)/)?.[1])).toEqual([
      'ExtendCoverageVariants',
      'ExtendVariantFacts',
    ]);
  });

  it('POST works for several variants from the same site and refuses another origin', async () => {
    const {storefront} = shopify(
      'gid://shopify/Product/5002',
      variantGid(6002),
    );
    stubExtend('5002');
    const post = (headers: HeadersInit) =>
      new Request(`${ORIGIN}/api/extend/offers`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          items: [{variantId: variantGid(6002), quantity: 1}],
        }),
      });
    const good = await offersAction(
      args(post({Origin: ORIGIN}), {storefront, env: EXTEND_ENV}),
    );
    expect(good.status).toBe(200);
    expect(((await good.json()) as {status: string}).status).toBe('ok');

    const evil = await offersAction(
      args(post({Origin: 'https://evil.example'}), {
        storefront,
        env: EXTEND_ENV,
      }),
    );
    expect(evil.status).toBe(403);
    expect(evil.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('rejects bad input with 400 and a fixed body, and other methods with 405', async () => {
    const {storefront} = shopify(
      'gid://shopify/Product/5003',
      variantGid(6003),
    );
    const bad = await offersLoader(
      args(new Request(query('gid://shopify/Product/1')), {
        storefront,
        env: EXTEND_ENV,
      }),
    );
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({status: 'invalid'});
    const put = await offersAction(
      args(
        new Request(`${ORIGIN}/api/extend/offers`, {method: 'PUT', body: '{}'}),
        {
          storefront,
          env: EXTEND_ENV,
        },
      ),
    );
    expect(put.status).toBe(405);
  });

  it('Extend off: the answer is "unavailable" and nothing is called', async () => {
    const {storefront, calls} = shopify(
      'gid://shopify/Product/5004',
      variantGid(6004),
    );
    const fetchMock = stubExtend('5004');
    const response = await offersLoader(
      args(new Request(query(variantGid(6004))), {
        storefront,
        env: {...EXTEND_ENV, PUBLIC_EXTEND_ENABLED: 'false'},
      }),
    );
    expect(await response.json()).toEqual({status: 'unavailable'});
    expect(fetchMock).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it('Extend down: still 200 and "unavailable", so the page never breaks (NFR-013)', async () => {
    const {storefront} = shopify(
      'gid://shopify/Product/5005',
      variantGid(6005),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('x', {status: 503}))),
    );
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const response = await offersLoader(
      args(new Request(query(variantGid(6005))), {storefront, env: EXTEND_ENV}),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({status: 'unavailable'});
  });
});

describe('P5A-08 webhook route', () => {
  const context = (env: object, tasks: Promise<unknown>[] = []) => ({
    env,
    waitUntil: (task: Promise<unknown>) => {
      tasks.push(task);
    },
  });

  it('answers GET with 405', () => {
    expect(webhookLoader().status).toBe(405);
  });

  it('rejects a bad signature with 401 and no body', async () => {
    const response = await webhookAction(
      args(
        await webhookRequest({signature: 'AAAA'}),
        context({SHOPIFY_APP_CLIENT_SECRET: WEBHOOK_SECRET}),
      ),
    );
    expect(response.status).toBe(401);
    expect(await response.text()).toBe('');
  });

  it('fails closed when the secret is not configured', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await webhookAction(
      args(await webhookRequest(), context({})),
    );
    expect(response.status).toBe(503);
  });

  it('accepts a signed webhook, hands the sync to waitUntil, and with sync off does no work', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const tasks: Promise<unknown>[] = [];
    const response = await webhookAction(
      args(
        await webhookRequest({webhookId: 'wh-route-0001'}),
        context(
          {
            ...EXTEND_ENV,
            EXTEND_ORDER_SYNC: 'off',
            SHOPIFY_APP_CLIENT_SECRET: WEBHOOK_SECRET,
          },
          tasks,
        ),
      ),
    );
    expect(response.status).toBe(200);
    expect(tasks).toHaveLength(1);
    await Promise.all(tasks);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
