import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {fakeStorefront} from '../catalog/fake-storefront';
import productJson from '../../fixtures/shopify/product.json';
import availabilityJson from '../../fixtures/shopify/product-availability.json';
import {loader as addOnsLoader} from '~/routes/api.product-addons';
import {action as cartAction} from '~/routes/cart';
import {loader as productLoader} from '~/routes/products.$handle';
import {PRODUCT_QUERY} from '~/lib/shopify/queries';
import {ADD_ADDON_ACTION} from '~/lib/cart/custom-actions';
import {PICKER_STEP_FAILURE_TEXT} from '~/lib/offers-runtime/messages';
import type {CartLineAddInput} from '~/lib/offers-runtime/server';
import {
  CONFIG,
  FakeCart,
  GID,
  MATTRESS_LINE,
  storefrontResponder,
} from '~/lib/offers-runtime/test-fixtures';

// REQ-ADD-001 / REQ-CAT-007 / T-01 (P4-03): the add-on list route, the `/cart` action with a mattress named, and the
// product loader's flag. The real route functions run against an in-memory cart and a fake Storefront (mock-green only:
// no development store has served these).

const ORIGIN = 'http://localhost:3000';
const RULES = {
  ...CONFIG.rules,
  matchingAddOns: {
    foundations: [
      {
        mattressProductId: GID.mattress,
        size: 'Queen',
        productId: GID.foundation,
        variantId: GID.foundationQueen,
      },
      {
        mattressProductId: GID.mattress,
        size: 'King',
        productId: GID.foundation,
        variantId: GID.foundationKing,
      },
    ],
  },
};
const ENV = {OFFER_CONFIG_JSON: JSON.stringify({...CONFIG, rules: RULES})};

function args(request: Request, context: object) {
  // Route.*Args are framework-generated; only request, context and params are used (test-only narrowing, as in cart-routes.test.ts).
  return {request, context, params: {}} as never;
}

async function bodyOf(response: Response): Promise<unknown> {
  return response.json();
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('GET /api/product-addons (REQ-ADD-001)', () => {
  const url = (query: string) => `${ORIGIN}/api/product-addons${query}`;

  it('lists the in-stock foundations of every size for a mattress product', async () => {
    const {storefront} = fakeStorefront(storefrontResponder());
    const response = await addOnsLoader(
      args(new Request(url(`?productId=${encodeURIComponent(GID.mattress)}`)), {
        storefront,
        env: ENV,
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('application/json');
    // The same for every shopper and priced like a card: a short private browser cache, never shared.
    expect(response.headers.get('Cache-Control')).toBe('private, max-age=60');
    const body = await bodyOf(response);
    expect(body).toMatchObject({
      status: 'ok',
      items: [
        {size: 'Queen', variant: {variantId: GID.foundationQueen}},
        {size: 'King', variant: {variantId: GID.foundationKing}},
      ],
    });
  });

  it('answers an empty list, with no Shopify read, for a product that is not a mattress with add-ons', async () => {
    const {storefront, calls} = fakeStorefront(storefrontResponder());
    const response = await addOnsLoader(
      args(new Request(url(`?productId=${encodeURIComponent(GID.other)}`)), {
        storefront,
        env: ENV,
      }),
    );
    expect(await bodyOf(response)).toEqual({status: 'ok', items: []});
    expect(calls).toEqual([]);
  });

  it.each([
    ['no product id', ''],
    ['a variant id', `?productId=${encodeURIComponent(GID.foundationQueen)}`],
    ['a handle', '?productId=queen-mattress'],
    [
      'an injection attempt',
      '?productId=gid%3A%2F%2Fshopify%2FProduct%2F1%22%7D',
    ],
  ])(
    'refuses %s with 400 and no cache, and reads nothing',
    async (_n, query) => {
      const {storefront, calls} = fakeStorefront(storefrontResponder());
      const response = await addOnsLoader(
        args(new Request(url(query)), {storefront, env: ENV}),
      );
      expect(response.status).toBe(400);
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
      expect(await bodyOf(response)).toEqual({status: 'invalid'});
      expect(calls).toEqual([]);
    },
  );

  it('refuses a request the browser labels cross-site', async () => {
    const {storefront, calls} = fakeStorefront(storefrontResponder());
    const response = await addOnsLoader(
      args(
        new Request(url(`?productId=${encodeURIComponent(GID.mattress)}`), {
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
  form.set('cartFormInput', JSON.stringify({action: ADD_ADDON_ACTION, inputs}));
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

describe('add-on from the product page through /cart (REQ-ADD-001, T-01)', () => {
  it('adds the mattress and the foundation to an empty cart and answers with the refreshed cart', async () => {
    const fake = new FakeCart([]);
    const {data, status} = unwrap(
      await cartAction(
        args(
          post({
            variantId: GID.foundationQueen,
            mattressVariantId: GID.mattressQueen,
          }),
          contextFor(fake),
        ),
      ),
    );
    expect(status).toBe(200);
    expect(messagesOf(data.errors)).toEqual([]);
    expect(fake.allSpecs().map((spec) => spec.variantId)).toEqual([
      GID.mattressQueen,
      GID.foundationQueen,
    ]);
    expect(fake.allSpecs().map((spec) => spec.quantity ?? 1)).toEqual([1, 1]);
  });

  it('adds only the foundation when the mattress is already in the cart', async () => {
    const fake = new FakeCart([MATTRESS_LINE]);
    unwrap(
      await cartAction(
        args(
          post({
            variantId: GID.foundationQueen,
            mattressVariantId: GID.mattressQueen,
          }),
          contextFor(fake),
        ),
      ),
    );
    expect(fake.allSpecs().map((spec) => spec.variantId)).toEqual([
      GID.mattressQueen,
      GID.foundationQueen,
    ]);
  });

  it('ignores a quantity, a price and a parent sent by the browser', async () => {
    const fake = new FakeCart([]);
    unwrap(
      await cartAction(
        args(
          post({
            variantId: GID.foundationQueen,
            mattressVariantId: GID.mattressQueen,
            quantity: 40,
            price: '0.00',
            parent: {lineId: 'x'},
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
        ],
      },
    ]);
  });

  it('a pair the rules do not relate answers 400 with a fixed message and changes nothing', async () => {
    const fake = new FakeCart([]);
    const {data, status} = unwrap(
      await cartAction(
        args(
          post({
            variantId: GID.foundationKing,
            mattressVariantId: GID.mattressQueen,
          }),
          contextFor(fake),
        ),
      ),
    );
    expect(status).toBe(400);
    expect(messagesOf(data.errors)).toEqual([
      PICKER_STEP_FAILURE_TEXT['addon-not-offered'],
    ]);
    expect(fake.calls).toEqual([]);
  });

  it('a malformed mattress id answers 400 before anything is read', async () => {
    const fake = new FakeCart([]);
    const {status} = unwrap(
      await cartAction(
        args(
          post({variantId: GID.foundationQueen, mattressVariantId: 'x'}),
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
          {
            variantId: GID.foundationQueen,
            mattressVariantId: GID.mattressQueen,
          },
          {Origin: 'https://evil.example'},
        ),
        contextFor(fake),
      ),
    );
    expect(unwrap(response).status).toBe(403);
    expect(fake.calls).toEqual([]);
  });
});

describe('product loader flag addOnsExpected (REQ-ADD-001)', () => {
  const PRODUCT_ID = productJson.product.id;
  const withRule = (mattressProductId: string) => ({
    OFFER_CONFIG_JSON: JSON.stringify({
      ...CONFIG,
      rules: {
        ...CONFIG.rules,
        matchingAddOns: {
          foundations: [
            {
              mattressProductId,
              size: null,
              productId: GID.foundation,
              variantId: GID.foundationQueen,
            },
          ],
        },
      },
    }),
  });

  function run(env: Record<string, string>, cookie = '') {
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
        {headers: cookie ? {Cookie: cookie} : {}},
      ),
      context: {storefront, env},
      params: {handle: productJson.product.handle},
    } as never);
  }

  it('is true when the rules relate foundations to this product', async () => {
    expect((await run(withRule(PRODUCT_ID))).addOnsExpected).toBe(true);
  });

  it('is false for a product the rules do not mention, and with no configuration', async () => {
    expect((await run(withRule(GID.mattress))).addOnsExpected).toBe(false);
    expect((await run({})).addOnsExpected).toBe(false);
  });

  it('is opted in by the development-only e2e cookie even with no configuration', async () => {
    expect((await run({}, 'a=b; e2e_addons_expected=1')).addOnsExpected).toBe(
      true,
    );
    expect((await run({}, 'e2e_addons_expected=0')).addOnsExpected).toBe(false);
  });

  it('is false with the offers switched off', async () => {
    expect(
      (await run({...withRule(PRODUCT_ID), OFFERS_ENABLED: 'false'}))
        .addOnsExpected,
    ).toBe(false);
  });

  it('makes no extra Shopify read (the list is asked for after load)', async () => {
    const calls: string[] = [];
    const {storefront} = fakeStorefront((call) => {
      calls.push(/query (\w+)/.exec(call.query)?.[1] ?? '?');
      if (call.query === PRODUCT_QUERY) return productJson;
      if (call.query.includes('query CatalogProductAvailability')) {
        return availabilityJson;
      }
      if (call.query.includes('query OfferOnlyProductHandles')) {
        return {products: {nodes: []}};
      }
      return {brands: {nodes: []}};
    });
    await productLoader({
      request: new Request('https://www.example.com/products/x'),
      context: {storefront, env: withRule(PRODUCT_ID)},
      params: {handle: productJson.product.handle},
    } as never);
    expect(calls).not.toContain('CartOfferVariants');
  });
});
