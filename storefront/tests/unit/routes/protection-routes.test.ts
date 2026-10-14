import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {fakeStorefront, type RecordedCall} from '../catalog/fake-storefront';
import {action as cartAction} from '~/routes/cart';
import {
  action as stepsAction,
  loader as stepsLoader,
} from '~/routes/checkout-steps';
import {
  validateAddProtection,
  validateAddWithProtection,
} from '~/lib/cart/actions';
import {
  ADD_PROTECTION_ACTION,
  ADD_WITH_PROTECTION_ACTION,
} from '~/lib/cart/custom-actions';
import {resetExtendSharedForTests} from '~/lib/extend/runtime';
import {resetExtendSeamLogsForTests} from '~/lib/offers-runtime/extend-seam';
import {parseProtectionCommand} from '~/lib/offers-runtime/protection-command';
import {
  CONFIG,
  FakeCart,
  GID,
  MATTRESS_LINE,
  storefrontResponder,
} from '~/lib/offers-runtime/test-fixtures';

// REQ-ADD-003 / REQ-PRE-004 / P5A-05 / P5A-07 / T-01: the real route functions for the new protection actions, against an
// in-memory cart, a fake Storefront and a fake Extend (mock-green only).

const ORIGIN = 'http://localhost:3000';
const ENV = {
  OFFER_CONFIG_JSON: JSON.stringify({
    ...CONFIG,
    rules: {...CONFIG.rules, comfortGuarantee: undefined, gifts: []},
  }),
  PUBLIC_EXTEND_ENABLED: 'true',
  EXTEND_API_HOST: 'https://api-demo.helloextend.com',
  EXTEND_STORE_ID: 'store-1',
  EXTEND_ACCESS_TOKEN: 'fixture-token-not-real',
};

function contextFor(fake: FakeCart, env: object = ENV) {
  const base = storefrontResponder();
  const {storefront} = fakeStorefront((call: RecordedCall) => {
    if (call.query.includes('query ExtendCoverageVariants')) {
      const variant = (id: string, name: string, amount: string) => ({
        id,
        title: name,
        sku: null,
        availableForSale: true,
        price: {amount, currencyCode: 'USD'},
      });
      return {
        products: {
          pageInfo: {hasNextPage: false},
          nodes: [
            {
              id: GID.coverageProduct,
              title: 'Extend Protection Plan',
              variants: {
                pageInfo: {hasNextPage: false},
                nodes: [
                  variant(
                    GID.coverageVariant,
                    'Extend-Protection-Plan-79.99',
                    '79.99',
                  ),
                ],
              },
            },
          ],
        },
      };
    }
    if (call.query.includes('query ExtendProductCategories')) {
      const ids = Array.isArray(call.variables.ids) ? call.variables.ids : [];
      return {
        nodes: ids.map((id) => ({
          id,
          metafield: id === GID.mattress ? {value: 'mattress'} : null,
        })),
      };
    }
    if (call.query.includes('query ExtendVariantFacts')) {
      const ids = Array.isArray(call.variables.ids) ? call.variables.ids : [];
      return {
        nodes: ids.map((id) =>
          id === GID.mattressQueen
            ? {
                id,
                availableForSale: true,
                price: {amount: '1000.00', currencyCode: 'USD'},
                product: {id: GID.mattress, metafield: {value: 'mattress'}},
              }
            : null,
        ),
      };
    }
    return base(call);
  });
  const create = vi.fn(() =>
    Promise.resolve({cart: {id: 'gid://shopify/Cart/new'}}),
  );
  return {
    create,
    context: {
      storefront,
      env,
      cart: {
        get: () => fake.get(),
        removeLines: (ids: string[]) => fake.removeLines(ids),
        updateLines: (
          lines: Array<{id: string; quantity: number; merchandiseId?: string}>,
        ) => fake.updateLines(lines),
        addLines: (lines: Parameters<FakeCart['addLines']>[0]) =>
          fake.addLines(lines),
        updateAttributes: (attributes: Array<{key: string; value: string}>) =>
          fake.updateAttributes(attributes),
        setCartId: () => new Headers(),
        create,
      },
    },
  };
}

function args(request: Request, context: object, params: object = {}) {
  // Route.*Args are framework-generated; only request, context and params are used (test-only narrowing, as in cart-routes.test.ts).
  return {request, context, params} as never;
}

function post(path: string, body: FormData, headers: HeadersInit = {}) {
  return new Request(`${ORIGIN}${path}`, {method: 'POST', body, headers});
}

function cartForm(action: string, inputs: unknown) {
  const form = new FormData();
  form.set('cartFormInput', JSON.stringify({action, inputs}));
  return form;
}

function stepForm(fields: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return form;
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

const locationOf = (result: unknown) =>
  result instanceof Response ? result.headers.get('Location') : null;

function stubExtend() {
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as {
        items: Array<{productId: string; purchasePrice: number}>;
      };
      return Promise.resolve(
        new Response(
          JSON.stringify({
            offerCartId: 'c',
            storeId: 'store-1',
            offers: body.items.map((item) => ({
              offerId: 'o',
              plans: {
                adh: [
                  {
                    id: 'PLAN-LO',
                    price: 7999,
                    title: 'Accident plan',
                    contract: {termLength: 36},
                    url: 'https://extend.example/terms',
                  },
                ],
                base: [],
                recommended: 'adh',
              },
              coveredProducts: [
                {
                  productId: item.productId,
                  quantity: 1,
                  purchasePrice: item.purchasePrice,
                },
              ],
            })),
          }),
        ),
      );
    }),
  );
}

beforeEach(() => {
  resetExtendSharedForTests();
  resetExtendSeamLogsForTests();
  stubExtend();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('input validation (T-01)', () => {
  it('accepts a variant, a quantity and a plan key, and drops every other field', () => {
    expect(
      validateAddWithProtection({
        variantId: GID.mattressQueen,
        quantity: 2,
        planKey: 'PLAN-LO',
        price: '0.01',
        coverageVariantId: GID.coverageVariant,
        parent: {lineId: 'x'},
        coverageQuantity: 99,
      }),
    ).toEqual({
      status: 'ok',
      value: {variantId: GID.mattressQueen, quantity: 2, planKey: 'PLAN-LO'},
    });
  });

  it.each([
    ['no plan key', {variantId: GID.mattressQueen, quantity: 1}],
    [
      'a plan key that is not a token',
      {variantId: GID.mattressQueen, quantity: 1, planKey: '<script>'},
    ],
    [
      'a variant that is not a variant id',
      {variantId: 'x', quantity: 1, planKey: 'P'},
    ],
    [
      'a quantity above the maximum',
      {variantId: GID.mattressQueen, quantity: 100, planKey: 'P'},
    ],
    [
      'a fractional quantity',
      {variantId: GID.mattressQueen, quantity: 1.5, planKey: 'P'},
    ],
    [
      'a text quantity',
      {variantId: GID.mattressQueen, quantity: '1', planKey: 'P'},
    ],
  ])('rejects %s', (_name, input) => {
    expect(validateAddWithProtection(input).status).toBe('invalid');
  });

  it('the line action takes a line id and a plan key only', () => {
    expect(
      validateAddProtection({
        lineId: MATTRESS_LINE.id,
        planKey: 'P-1',
        quantity: 9,
      }),
    ).toEqual({
      status: 'ok',
      value: {lineId: MATTRESS_LINE.id, planKey: 'P-1'},
    });
    expect(validateAddProtection({lineId: 'x', planKey: 'P-1'}).status).toBe(
      'invalid',
    );
    expect(
      validateAddProtection({lineId: MATTRESS_LINE.id, planKey: ''}).status,
    ).toBe('invalid');
  });

  it('the step form parser accepts accept (line + plan) and decline, and refuses everything else', () => {
    const form = (fields: Record<string, string>) => stepForm(fields);
    expect(
      parseProtectionCommand(
        form({
          step: 'protection',
          intent: 'accept',
          lineId: MATTRESS_LINE.id,
          planKey: 'PLAN-LO',
        }),
      ),
    ).toEqual({
      step: 'protection',
      intent: 'accept',
      lineId: MATTRESS_LINE.id,
      planKey: 'PLAN-LO',
    });
    expect(
      parseProtectionCommand(form({step: 'protection', intent: 'decline'})),
    ).toEqual({
      step: 'protection',
      intent: 'decline',
    });
    const badForms: Array<Record<string, string>> = [
      {step: 'protection', intent: 'accept', planKey: 'PLAN-LO'},
      {step: 'protection', intent: 'accept', lineId: 'x', planKey: 'PLAN-LO'},
      {
        step: 'protection',
        intent: 'accept',
        lineId: MATTRESS_LINE.id,
        planKey: 'a b',
      },
      {step: 'protection', intent: 'add-anything'},
      {step: 'haul-away', intent: 'decline'},
    ];
    for (const bad of badForms) {
      expect(parseProtectionCommand(form(bad))).toBeNull();
    }
  });
});

describe('POST /cart CustomAddWithProtection (P5A-05)', () => {
  it('a forged request cannot choose the coverage variant, price, parent or its quantity: the server derives them', async () => {
    const fake = new FakeCart([]);
    const {context} = contextFor(fake);
    const result = await cartAction(
      args(
        post(
          '/cart',
          cartForm(ADD_WITH_PROTECTION_ACTION, {
            variantId: GID.mattressQueen,
            quantity: 1,
            planKey: 'PLAN-LO',
            coverageVariantId: GID.coverageHigh,
            price: '0.01',
            coverageQuantity: 50,
            parent: {lineId: 'gid://shopify/CartLine/evil'},
            attributes: [{key: '_extend_plan_id', value: 'FORGED'}],
          }),
        ),
        context,
      ),
    );
    expect(unwrap(result).status).toBe(200);
    const add = fake.calls.find((call) => call.method === 'addLines');
    expect(add).toEqual({
      method: 'addLines',
      lines: [
        {merchandiseId: GID.mattressQueen, quantity: 1},
        {
          merchandiseId: GID.coverageVariant,
          quantity: 1,
          attributes: [
            {key: '_extend_plan_id', value: 'PLAN-LO'},
            {key: '_extend_covered_product_id', value: '1'},
            {key: '_extend_term', value: '36'},
          ],
          parent: {merchandiseId: GID.mattressQueen},
        },
      ],
    });
    // The response carries the repaired cart and offers view like every other cart action.
    expect(unwrap(result).data.cart).toBeTruthy();
  });

  it.each([
    ['an unknown plan key', {planKey: 'EVIL'}],
    ['a coverage variant as the item', {variantId: GID.coverageVariant}],
  ])(
    '%s answers 400 with fixed text and changes nothing',
    async (_name, over) => {
      const fake = new FakeCart([]);
      const {context} = contextFor(fake);
      const result = await cartAction(
        args(
          post(
            '/cart',
            cartForm(ADD_WITH_PROTECTION_ACTION, {
              variantId: GID.mattressQueen,
              quantity: 1,
              planKey: 'PLAN-LO',
              ...over,
            }),
          ),
          context,
        ),
      );
      const {data, status} = unwrap(result);
      expect(status).toBe(400);
      expect(JSON.stringify(data.errors)).toMatch(/protection/i);
      expect(fake.calls).toEqual([]);
    },
  );

  it('invalid input answers 400 before anything is read from Shopify', async () => {
    const fake = new FakeCart([]);
    const {context} = contextFor(fake);
    const result = await cartAction(
      args(
        post(
          '/cart',
          cartForm(ADD_WITH_PROTECTION_ACTION, {
            variantId: 'x',
            quantity: 1,
            planKey: 'P',
          }),
        ),
        context,
      ),
    );
    expect(unwrap(result).status).toBe(400);
    expect(fake.calls).toEqual([]);
  });

  it('flag off: 400 and nothing added', async () => {
    const fake = new FakeCart([]);
    const {context} = contextFor(fake, {
      ...ENV,
      PUBLIC_EXTEND_ENABLED: 'false',
    });
    const result = await cartAction(
      args(
        post(
          '/cart',
          cartForm(ADD_WITH_PROTECTION_ACTION, {
            variantId: GID.mattressQueen,
            quantity: 1,
            planKey: 'PLAN-LO',
          }),
        ),
        context,
      ),
    );
    expect(unwrap(result).status).toBe(400);
    expect(fake.calls).toEqual([]);
  });

  it('a partly applied add (item in, plan not) is a 200 with a notice, not a failure', async () => {
    const fake = new FakeCart([MATTRESS_LINE]);
    const {context} = contextFor(fake);
    let n = 0;
    const real = context.cart.addLines;
    context.cart.addLines = (lines) =>
      ++n === 2 ? Promise.resolve({userErrors: [{message: 'x'}]}) : real(lines);
    const result = await cartAction(
      args(
        post(
          '/cart',
          cartForm(ADD_WITH_PROTECTION_ACTION, {
            variantId: GID.mattressQueen,
            quantity: 1,
            planKey: 'PLAN-LO',
          }),
        ),
        context,
      ),
    );
    const {data, status} = unwrap(result);
    expect(status).toBe(200);
    expect(JSON.stringify(data.warnings)).toMatch(/item was added/i);
  });
});

describe('POST /cart CustomAddProtection and the /checkout-steps protection step (P5A-07)', () => {
  const get = (query = '') => new Request(`${ORIGIN}/checkout-steps${query}`);

  it('the cart action protects a line with a server-derived nested coverage line', async () => {
    const fake = new FakeCart([MATTRESS_LINE]);
    const {context} = contextFor(fake);
    const result = await cartAction(
      args(
        post(
          '/cart',
          cartForm(ADD_PROTECTION_ACTION, {
            lineId: MATTRESS_LINE.id,
            planKey: 'PLAN-LO',
            quantity: 40,
            merchandiseId: GID.coverageHigh,
          }),
        ),
        context,
      ),
    );
    expect(unwrap(result).status).toBe(200);
    expect(fake.calls.find((c) => c.method === 'addLines')).toMatchObject({
      lines: [
        {
          merchandiseId: GID.coverageVariant,
          quantity: 1,
          parent: {lineId: MATTRESS_LINE.id},
        },
      ],
    });
  });

  it('the gate asks the protection question last, in the URL, and shows plans, then lets a skip through', async () => {
    const fake = new FakeCart([MATTRESS_LINE]);
    const {context} = contextFor(fake);
    expect(locationOf(await stepsLoader(args(get(), context)))).toBe(
      '/checkout-steps?step=protection',
    );
    const step = unwrap(
      await stepsLoader(args(get('?step=protection'), context)),
    );
    expect(step.data.state).toBe('step');
    expect(step.data.step).toBe('protection');
    expect(JSON.stringify(step.data.protection)).toContain('PLAN-LO');
    expect(step.data.skipHref).toBe('/checkout-steps?skip=1');
    expect(locationOf(await stepsLoader(args(get('?skip=1'), context)))).toBe(
      'https://shop.example/checkouts/c/c1-test',
    );
  });

  it('accept adds the coverage and returns to the gate; decline records the attribute; both then reach checkout', async () => {
    const fake = new FakeCart([MATTRESS_LINE]);
    const {context} = contextFor(fake);
    const accepted = await stepsAction(
      args(
        post(
          '/checkout-steps',
          stepForm({
            step: 'protection',
            intent: 'accept',
            lineId: MATTRESS_LINE.id,
            planKey: 'PLAN-LO',
          }),
        ),
        context,
      ),
    );
    expect(locationOf(accepted)).toBe('/checkout-steps');
    expect(
      fake.allSpecs().some((l) => l.variantId === GID.coverageVariant),
    ).toBe(true);
    expect(locationOf(await stepsLoader(args(get(), context)))).toBe(
      'https://shop.example/checkouts/c/c1-test',
    );

    const other = new FakeCart([MATTRESS_LINE]);
    const second = contextFor(other);
    const declined = await stepsAction(
      args(
        post(
          '/checkout-steps',
          stepForm({step: 'protection', intent: 'decline'}),
        ),
        second.context,
      ),
    );
    expect(locationOf(declined)).toBe('/checkout-steps');
    expect(other.attributeValue('offer_declined_protection')).toBe('yes');
    expect(locationOf(await stepsLoader(args(get(), second.context)))).toBe(
      'https://shop.example/checkouts/c/c1-test',
    );
  });

  it('a forged plan key or line carries a known code back to the step and changes nothing', async () => {
    const fake = new FakeCart([MATTRESS_LINE]);
    const {context} = contextFor(fake);
    const forgedPlan = await stepsAction(
      args(
        post(
          '/checkout-steps',
          stepForm({
            step: 'protection',
            intent: 'accept',
            lineId: MATTRESS_LINE.id,
            planKey: 'EVIL',
          }),
        ),
        context,
      ),
    );
    expect(locationOf(forgedPlan)).toBe(
      '/checkout-steps?step=protection&error=protection-plan-unknown',
    );
    const forgedLine = await stepsAction(
      args(
        post(
          '/checkout-steps',
          stepForm({
            step: 'protection',
            intent: 'accept',
            lineId: 'gid://shopify/CartLine/nope',
            planKey: 'PLAN-LO',
          }),
        ),
        context,
      ),
    );
    expect(locationOf(forgedLine)).toBe(
      '/checkout-steps?step=protection&error=protection-not-offered',
    );
    expect(fake.calls.filter((c) => c.method === 'addLines')).toEqual([]);
    const shown = unwrap(
      await stepsLoader(
        args(get('?step=protection&error=protection-plan-unknown'), context),
      ),
    );
    expect(shown.data.error).toMatch(/no longer offered/i);
  });

  it('with the flag off there is no protection step and no extra question', async () => {
    const fake = new FakeCart([MATTRESS_LINE]);
    const {context} = contextFor(fake, {
      ...ENV,
      PUBLIC_EXTEND_ENABLED: 'false',
    });
    expect(locationOf(await stepsLoader(args(get(), context)))).toBe(
      'https://shop.example/checkouts/c/c1-test',
    );
  });
});
