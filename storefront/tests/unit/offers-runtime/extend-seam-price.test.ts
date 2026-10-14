import {describe, expect, it} from 'vitest';
import {fakeStorefront} from '../catalog/fake-storefront';
import {buildPricePointIndex} from '~/lib/extend/price-points';
import type {CoveragePlan} from '~/lib/extend/offers-service';
import {
  extendMakesCartUnverifiable,
  loadExtendCartInputs,
  unitPricesByLineId,
  withUnitPrices,
  type ExtendSeamDeps,
} from '~/lib/offers-runtime/extend-seam';
import {FakeCart, GID, MATTRESS_LINE} from '~/lib/offers-runtime/test-fixtures';
import {toCartLike} from '~/lib/shopify/cart-mapper';

// REQ-EXT-002 / cart-gate review MAJOR 1 and 3: the seam hands the gate the plan prices quoted per eligible line, the
// server's own unit prices, and a verdict on whether the coverage catalog problem must pause checkout.

const ENV = {
  PUBLIC_EXTEND_ENABLED: 'true',
  EXTEND_API_HOST: 'https://api-demo.helloextend.com',
  EXTEND_STORE_ID: 'store-1',
  EXTEND_ACCESS_TOKEN: 'fixture-token-not-real',
};
const plan = (priceCents: number): CoveragePlan => ({
  planId: `P-${priceCents}`,
  title: 'Plan',
  priceCents,
  termMonths: 36,
  termsUrl: 'https://extend.example/terms',
  imageUrl: null,
  recommended: false,
});

function deps(over: Partial<ExtendSeamDeps> = {}): ExtendSeamDeps {
  return {
    loadCatalog: () =>
      Promise.resolve({
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
      }),
    loadCategories: () =>
      Promise.resolve({
        status: 'ok',
        facts: new Map([[GID.mattress, 'mattress']]),
      }),
    quote: (items) =>
      Promise.resolve({
        status: 'ok',
        plansByKey: new Map(
          items.map((i) => [i.key, [plan(7999), plan(9999), plan(7999)]]),
        ),
      }),
    ...over,
  };
}

const runtime = () => ({
  storefront: fakeStorefront(() => ({})).storefront,
  env: ENV,
  production: true,
});

describe('plan prices handed to the gate', () => {
  it('maps each eligible line to the distinct prices Extend quoted for it', async () => {
    const fake = new FakeCart([MATTRESS_LINE]);
    const outcome = await loadExtendCartInputs(
      runtime(),
      fake.snapshot(),
      deps(),
    );
    expect(
      outcome.inputs.coveragePlanPricesByLineId.get(MATTRESS_LINE.id),
    ).toEqual([7999, 9999]);
  });

  it('gives no prices on an outage (the gate then does not judge price)', async () => {
    const fake = new FakeCart([MATTRESS_LINE]);
    const outcome = await loadExtendCartInputs(
      runtime(),
      fake.snapshot(),
      deps({
        quote: () =>
          Promise.resolve({status: 'unavailable', reason: 'timeout'}),
      }),
    );
    expect(outcome.inputs.coveragePlanPricesByLineId.size).toBe(0);
    expect(outcome.inputs.protectionEligibleLineIds).toEqual([]);
  });

  it('reads unit prices from the Shopify cart and writes them onto the mapped lines only', () => {
    const fake = new FakeCart([{...MATTRESS_LINE, priceCents: 123_400}]);
    const cart = fake.snapshot();
    const prices = unitPricesByLineId(cart);
    expect(prices.get(MATTRESS_LINE.id)).toBe(123_400);
    const mapped = withUnitPrices(toCartLike(cart), prices);
    expect(mapped.lines[0]?.unitPriceCents).toBe(123_400);
    expect(toCartLike(cart).lines[0]?.unitPriceCents).toBeUndefined();
  });
});

describe('extendMakesCartUnverifiable (fail closed, O-M2)', () => {
  const outcomeWith = async (
    over: Partial<ExtendSeamDeps>,
    lines: ConstructorParameters<typeof FakeCart>[0],
  ) => {
    const fake = new FakeCart(lines);
    return loadExtendCartInputs(runtime(), fake.snapshot(), deps(over));
  };
  const named = {
    id: 'cov',
    variantId: GID.coverageVariant,
    productId: 'gid://shopify/Product/900',
    size: 'Extend-Protection-Plan-79.99',
    parentId: MATTRESS_LINE.id,
  };

  it('is true when the catalog cannot be read', async () => {
    const outcome = await outcomeWith(
      {
        loadCatalog: () =>
          Promise.resolve({status: 'unavailable', reason: 'read-failed'}),
      },
      [MATTRESS_LINE],
    );
    expect(extendMakesCartUnverifiable(outcome)).toBe(true);
  });

  it('is true for an empty price-point list only while the cart holds coverage', async () => {
    const empty = {
      // What quoteCoverage answers for an empty price-point list.
      quote: () =>
        Promise.resolve({
          status: 'unavailable' as const,
          reason: 'no_price_points' as const,
        }),
      loadCatalog: () =>
        Promise.resolve({
          status: 'ok' as const,
          catalog: {
            coverageVariantIds: new Set<string>(),
            index: buildPricePointIndex([]),
            complete: true,
          },
        }),
    };
    expect(
      extendMakesCartUnverifiable(
        await outcomeWith(empty, [MATTRESS_LINE, named]),
      ),
    ).toBe(true);
    expect(
      extendMakesCartUnverifiable(await outcomeWith(empty, [MATTRESS_LINE])),
    ).toBe(false);
  });

  it('is false for an Extend outage, an incomplete catalog, a healthy cart and a disabled Extend', async () => {
    expect(
      extendMakesCartUnverifiable(
        await outcomeWith(
          {
            quote: () =>
              Promise.resolve({status: 'unavailable', reason: 'http'}),
          },
          [MATTRESS_LINE, named],
        ),
      ),
    ).toBe(false);
    expect(
      extendMakesCartUnverifiable(
        await outcomeWith({}, [MATTRESS_LINE, named]),
      ),
    ).toBe(false);
    const fake = new FakeCart([MATTRESS_LINE]);
    expect(
      extendMakesCartUnverifiable(
        await loadExtendCartInputs(
          {...runtime(), env: {}},
          fake.snapshot(),
          deps(),
        ),
      ),
    ).toBe(false);
  });
});
