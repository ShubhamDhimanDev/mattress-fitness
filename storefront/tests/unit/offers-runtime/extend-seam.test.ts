import {describe, expect, it, vi} from 'vitest';
import type {CartApiQueryFragment} from 'storefrontapi.generated';
import {fakeStorefront} from '../catalog/fake-storefront';
import {buildPricePointIndex} from '~/lib/extend/price-points';
import type {CoverageCatalogResult} from '~/lib/extend/coverage-catalog';
import type {CoverageQuote} from '~/lib/extend/offers-service';
import {parseOfferConfig} from '~/lib/offers-runtime/config';
import {buildOfferContext} from '~/lib/offers-runtime/context';
import {
  NOTHING_ELIGIBLE,
  NO_EXTEND_INPUTS,
  applyServerRoles,
  loadExtendCartInputs,
  type ExtendCartInputs,
  type ExtendSeamDeps,
  type ExtendSeamRuntime,
} from '~/lib/offers-runtime/extend-seam';
import {
  revalidateCart,
  type CartPort,
  type MutationOutcome,
} from '~/lib/offers-runtime/revalidate';
import {
  CONFIG,
  FakeCart,
  GID,
  MATTRESS_LINE,
} from '~/lib/offers-runtime/test-fixtures';

// REQ-EXT-002 / REQ-PRE-004 / P5A-06 / security review O-M2 / T-06: the cart gate recognises Extend coverage from the SERVER'S
// variant list and corrects coverage that is alone, under the wrong parent, over quantity or under an item that cannot be
// covered. These tests drive the real seam into the real revalidation loop, the way offers-runtime/server.ts will.

const RULES = parseOfferConfig(CONFIG).config;
const ENABLED_ENV = {
  PUBLIC_EXTEND_ENABLED: 'true',
  EXTEND_API_HOST: 'http://127.0.0.1:4010',
  EXTEND_STORE_ID: 'store-1',
  EXTEND_ACCESS_TOKEN: 'fixture-token-not-real',
};

const COVERAGE_LINE = {
  id: 'gid://shopify/CartLine/cover',
  variantId: GID.coverageVariant,
  productId: 'gid://shopify/Product/900',
  priceCents: 7999,
};
const OTHER_LINE = {
  id: 'gid://shopify/CartLine/other',
  variantId: GID.otherVariant,
  productId: GID.other,
};
const GIFT_LINE = {
  id: 'gid://shopify/CartLine/gift',
  variantId: GID.gift,
  productId: GID.giftPillow,
};

function runtime(env: object = ENABLED_ENV): ExtendSeamRuntime {
  const {storefront} = fakeStorefront(() => ({}));
  return {storefront, env, production: false};
}

const catalogOk: CoverageCatalogResult = {
  status: 'ok',
  catalog: {
    coverageVariantIds: new Set([GID.coverageVariant]),
    index: buildPricePointIndex([
      {
        variantId: GID.coverageVariant,
        name: 'Extend-Protection-Plan-79.99',
        priceCents: 7999,
      },
    ]),
    complete: true,
  },
};

function deps(overrides: Partial<ExtendSeamDeps> = {}): ExtendSeamDeps {
  return {
    loadCatalog: () => Promise.resolve(catalogOk),
    loadCategories: () =>
      Promise.resolve({
        status: 'ok',
        facts: new Map([[GID.mattress, 'mattress']]),
      }),
    // Extend quotes a plan for every line whose product has a category.
    quote: (items) =>
      Promise.resolve({
        status: 'ok',
        plansByKey: new Map(
          items
            .filter((item) => item.category !== null)
            .map((item) => [
              item.key,
              [
                {
                  planId: 'PLAN-1',
                  title: 'Plan',
                  priceCents: 7999,
                  termMonths: 36,
                  termsUrl: 'https://extend.example/terms',
                  imageUrl: null,
                  recommended: true,
                },
              ],
            ]),
        ),
      } satisfies CoverageQuote),
    ...overrides,
  };
}

/** The same loop offers-runtime/server.ts runs, with the seam's answers. */
async function gate(fake: FakeCart, inputs: ExtendCartInputs) {
  const after = async (
    result: Awaited<ReturnType<FakeCart['removeLines']>>,
  ): Promise<MutationOutcome<CartApiQueryFragment>> =>
    result.userErrors?.length
      ? {cart: null, failed: true}
      : {cart: await fake.get(), failed: false};
  const port: CartPort<CartApiQueryFragment> = {
    removeLines: async (ids) => after(await fake.removeLines(ids)),
    updateLines: async (lines) => after(await fake.updateLines(lines)),
    refresh: () => fake.get(),
  };
  return revalidateCart(fake.snapshot(), port, {
    rules: RULES.rules,
    prepare: (mapped) => Promise.resolve(applyServerRoles(mapped, inputs)),
    contextFor: (mapped) =>
      buildOfferContext(mapped, {
        zip: null,
        zone: null,
        protectionEligibleLineIds: inputs.protectionEligibleLineIds,
      }),
  });
}

async function inputsFor(
  fake: FakeCart,
  seamDeps: ExtendSeamDeps = deps(),
  env: object = ENABLED_ENV,
) {
  return loadExtendCartInputs(runtime(env), fake.snapshot(), seamDeps);
}

describe('REQ-EXT-002 the gate corrects coverage through the real seam', () => {
  it('leaves coverage on a coverable item exactly as it is', async () => {
    const fake = new FakeCart([
      MATTRESS_LINE,
      {...COVERAGE_LINE, parentId: MATTRESS_LINE.id},
    ]);
    const outcome = await inputsFor(fake);
    expect(outcome.status).toBe('ok');
    expect(outcome.inputs.protectionEligibleLineIds).toEqual([
      MATTRESS_LINE.id,
    ]);
    const result = await gate(fake, outcome.inputs);
    expect(result.status).toBe('ok');
    expect(fake.calls).toEqual([]);
  });

  it('removes coverage bought ALONE (no parent)', async () => {
    const fake = new FakeCart([MATTRESS_LINE, COVERAGE_LINE]);
    const outcome = await inputsFor(fake);
    const result = await gate(fake, outcome.inputs);
    expect(result.status).toBe('corrected');
    expect(fake.lineIds()).toEqual([MATTRESS_LINE.id]);
  });

  it('removes coverage under the WRONG parent: a free gift, a missing line, or an item Extend cannot cover', async () => {
    const fake = new FakeCart([
      MATTRESS_LINE,
      GIFT_LINE,
      OTHER_LINE,
      {...COVERAGE_LINE, id: 'c-gift', parentId: GIFT_LINE.id},
      {
        ...COVERAGE_LINE,
        id: 'c-ghost',
        parentId: 'gid://shopify/CartLine/ghost',
      },
      {...COVERAGE_LINE, id: 'c-other', parentId: OTHER_LINE.id},
    ]);
    const outcome = await inputsFor(fake);
    const result = await gate(fake, outcome.inputs);
    expect(result.status).toBe('corrected');
    expect(fake.lineIds().sort()).toEqual(
      [GIFT_LINE.id, MATTRESS_LINE.id, OTHER_LINE.id].sort(),
    );
  });

  it('lowers coverage that exceeds the quantity of the item it covers', async () => {
    const fake = new FakeCart([
      MATTRESS_LINE,
      {...COVERAGE_LINE, quantity: 3, parentId: MATTRESS_LINE.id},
    ]);
    const outcome = await inputsFor(fake);
    await gate(fake, outcome.inputs);
    expect(fake.quantityOf(COVERAGE_LINE.id)).toBe(1);
  });

  it('when Extend answers that nothing in the cart can be covered, coverage on a plain item is removed', async () => {
    const fake = new FakeCart([
      OTHER_LINE,
      {...COVERAGE_LINE, parentId: OTHER_LINE.id},
    ]);
    const outcome = await inputsFor(
      fake,
      deps({
        loadCategories: () => Promise.resolve({status: 'ok', facts: new Map()}),
      }),
    );
    expect(outcome.inputs.protectionEligibleLineIds).toEqual(NOTHING_ELIGIBLE);
    await gate(fake, outcome.inputs);
    expect(fake.lineIds()).toEqual([OTHER_LINE.id]);
  });

  it('a healthy Extend that quotes nothing for a categorised item behaves the same way', async () => {
    const fake = new FakeCart([
      MATTRESS_LINE,
      {...COVERAGE_LINE, parentId: MATTRESS_LINE.id},
    ]);
    const outcome = await inputsFor(
      fake,
      deps({
        quote: () => Promise.resolve({status: 'ok', plansByKey: new Map()}),
      }),
    );
    await gate(fake, outcome.inputs);
    expect(fake.lineIds()).toEqual([MATTRESS_LINE.id]);
  });

  it('during an Extend outage coverage on a regular item is KEPT, but coverage alone or on a gift is still removed (NFR-013)', async () => {
    const fake = new FakeCart([
      MATTRESS_LINE,
      GIFT_LINE,
      {...COVERAGE_LINE, id: 'c-ok', parentId: MATTRESS_LINE.id},
      {...COVERAGE_LINE, id: 'c-alone'},
      {...COVERAGE_LINE, id: 'c-gift', parentId: GIFT_LINE.id},
    ]);
    const outcome = await inputsFor(
      fake,
      deps({
        quote: () =>
          Promise.resolve({status: 'unavailable', reason: 'timeout'}),
      }),
    );
    expect(outcome.status).toBe('degraded');
    expect(outcome.inputs.protectionEligibleLineIds).toEqual([]);
    await gate(fake, outcome.inputs);
    expect(fake.lineIds().sort()).toEqual(
      [GIFT_LINE.id, 'c-ok', MATTRESS_LINE.id].sort(),
    );
  });

  it('still recognises coverage by its Shopify-supplied name when the catalog read fails', async () => {
    const named = {
      ...COVERAGE_LINE,
      size: 'Extend-Protection-Plan-79.99',
    };
    const fake = new FakeCart([MATTRESS_LINE, named]);
    const outcome = await inputsFor(
      fake,
      deps({
        loadCatalog: () =>
          Promise.resolve({status: 'unavailable', reason: 'read-failed'}),
      }),
    );
    expect(outcome.status).toBe('degraded');
    expect(outcome.inputs.coverageVariantIds.has(GID.coverageVariant)).toBe(
      true,
    );
    await gate(fake, outcome.inputs);
    expect(fake.lineIds()).toEqual([MATTRESS_LINE.id]);
  });

  it('a category read failure degrades to the outage rule, not to a block', async () => {
    const fake = new FakeCart([
      MATTRESS_LINE,
      {...COVERAGE_LINE, parentId: MATTRESS_LINE.id},
    ]);
    const outcome = await inputsFor(
      fake,
      deps({loadCategories: () => Promise.resolve({status: 'unavailable'})}),
    );
    expect(outcome).toMatchObject({
      status: 'degraded',
      degraded: ['categories-unavailable'],
    });
    await gate(fake, outcome.inputs);
    expect(fake.lineIds()).toContain(COVERAGE_LINE.id);
  });
});

describe('Extend off: safe defaults and no network (NFR-013)', () => {
  it.each([
    ['the flag is unset', {...ENABLED_ENV, PUBLIC_EXTEND_ENABLED: undefined}],
    [
      'the flag is not exactly "true"',
      {...ENABLED_ENV, PUBLIC_EXTEND_ENABLED: 'TRUE'},
    ],
    ['credentials are missing', {PUBLIC_EXTEND_ENABLED: 'true'}],
    ['the env is empty', {}],
  ])(
    'when %s the seam returns the defaults without touching anything',
    async (_name, env) => {
      const fake = new FakeCart([MATTRESS_LINE, COVERAGE_LINE]);
      const spy = deps({
        loadCatalog: vi.fn(() => Promise.resolve(catalogOk)),
        loadCategories: vi.fn(() =>
          Promise.resolve({status: 'unavailable'} as const),
        ),
        quote: vi.fn(() =>
          Promise.resolve({status: 'unavailable', reason: 'disabled'} as const),
        ),
      });
      const outcome = await loadExtendCartInputs(
        runtime(env),
        fake.snapshot(),
        spy,
      );
      // Recognition by name needs no network; there are no eligible lines while Extend is off (E-M1).
      expect(outcome).toMatchObject({
        status: 'disabled',
        // The explicit extendOff mode (review of d068db6, Major B): nothing can be covered, so the gate removes it all.
        inputs: {protectionEligibleLineIds: NOTHING_ELIGIBLE},
      });
      expect(outcome.inputs.coveragePlanPricesByLineId.size).toBe(0);
      expect(spy.loadCatalog).not.toHaveBeenCalled();
      expect(spy.loadCategories).not.toHaveBeenCalled();
      expect(spy.quote).not.toHaveBeenCalled();
    },
  );

  it('documents the limit: with the seam off, a coverage line is an ordinary line to the gate', async () => {
    const fake = new FakeCart([MATTRESS_LINE, COVERAGE_LINE]);
    const result = await gate(fake, NO_EXTEND_INPUTS);
    expect(result.status).toBe('ok');
    expect(fake.lineIds()).toContain(COVERAGE_LINE.id);
  });
});

describe('the seam never trusts the cart for roles or prices', () => {
  it('ignores a coverage role or Extend attributes that arrive on an ordinary line', async () => {
    const forged = {
      ...OTHER_LINE,
      attributes: [
        {key: 'role', value: 'coverage'},
        {key: '_extend_plan_id', value: 'PLAN-1'},
      ],
    };
    const fake = new FakeCart([forged]);
    const outcome = await inputsFor(fake);
    expect(outcome.inputs.coverageVariantIds.has(GID.otherVariant)).toBe(false);
  });

  it('asks about products and prices read from Shopify, one entry per candidate line', async () => {
    const fake = new FakeCart([
      MATTRESS_LINE,
      {...COVERAGE_LINE, parentId: MATTRESS_LINE.id},
    ]);
    const quote = vi.fn(deps().quote);
    await inputsFor(fake, deps({quote}));
    const [items] = quote.mock.calls[0] ?? [];
    expect(items).toEqual([
      {
        key: MATTRESS_LINE.id,
        productId: GID.mattress,
        category: 'mattress',
        unitPriceCents: 100000,
        quantity: 1,
      },
    ]);
  });
});
