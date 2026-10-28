import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {fakeStorefront} from '../catalog/fake-storefront';
import productJson from '../../fixtures/shopify/product.json';
import availabilityJson from '../../fixtures/shopify/product-availability.json';
import {loader as bundleLoader} from '~/routes/api.product-bundle';
import {action as cartAction} from '~/routes/cart';
import {loader as productLoader} from '~/routes/products.$handle';
import {PRODUCT_QUERY} from '~/lib/shopify/queries';
import {ADD_PRODUCT_BUNDLE_ACTION} from '~/lib/cart/custom-actions';
import {PICKER_STEP_FAILURE_TEXT} from '~/lib/offers-runtime/messages';
import type {CartLineAddInput} from '~/lib/offers-runtime/server';
import {
  CONFIG,
  FakeCart,
  GID,
  storefrontResponder,
} from '~/lib/offers-runtime/test-fixtures';

// REQ-ADD-002 / REQ-CAT-008 / T-01 (P4-06): the bundle list route, the `/cart` action "Add all" with the viewed variant
// named, and the product loader's flag. The real route functions run against an in-memory cart and a fake Storefront
// (mock-green only: no development store has served these, and no Shopify discount has priced the set).

const ORIGIN = 'http://localhost:3000';
const BUNDLE = {
  id: 'sleep-set',
  name: 'Sleep set',
  anchorProductId: GID.mattress,
  members: [
    {
      productId: GID.foundation,
      quantity: 1,
      variants: {
        type: 'by-size',
        variantIdBySize: {Queen: GID.foundationQueen, King: GID.foundationKing},
      },
    },
    {
      productId: GID.pillow,
      quantity: 2,
      variants: {type: 'single', variantId: GID.pillowVariant},
    },
  ],
};
const ENV = {
  OFFER_CONFIG_JSON: JSON.stringify({
    ...CONFIG,
    rules: {...CONFIG.rules, comfortGuarantee: undefined, bundles: [BUNDLE]},
  }),
};

function args(request: Request, context: object) {
  // Route.*Args are framework-generated; only request, context and params are used (test-only narrowing, as in cart-routes.test.ts).
  return {request, context, params: {}} as never;
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('GET /api/product-bundle (REQ-ADD-002)', () => {
  const url = (query: string) => `${ORIGIN}/api/product-bundle${query}`;
  const forProduct = (id: string) => `?productId=${encodeURIComponent(id)}`;

  it('lists the in-stock sets of every size for the anchor product, with a short private cache', async () => {
    const {storefront} = fakeStorefront(storefrontResponder());
    const response = await bundleLoader(
      args(new Request(url(forProduct(GID.mattress))), {
        storefront,
        env: ENV,
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('application/json');
    expect(response.headers.get('Cache-Control')).toBe('private, max-age=60');
    expect(await response.json()).toMatchObject({
      status: 'ok',
      bundle: {
        bundleId: 'sleep-set',
        sets: [{size: 'Queen'}, {size: 'King'}],
      },
    });
  });

  it('answers "show nothing", with no Shopify read, for a product that anchors no bundle', async () => {
    const {storefront, calls} = fakeStorefront(storefrontResponder());
    const response = await bundleLoader(
      args(new Request(url(forProduct(GID.other))), {storefront, env: ENV}),
    );
    expect(await response.json()).toEqual({status: 'ok', bundle: null});
    expect(calls).toEqual([]);
  });

  it.each([
    ['no product id', ''],
    ['a variant id', forProduct(GID.foundationQueen)],
    ['a handle', '?productId=queen-mattress'],
    [
      'an injection attempt',
      '?productId=gid%3A%2F%2Fshopify%2FProduct%2F1%22%7D',
    ],
  ])('refuses %s with 400, no cache and no read', async (_name, query) => {
    const {storefront, calls} = fakeStorefront(storefrontResponder());
    const response = await bundleLoader(
      args(new Request(url(query)), {storefront, env: ENV}),
    );
    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(calls).toEqual([]);
  });

  it('answers 502 with no cache when the Shopify read fails, never an empty answer a cache would keep', async () => {
    const {storefront} = fakeStorefront(() => {
      throw new Error('upstream down');
    });
    const response = await bundleLoader(
      args(new Request(url(forProduct(GID.mattress))), {
        storefront,
        env: ENV,
      }),
    );
    expect(response.status).toBe(502);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toEqual({status: 'unavailable'});
  });

  it('refuses a request the browser labels cross-site', async () => {
    const {storefront, calls} = fakeStorefront(storefrontResponder());
    const response = await bundleLoader(
      args(
        new Request(url(forProduct(GID.mattress)), {
          headers: {'Sec-Fetch-Site': 'cross-site'},
        }),
        {storefront, env: ENV},
      ),
    );
    expect(response.status).toBe(403);
    expect(calls).toEqual([]);
  });
});

function post(inputs: unknown, headers: HeadersInit = {}) {
  const form = new FormData();
  form.set(
    'cartFormInput',
    JSON.stringify({action: ADD_PRODUCT_BUNDLE_ACTION, inputs}),
  );
  return new Request(`${ORIGIN}/cart`, {method: 'POST', body: form, headers});
}

function contextFor(fake: FakeCart) {
  const {storefront} = fakeStorefront(storefrontResponder());
  return {
    storefront,
    env: ENV,
    cart: {
      get: () => fake.get(),
      removeLines: (ids: string[]) => fake.removeLines(ids),
      updateLines: (
        lines: Array<{id: string; quantity: number; merchandiseId?: string}>,
      ) => fake.updateLines(lines),
      addLines: (lines: CartLineAddInput[]) => fake.addLines(lines),
      updateAttributes: (attributes: Array<{key: string; value: string}>) =>
        fake.updateAttributes(attributes),
      setCartId: () => new Headers(),
      create: () => Promise.resolve({cart: {id: 'gid://shopify/Cart/new'}}),
    },
  };
}

function unwrap(result: unknown): {
  data: Record<string, unknown>;
  status: number;
} {
  if (
    typeof result === 'object' &&
    result !== null &&
    'data' in result &&
    'init' in result
  ) {
    const {data, init} = result;
    const status =
      typeof init === 'object' && init !== null && 'status' in init
        ? Number(init.status)
        : 200;
    if (typeof data === 'object' && data !== null) {
      return {data: Object.fromEntries(Object.entries(data)), status};
    }
  }
  throw new Error(`Not a data() result: ${String(result)}`);
}

function messagesOf(list: unknown): string[] {
  return Array.isArray(list)
    ? list.flatMap((entry: unknown) =>
        typeof entry === 'object' &&
        entry !== null &&
        'message' in entry &&
        typeof entry.message === 'string'
          ? [entry.message]
          : [],
      )
    : [];
}

describe('"Add all" from the product page through /cart (REQ-ADD-002, T-01)', () => {
  it('adds the viewed variant and its companions to an empty cart and answers with the refreshed cart', async () => {
    const fake = new FakeCart([]);
    const {data, status} = unwrap(
      await cartAction(
        args(
          post({bundleId: 'sleep-set', anchorVariantId: GID.mattressKing}),
          contextFor(fake),
        ),
      ),
    );
    expect(status).toBe(200);
    expect(messagesOf(data.errors)).toEqual([]);
    expect(
      fake.allSpecs().map((spec) => [spec.variantId, spec.quantity]),
    ).toEqual([
      [GID.mattressKing, 1],
      [GID.foundationKing, 1],
      [GID.pillowVariant, 2],
    ]);
  });

  it('ignores a quantity, a price, a discount and lines sent by the browser', async () => {
    const fake = new FakeCart([]);
    unwrap(
      await cartAction(
        args(
          post({
            bundleId: 'sleep-set',
            anchorVariantId: GID.mattressQueen,
            quantity: 40,
            price: '0.00',
            discount: 'FREE',
            lines: [{merchandiseId: GID.otherVariant, quantity: 9}],
          }),
          contextFor(fake),
        ),
      ),
    );
    expect(fake.calls).toEqual([
      {
        method: 'addLines',
        lines: [
          {merchandiseId: GID.mattressQueen, quantity: 1},
          {merchandiseId: GID.foundationQueen, quantity: 1},
          {merchandiseId: GID.pillowVariant, quantity: 2},
        ],
      },
    ]);
  });

  it('a bundle that does not exist answers 400 with a fixed message and changes nothing', async () => {
    const fake = new FakeCart([]);
    const {data, status} = unwrap(
      await cartAction(
        args(
          post({bundleId: 'forged', anchorVariantId: GID.mattressQueen}),
          contextFor(fake),
        ),
      ),
    );
    expect(status).toBe(400);
    expect(messagesOf(data.errors)).toEqual([
      PICKER_STEP_FAILURE_TEXT['bundle-not-offered'],
    ]);
    expect(fake.calls).toEqual([]);
  });

  it('a malformed variant id answers 400 before anything is read', async () => {
    const fake = new FakeCart([]);
    const {status} = unwrap(
      await cartAction(
        args(
          post({bundleId: 'sleep-set', anchorVariantId: 'x'}),
          contextFor(fake),
        ),
      ),
    );
    expect(status).toBe(400);
    expect(fake.calls).toEqual([]);
  });

  it('refuses a cross-site post', async () => {
    const fake = new FakeCart([]);
    const response = await cartAction(
      args(
        post(
          {bundleId: 'sleep-set', anchorVariantId: GID.mattressQueen},
          {Origin: 'https://evil.example'},
        ),
        contextFor(fake),
      ),
    );
    expect(unwrap(response).status).toBe(403);
    expect(fake.calls).toEqual([]);
  });
});

describe('product loader flag bundleExpected (REQ-ADD-002)', () => {
  const PRODUCT_ID = productJson.product.id;
  const withBundle = (anchorProductId: string) => ({
    OFFER_CONFIG_JSON: JSON.stringify({
      ...CONFIG,
      rules: {...CONFIG.rules, bundles: [{...BUNDLE, anchorProductId}]},
    }),
  });

  function run(env: Record<string, string>) {
    const {storefront} = fakeStorefront((call) => {
      if (call.query === PRODUCT_QUERY) return productJson;
      if (call.query.includes('query CatalogProductAvailability')) {
        return availabilityJson;
      }
      if (call.query.includes('query OfferOnlyProductHandles')) {
        return {products: {nodes: []}};
      }
      if (call.query.includes('query CatalogBrandsIndex')) {
        return {brands: {nodes: []}};
      }
      return {};
    });
    return productLoader({
      request: new Request(
        `https://www.example.com/products/${productJson.product.handle}`,
      ),
      context: {storefront, env},
      params: {handle: productJson.product.handle},
    } as never);
  }

  it('is true when a bundle rule makes this product the anchor', async () => {
    expect((await run(withBundle(PRODUCT_ID))).bundleExpected).toBe(true);
  });

  it('is false for a product no rule anchors, with no configuration, and with the offers switched off', async () => {
    expect((await run(withBundle(GID.mattress))).bundleExpected).toBe(false);
    expect((await run({})).bundleExpected).toBe(false);
    expect(
      (await run({...withBundle(PRODUCT_ID), OFFERS_ENABLED: 'false'}))
        .bundleExpected,
    ).toBe(false);
  });
});
