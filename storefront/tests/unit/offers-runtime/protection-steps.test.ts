import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {fakeStorefront, type RecordedCall} from '../catalog/fake-storefront';
import {resetExtendSharedForTests} from '~/lib/extend/runtime';
import {resetExtendSeamLogsForTests} from '~/lib/offers-runtime/extend-seam';
import {
  addItemWithProtection,
  addProtectionToLine,
  declineProtection,
} from '~/lib/offers-runtime/protection-steps';
import {
  revalidateCartOffers,
  type CartMutationResult,
  type OfferRuntime,
  type StepChangeResult,
} from '~/lib/offers-runtime/server';
import {
  CONFIG,
  FakeCart,
  GID,
  MATTRESS_LINE,
  storefrontResponder,
} from '~/lib/offers-runtime/test-fixtures';

// REQ-ADD-003 / REQ-PRE-004 / REQ-EXT-002 / P5A-05 / P5A-07 / T-01 / T-06: the accept and decline actions, against the
// real cart gate, a fake Storefront and a fake Extend. The browser names a variant or line and a PLAN KEY; everything
// else (coverage variant, price, quantity, parent, attributes) is the server's. Mock-green only: nothing here has run
// against Extend's demo host or a development store (V-16, V-11).

const EXTEND_ENV = {
  // No comfort-guarantee rule, so the protection step is the first question the shopper meets.
  OFFER_CONFIG_JSON: JSON.stringify({
    ...CONFIG,
    rules: {...CONFIG.rules, comfortGuarantee: undefined, gifts: []},
  }),
  PUBLIC_EXTEND_ENABLED: 'true',
  EXTEND_API_HOST: 'https://api-demo.helloextend.com',
  EXTEND_STORE_ID: 'store-1',
  EXTEND_ACCESS_TOKEN: 'fixture-token-not-real',
};
const QUEEN_CENTS = 100_000;

function catalogAnswer(): unknown {
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
              variant(
                GID.coverageHigh,
                'Extend-Protection-Plan-99.99',
                '99.99',
              ),
            ],
          },
        },
      ],
    },
  };
}

/** Variants Shopify knows, with price and the product's Extend category (the other product has none). */
const FACTS: Record<
  string,
  {product: string; cents: number; category: string | null}
> = {
  [GID.mattressQueen]: {
    product: GID.mattress,
    cents: QUEEN_CENTS,
    category: 'mattress',
  },
  [GID.otherVariant]: {product: GID.other, cents: 5_000, category: null},
};

function setup(
  cart: FakeCart,
  env: object = EXTEND_ENV,
  overrides: {addLines?: OfferRuntime['cart']['addLines']} = {},
) {
  const base = storefrontResponder();
  const {storefront, calls} = fakeStorefront((call: RecordedCall) => {
    if (call.query.includes('query ExtendCoverageVariants'))
      return catalogAnswer();
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
        nodes: ids.map((id) => {
          const fact = typeof id === 'string' ? FACTS[id] : undefined;
          if (!fact) return null;
          return {
            id,
            availableForSale: true,
            price: {
              amount: (fact.cents / 100).toFixed(2),
              currencyCode: 'USD',
            },
            product: {
              id: fact.product,
              metafield: fact.category ? {value: fact.category} : null,
            },
          };
        }),
      };
    }
    return base(call);
  });
  const handler: OfferRuntime['cart'] = {
    get: () => cart.get(),
    removeLines: (ids) => cart.removeLines(ids),
    updateLines: (lines) => cart.updateLines(lines),
    addLines: overrides.addLines ?? ((lines) => cart.addLines(lines)),
    updateAttributes: (attributes) => cart.updateAttributes(attributes),
  };
  const runtime: OfferRuntime = {
    storefront,
    cart: handler,
    env,
    production: true,
  };
  return {runtime, calls};
}

/** Extend quotes 79.99 (PLAN-LO) up to a 1,499.99 item and 99.99 (PLAN-HI) above it; term 36 months. */
function stubExtend(status = 200) {
  const fetchMock = vi.fn((_url: string, init: RequestInit) => {
    if (status !== 200) return Promise.resolve(new Response('x', {status}));
    const body = JSON.parse(String(init.body)) as {
      items: Array<{productId: string; purchasePrice: number}>;
    };
    return Promise.resolve(
      new Response(
        JSON.stringify({
          offerCartId: 'c',
          storeId: 'store-1',
          offers: body.items.map((item) => ({
            offerId: `o-${item.productId}`,
            plans: {
              adh: [
                {
                  id: item.purchasePrice >= 150_000 ? 'PLAN-HI' : 'PLAN-LO',
                  price: item.purchasePrice >= 150_000 ? 9999 : 7999,
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
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  resetExtendSharedForTests();
  resetExtendSeamLogsForTests();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function rejection(result: StepChangeResult): string {
  if (result.status !== 'rejected') throw new Error('expected a rejection');
  return result.code;
}

const addCalls = (cart: FakeCart) =>
  cart.calls.flatMap((call) => (call.method === 'addLines' ? [call] : []));

const EXPECTED_ATTRIBUTES = [
  {key: '_extend_plan_id', value: 'PLAN-LO'},
  {key: '_extend_covered_product_id', value: '1'},
  {key: '_extend_term', value: '36'},
];

describe('addItemWithProtection: the product-page add (P5A-05, REQ-ADD-003)', () => {
  it('adds the item and a nested coverage line in ONE cart call, with server-derived variant, quantity and attributes', async () => {
    stubExtend();
    const fake = new FakeCart([]);
    const {runtime} = setup(fake);
    const result = await addItemWithProtection(runtime, fake.snapshot(), {
      variantId: GID.mattressQueen,
      quantity: 1,
      planKey: 'PLAN-LO',
    });
    expect(result.status).toBe('ok');
    expect(addCalls(fake)).toEqual([
      {
        method: 'addLines',
        lines: [
          {merchandiseId: GID.mattressQueen, quantity: 1},
          {
            // The 79.99 price point, chosen by the server from the quoted price.
            merchandiseId: GID.coverageVariant,
            quantity: 1,
            attributes: EXPECTED_ATTRIBUTES,
            parent: {merchandiseId: GID.mattressQueen},
          },
        ],
      },
    ]);
    const nested = fake
      .allSpecs()
      .find((l) => l.variantId === GID.coverageVariant);
    expect(nested?.parentId).toBeDefined();

    // The existing gate finds nothing to repair: the link, quantity and price are all valid.
    const gate = await revalidateCartOffers(runtime, await fake.get());
    expect(gate.check?.status).toBe('ok');
    expect(addCalls(fake)).toHaveLength(1);
  });

  it('the coverage quantity follows the item quantity', async () => {
    stubExtend();
    const fake = new FakeCart([]);
    const {runtime} = setup(fake);
    await addItemWithProtection(runtime, fake.snapshot(), {
      variantId: GID.mattressQueen,
      quantity: 2,
      planKey: 'PLAN-LO',
    });
    const lines = addCalls(fake)[0]?.lines as Array<{quantity: number}>;
    expect(lines.map((line) => line.quantity)).toEqual([2, 2]);
  });

  describe('tampering is refused with a fixed code and the cart is untouched', () => {
    it.each([
      [
        'a plan key Extend never quoted for this item',
        'EVIL-PLAN',
        'protection-plan-unknown',
      ],
      // PLAN-HI is a real plan, but quoted only for items above 1,500: a Queen at 1,000 cannot take it.
      [
        'a real plan quoted for a different price band',
        'PLAN-HI',
        'protection-plan-unknown',
      ],
    ])('%s', async (_name, planKey, code) => {
      stubExtend();
      const fake = new FakeCart([]);
      const {runtime} = setup(fake);
      const result = await addItemWithProtection(runtime, fake.snapshot(), {
        variantId: GID.mattressQueen,
        quantity: 1,
        planKey,
      });
      expect(rejection(result)).toBe(code);
      expect(fake.calls).toEqual([]);
    });

    it('a coverage variant named as the item (forged variant id) is not allowed', async () => {
      stubExtend();
      const fake = new FakeCart([]);
      const {runtime} = setup(fake);
      for (const variantId of [GID.coverageVariant, GID.coverageHigh]) {
        const result = await addItemWithProtection(runtime, fake.snapshot(), {
          variantId,
          quantity: 1,
          planKey: 'PLAN-LO',
        });
        expect(rejection(result)).toBe('protection-not-allowed');
      }
      expect(fake.calls).toEqual([]);
    });

    it('a variant Shopify does not know, or a product with no Extend category, is unavailable', async () => {
      stubExtend();
      const fake = new FakeCart([]);
      const {runtime} = setup(fake);
      for (const variantId of [
        'gid://shopify/ProductVariant/987654',
        GID.otherVariant,
      ]) {
        const result = await addItemWithProtection(runtime, fake.snapshot(), {
          variantId,
          quantity: 1,
          planKey: 'PLAN-LO',
        });
        expect(rejection(result)).toBe('protection-unavailable');
      }
      expect(fake.calls).toEqual([]);
    });

    it('flag off: nothing is added and neither Shopify nor Extend is asked anything', async () => {
      const fetchMock = stubExtend();
      const fake = new FakeCart([]);
      const {runtime, calls} = setup(fake, {
        ...EXTEND_ENV,
        PUBLIC_EXTEND_ENABLED: 'false',
      });
      const result = await addItemWithProtection(runtime, fake.snapshot(), {
        variantId: GID.mattressQueen,
        quantity: 1,
        planKey: 'PLAN-LO',
      });
      expect(rejection(result)).toBe('protection-unavailable');
      expect(fake.calls).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(calls).toEqual([]);
    });

    it('Extend down: nothing is added (the shopper can add the item without protection)', async () => {
      stubExtend(503);
      const fake = new FakeCart([]);
      const {runtime} = setup(fake);
      const result = await addItemWithProtection(runtime, fake.snapshot(), {
        variantId: GID.mattressQueen,
        quantity: 1,
        planKey: 'PLAN-LO',
      });
      expect(rejection(result)).toBe('protection-unavailable');
      expect(fake.calls).toEqual([]);
    });
  });

  it('Shopify refusing the add changes nothing and is reported as a fixed code', async () => {
    stubExtend();
    const fake = new FakeCart([]);
    fake.failNext = true;
    const {runtime} = setup(fake);
    const result = await addItemWithProtection(runtime, fake.snapshot(), {
      variantId: GID.mattressQueen,
      quantity: 1,
      planKey: 'PLAN-LO',
    });
    expect(rejection(result)).toBe('protection-add-failed');
    expect(fake.allSpecs()).toEqual([]);
  });

  it('a stale cart cookie (the add answers with no cart) starts a fresh cart with the same two lines', async () => {
    stubExtend();
    const fake = new FakeCart([]);
    const create = vi.fn(() => Promise.resolve<CartMutationResult>({}));
    const {runtime} = setup(fake, EXTEND_ENV, {
      addLines: () => Promise.resolve({cart: null}),
    });
    const result = await addItemWithProtection(
      runtime,
      null,
      {variantId: GID.mattressQueen, quantity: 1, planKey: 'PLAN-LO'},
      create,
    );
    expect(result.status).toBe('ok');
    expect(create).toHaveBeenCalledTimes(1);
    const input = create.mock.calls[0] as unknown as [{lines: unknown[]}];
    expect(input[0].lines).toHaveLength(2);
  });

  it('item already in the cart: the item is added first, then the coverage is nested by LINE id (never by variant)', async () => {
    stubExtend();
    const fake = new FakeCart([MATTRESS_LINE]);
    const {runtime} = setup(fake);
    const result = await addItemWithProtection(runtime, fake.snapshot(), {
      variantId: GID.mattressQueen,
      quantity: 1,
      planKey: 'PLAN-LO',
    });
    expect(result.status).toBe('ok');
    expect(result.status === 'ok' && result.warning).toBeFalsy();
    const calls = addCalls(fake);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.lines).toEqual([
      {merchandiseId: GID.mattressQueen, quantity: 1},
    ]);
    expect(calls[1]?.lines).toEqual([
      {
        merchandiseId: GID.coverageVariant,
        quantity: 1,
        attributes: EXPECTED_ATTRIBUTES,
        parent: {lineId: MATTRESS_LINE.id},
      },
    ]);
    expect(fake.quantityOf(MATTRESS_LINE.id)).toBe(2);
  });

  it('if the second step fails the item stays in the cart and the result carries the partial warning', async () => {
    stubExtend();
    const fake = new FakeCart([MATTRESS_LINE]);
    let n = 0;
    const {runtime} = setup(fake, EXTEND_ENV, {
      addLines: (lines) =>
        ++n === 2
          ? Promise.resolve({userErrors: [{message: 'nope'}]})
          : fake.addLines(lines),
    });
    const result = await addItemWithProtection(runtime, fake.snapshot(), {
      variantId: GID.mattressQueen,
      quantity: 1,
      planKey: 'PLAN-LO',
    });
    expect(result).toMatchObject({status: 'ok', warning: 'protection-partial'});
    expect(fake.quantityOf(MATTRESS_LINE.id)).toBe(2);
  });

  it('clears an earlier decline BEFORE adding, so a failed add never leaves protection next to a decline', async () => {
    stubExtend();
    const fake = new FakeCart([], {
      attributes: [{key: 'offer_declined_protection', value: 'yes'}],
    });
    const {runtime} = setup(fake);
    await addItemWithProtection(runtime, fake.snapshot(), {
      variantId: GID.mattressQueen,
      quantity: 1,
      planKey: 'PLAN-LO',
    });
    expect(fake.calls[0]?.method).toBe('updateAttributes');
    expect(fake.attributeValue('offer_declined_protection')).toBe('no');
  });
});

describe('addProtectionToLine and declineProtection: cart and pre-checkout step (P5A-07, REQ-PRE-004, REQ-PRE-005)', () => {
  const LINE = MATTRESS_LINE.id;

  it('the step view offers plans per uncovered eligible line, without variant ids, and is the next step', async () => {
    stubExtend();
    const fake = new FakeCart([MATTRESS_LINE]);
    const {runtime} = setup(fake);
    const offers = await revalidateCartOffers(runtime, fake.snapshot());
    expect(offers.view?.nextStep).toBe('protection');
    expect(offers.view?.accidentProtection).toMatchObject({
      status: 'pending',
      poweredBy: 'Extend',
      lines: [
        {
          lineId: LINE,
          uncoveredQuantity: 1,
          plans: [
            {
              planId: 'PLAN-LO',
              priceCents: 7999,
              termMonths: 36,
              termsUrl: 'https://extend.example/terms',
            },
          ],
        },
      ],
    });
    const text = JSON.stringify(offers.view);
    expect(text).not.toContain(GID.coverageVariant);
    expect(text).not.toContain('imageUrl');
  });

  it('accept nests the coverage under the line for the UNCOVERED units; the gate then finds the cart clean', async () => {
    stubExtend();
    const fake = new FakeCart([{...MATTRESS_LINE, quantity: 3}]);
    const {runtime} = setup(fake);
    const result = await addProtectionToLine(runtime, fake.snapshot(), {
      lineId: LINE,
      planKey: 'PLAN-LO',
    });
    expect(result.status).toBe('ok');
    expect(addCalls(fake)[0]?.lines).toEqual([
      {
        merchandiseId: GID.coverageVariant,
        quantity: 3,
        attributes: EXPECTED_ATTRIBUTES,
        parent: {lineId: LINE},
      },
    ]);
    const gate = await revalidateCartOffers(runtime, await fake.get());
    expect(gate.check?.status).toBe('ok');
    expect(gate.view?.accidentProtection?.status).toBe('accepted');
    expect(gate.view?.nextStep).toBeNull();
  });

  it('covers only what is still uncovered when part of the line already has coverage', async () => {
    stubExtend();
    const fake = new FakeCart([
      {...MATTRESS_LINE, quantity: 3},
      {
        id: 'gid://shopify/CartLine/cov1',
        variantId: GID.coverageVariant,
        productId: GID.coverageProduct,
        priceCents: 7999,
        quantity: 1,
        parentId: LINE,
      },
    ]);
    const {runtime} = setup(fake);
    await addProtectionToLine(runtime, fake.snapshot(), {
      lineId: LINE,
      planKey: 'PLAN-LO',
    });
    const lines = addCalls(fake)[0]?.lines as Array<{quantity: number}>;
    expect(lines[0]?.quantity).toBe(2);
  });

  describe('forged requests change nothing', () => {
    it.each([
      [
        'a plan key Extend did not quote for this line',
        LINE,
        'EVIL',
        'protection-plan-unknown',
      ],
      [
        'a line id that is not in the cart',
        'gid://shopify/CartLine/nope',
        'PLAN-LO',
        'protection-not-offered',
      ],
    ])('%s', async (_name, lineId, planKey, code) => {
      stubExtend();
      const fake = new FakeCart([MATTRESS_LINE]);
      const {runtime} = setup(fake);
      const result = await addProtectionToLine(runtime, fake.snapshot(), {
        lineId,
        planKey,
      });
      expect(rejection(result)).toBe(code);
      expect(addCalls(fake)).toEqual([]);
    });

    it('a coverage line, an ineligible line and an already covered line are not offered', async () => {
      stubExtend();
      const other = {
        id: 'gid://shopify/CartLine/o',
        variantId: GID.otherVariant,
        productId: GID.other,
      };
      const fake = new FakeCart([
        MATTRESS_LINE,
        other,
        {
          id: 'gid://shopify/CartLine/cov',
          variantId: GID.coverageVariant,
          productId: GID.coverageProduct,
          priceCents: 7999,
          parentId: LINE,
        },
      ]);
      const {runtime} = setup(fake);
      for (const lineId of ['gid://shopify/CartLine/cov', other.id, LINE]) {
        const result = await addProtectionToLine(runtime, fake.snapshot(), {
          lineId,
          planKey: 'PLAN-LO',
        });
        expect(rejection(result)).toBe('protection-not-offered');
      }
      expect(addCalls(fake)).toEqual([]);
    });

    it('flag off and Extend down offer nothing to accept', async () => {
      const fake = new FakeCart([MATTRESS_LINE]);
      stubExtend(503);
      expect(
        rejection(
          await addProtectionToLine(setup(fake).runtime, fake.snapshot(), {
            lineId: LINE,
            planKey: 'PLAN-LO',
          }),
        ),
      ).toBe('protection-not-offered');
      stubExtend();
      expect(
        rejection(
          await addProtectionToLine(
            setup(fake, {...EXTEND_ENV, PUBLIC_EXTEND_ENABLED: 'false'})
              .runtime,
            fake.snapshot(),
            {lineId: LINE, planKey: 'PLAN-LO'},
          ),
        ),
      ).toBe('protection-not-offered');
      expect(addCalls(fake)).toEqual([]);
    });
  });

  it('decline records the documented attribute only while the step is pending; accepting later clears it', async () => {
    stubExtend();
    const fake = new FakeCart([MATTRESS_LINE]);
    const {runtime} = setup(fake);
    const declined = await declineProtection(runtime, fake.snapshot());
    expect(declined.status).toBe('ok');
    expect(fake.attributeValue('offer_declined_protection')).toBe('yes');

    // A second decline finds the step already answered: refused, nothing written.
    const writes = fake.calls.length;
    expect(rejection(await declineProtection(runtime, fake.snapshot()))).toBe(
      'protection-not-offered',
    );
    expect(fake.calls.length).toBe(writes);

    // Changing their mind: accept clears the decline first, then adds.
    await addProtectionToLine(runtime, fake.snapshot(), {
      lineId: LINE,
      planKey: 'PLAN-LO',
    });
    expect(fake.attributeValue('offer_declined_protection')).toBe('no');
    expect(addCalls(fake)).toHaveLength(1);
  });

  it('a forged decline for a cart where nothing is offered (ineligible items) writes nothing', async () => {
    stubExtend();
    const fake = new FakeCart([
      {
        id: 'gid://shopify/CartLine/o',
        variantId: GID.otherVariant,
        productId: GID.other,
      },
    ]);
    const result = await declineProtection(
      setup(fake).runtime,
      fake.snapshot(),
    );
    expect(rejection(result)).toBe('protection-not-offered');
    expect(fake.calls).toEqual([]);
  });

  it('a failed write is a fixed code, never an exception', async () => {
    stubExtend();
    const fake = new FakeCart([MATTRESS_LINE]);
    const {runtime} = setup(fake);
    await revalidateCartOffers(runtime, fake.snapshot());
    fake.failNext = true;
    expect(rejection(await declineProtection(runtime, fake.snapshot()))).toBe(
      'record-failed',
    );
  });
});
