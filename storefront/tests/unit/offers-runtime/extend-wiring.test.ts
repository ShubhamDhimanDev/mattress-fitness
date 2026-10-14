import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {fakeStorefront, type RecordedCall} from '../catalog/fake-storefront';
import {resetExtendSharedForTests} from '~/lib/extend/runtime';
import {resetExtendSeamLogsForTests} from '~/lib/offers-runtime/extend-seam';
import {
  revalidateCartOffers,
  swapLineSize,
  type OfferRuntime,
} from '~/lib/offers-runtime/server';
import {
  ENV,
  FakeCart,
  GID,
  MATTRESS_LINE,
  storefrontResponder,
} from '~/lib/offers-runtime/test-fixtures';

// REQ-EXT-002 / REQ-PRE-004 / P5A-06 / security review O-M2, E-M1 and the cart-gate review (MAJOR 1 to 3): the real
// `revalidateCartOffers` runs with the flag ON, a fake Storefront and a fake Extend. If server.ts passed no Extend
// inputs to the gate (the old NO_EXTEND_INPUTS), the removal tests below would fail.

const COVERAGE_HIGH = 'gid://shopify/ProductVariant/62';
const EXTEND_ENV = {
  ...ENV,
  PUBLIC_EXTEND_ENABLED: 'true',
  EXTEND_API_HOST: 'https://api-demo.helloextend.com',
  EXTEND_STORE_ID: 'store-1',
  EXTEND_ACCESS_TOKEN: 'fixture-token-not-real',
};

const KING_LINE = {
  id: 'gid://shopify/CartLine/king',
  variantId: GID.mattressKing,
  productId: GID.mattress,
  size: 'King',
  priceCents: 150_000,
};
const cover = (
  id: string,
  parentId: string | null,
  priceCents = 7999,
  variantId: string = GID.coverageVariant,
) => ({
  id,
  variantId,
  productId: 'gid://shopify/Product/900',
  priceCents,
  ...(parentId ? {parentId} : {}),
});

type World = {
  catalog: 'ok' | 'fail' | 'empty';
  categories: boolean;
};

function catalogAnswer(world: World): unknown {
  if (world.catalog === 'fail') throw new Error('storefront down');
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
          id: 'gid://shopify/Product/900',
          title: 'Extend Protection Plan',
          variants: {
            pageInfo: {hasNextPage: false},
            nodes:
              world.catalog === 'empty'
                ? []
                : [
                    variant(
                      GID.coverageVariant,
                      'Extend-Protection-Plan-79.99',
                      '79.99',
                    ),
                    variant(
                      COVERAGE_HIGH,
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

function setup(
  cart: FakeCart,
  world: World = {catalog: 'ok', categories: true},
  env: object = EXTEND_ENV,
) {
  const base = storefrontResponder();
  const {storefront, calls} = fakeStorefront((call: RecordedCall) => {
    if (call.query.includes('query ExtendCoverageVariants'))
      return catalogAnswer(world);
    if (call.query.includes('query ExtendProductCategories')) {
      const ids = Array.isArray(call.variables.ids) ? call.variables.ids : [];
      return {
        nodes: ids.map((id) => ({
          id,
          metafield:
            world.categories && id === GID.mattress
              ? {value: 'mattress'}
              : null,
        })),
      };
    }
    return base(call);
  });
  const runtime: OfferRuntime = {storefront, cart, env, production: true};
  return {runtime, calls};
}

/** Extend quotes 79.99 up to a 1,499.99 item and 99.99 above it. */
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
                  title: 'Plan',
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

/** The fake cart keeps a line's price when its variant changes; a real swap changes it. */
class PricedCart extends FakeCart {
  override updateLines(
    lines: Array<{id: string; quantity: number; merchandiseId?: string}>,
  ) {
    const result = super.updateLines(lines);
    const specs: unknown = Reflect.get(this, 'specs');
    if (Array.isArray(specs)) {
      for (const update of lines) {
        const spec: unknown = specs.find(
          (candidate: unknown) =>
            typeof candidate === 'object' &&
            candidate !== null &&
            Reflect.get(candidate, 'id') === update.id,
        );
        if (
          typeof spec === 'object' &&
          spec !== null &&
          update.merchandiseId === GID.mattressKing
        ) {
          Reflect.set(spec, 'priceCents', 150_000);
        }
      }
    }
    return result;
  }
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

const idsAfter = (cart: FakeCart) => cart.lineIds().sort();

describe('the gate recognises and corrects coverage with the flag on (MAJOR 3a)', () => {
  it('leaves coverage whose price is a quoted plan for its parent', async () => {
    stubExtend();
    const fake = new FakeCart([MATTRESS_LINE, cover('cov', MATTRESS_LINE.id)]);
    const {runtime} = setup(fake);
    const result = await revalidateCartOffers(runtime, fake.snapshot());
    expect(result.check?.status).toBe('ok');
    expect(fake.calls).toEqual([]);
    expect(result.extend).toEqual({status: 'ok', degraded: []});
  });

  it('removes coverage bought ALONE', async () => {
    stubExtend();
    const fake = new FakeCart([MATTRESS_LINE, cover('cov', null)]);
    const result = await revalidateCartOffers(
      setup(fake).runtime,
      fake.snapshot(),
    );
    expect(result.check?.status).toBe('corrected');
    expect(fake.lineIds()).toEqual([MATTRESS_LINE.id]);
  });

  it('removes coverage nested under a free gift', async () => {
    stubExtend();
    const gift = {
      id: 'gid://shopify/CartLine/gift',
      variantId: GID.gift,
      productId: GID.giftPillow,
    };
    const fake = new FakeCart([MATTRESS_LINE, gift, cover('cov', gift.id)]);
    await revalidateCartOffers(setup(fake).runtime, fake.snapshot());
    expect(idsAfter(fake)).toEqual([gift.id, MATTRESS_LINE.id].sort());
  });

  it('removes coverage priced for another item (permalink with a mismatched plan) and says why', async () => {
    stubExtend();
    const fake = new FakeCart([
      MATTRESS_LINE,
      cover('cov', MATTRESS_LINE.id, 2999),
    ]);
    const result = await revalidateCartOffers(
      setup(fake).runtime,
      fake.snapshot(),
    );
    expect(fake.lineIds()).toEqual([MATTRESS_LINE.id]);
    expect(result.view?.notices.join(' ')).toMatch(/price no longer matches/i);
    // Idempotent: a second pass finds nothing to do.
    const before = fake.calls.length;
    await revalidateCartOffers(setup(fake).runtime, fake.snapshot());
    expect(fake.calls.length).toBe(before);
  });

  it('after a size swap from a low to a high size the old coverage is removed, not carried over', async () => {
    stubExtend();
    const fake = new PricedCart([
      MATTRESS_LINE,
      cover('cov', MATTRESS_LINE.id, 7999),
    ]);
    const {runtime} = setup(fake);
    const swapped = await swapLineSize(runtime, fake.snapshot(), {
      lineId: MATTRESS_LINE.id,
      merchandiseId: GID.mattressKing,
    });
    expect(swapped.status).toBe('ok');
    const result = await revalidateCartOffers(runtime, await fake.get());
    expect(fake.lineIds()).toEqual([MATTRESS_LINE.id]);
    expect(result.view?.notices.join(' ')).toMatch(/price no longer matches/i);
  });

  it('keeps coverage on BOTH lines of one product at different prices (Twin XL and Queen case)', async () => {
    const fetchMock = stubExtend();
    const fake = new FakeCart([
      MATTRESS_LINE,
      KING_LINE,
      cover('cov-q', MATTRESS_LINE.id, 7999),
      cover('cov-k', KING_LINE.id, 9999, COVERAGE_HIGH),
    ]);
    const result = await revalidateCartOffers(
      setup(fake).runtime,
      fake.snapshot(),
    );
    expect(result.check?.status).toBe('ok');
    expect(fake.calls).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('Extend down: coverage on a regular item is kept, the check is marked degraded, and nothing blocks', async () => {
    stubExtend(503);
    const fake = new FakeCart([
      MATTRESS_LINE,
      cover('cov', MATTRESS_LINE.id, 2999),
    ]);
    const result = await revalidateCartOffers(
      setup(fake).runtime,
      fake.snapshot(),
    );
    expect(fake.lineIds()).toContain('cov');
    expect(result.extend).toEqual({
      status: 'degraded',
      degraded: ['offers-unavailable'],
    });
    expect(result.check?.blocked).toEqual([]);
  });
});

describe('the coverage catalog is required when Extend is on (MAJOR 3b, fail closed)', () => {
  it('pauses checkout with the existing unverified message when the catalog cannot be read', async () => {
    stubExtend();
    const fake = new FakeCart([MATTRESS_LINE, cover('cov', null)]);
    const result = await revalidateCartOffers(
      setup(fake, {catalog: 'fail', categories: true}).runtime,
      fake.snapshot(),
    );
    expect(result.check).toBeNull();
    expect(result.view?.blocked[0]?.code).toBe('unverified');
    expect(result.extend?.degraded).toContain('catalog-unavailable');
    // Nothing was repaired or removed on an unverified read.
    expect(fake.calls).toEqual([]);
  });

  it('with no price point at all, a cart that holds coverage is unverified, a cart without coverage is not', async () => {
    stubExtend();
    const named = {
      ...cover('cov', MATTRESS_LINE.id),
      size: 'Extend-Protection-Plan-79.99',
    };
    const withCoverage = new FakeCart([MATTRESS_LINE, named]);
    const blocked = await revalidateCartOffers(
      setup(withCoverage, {catalog: 'empty', categories: true}).runtime,
      withCoverage.snapshot(),
    );
    expect(blocked.check).toBeNull();
    expect(blocked.view?.blocked[0]?.code).toBe('unverified');
    expect(blocked.extend?.degraded).toContain('no-price-points');

    const plain = new FakeCart([MATTRESS_LINE]);
    const fine = await revalidateCartOffers(
      setup(plain, {catalog: 'empty', categories: true}).runtime,
      plain.snapshot(),
    );
    expect(fine.check).not.toBeNull();
    expect(fine.view?.blocked).toEqual([]);
  });
});

describe('coverage is recognised even when Extend is off or misconfigured (E-M1)', () => {
  const off = {...EXTEND_ENV, PUBLIC_EXTEND_ENABLED: 'false'};

  it('removes coverage by name when it is alone or under a gift, with no Extend or catalog call', async () => {
    const fetchMock = stubExtend();
    const named = (id: string, parent: string | null) => ({
      ...cover(id, parent),
      size: 'Extend-Protection-Plan-79.99',
    });
    const gift = {
      id: 'gid://shopify/CartLine/gift',
      variantId: GID.gift,
      productId: GID.giftPillow,
    };
    const fake = new FakeCart([
      MATTRESS_LINE,
      gift,
      named('alone', null),
      named('under-gift', gift.id),
    ]);
    const {runtime, calls} = setup(fake, undefined, off);
    await revalidateCartOffers(runtime, fake.snapshot());
    expect(idsAfter(fake)).toEqual([gift.id, MATTRESS_LINE.id].sort());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(calls.some((c) => c.query.includes('query Extend'))).toBe(false);
  });

  it('REMOVES coverage on an ordinary parent when Extend is off or misconfigured (explicit extendOff, Major B), says why, and logs the misconfiguration once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const named = {
      ...cover('cov', MATTRESS_LINE.id),
      size: 'Extend-Protection-Plan-79.99',
    };
    const broken = {...EXTEND_ENV, EXTEND_ACCESS_TOKEN: undefined};
    for (let i = 0; i < 3; i += 1) {
      const fake = new FakeCart([MATTRESS_LINE, named]);
      const result = await revalidateCartOffers(
        setup(fake, undefined, broken).runtime,
        fake.snapshot(),
      );
      expect(fake.lineIds()).toEqual([MATTRESS_LINE.id]);
      expect(result.view?.notices.join(' ')).toMatch(
        /protection plan was removed/i,
      );
    }
    const lines = warn.mock.calls.filter((call) =>
      String(call[0]).includes('config:missing_credentials'),
    );
    expect(lines).toHaveLength(1);
  });
});

describe('flag off removes every coverage line, flag ON with Extend down keeps it (review of d068db6, Major B)', () => {
  const named = {
    ...cover('cov', MATTRESS_LINE.id),
    size: 'Extend-Protection-Plan-79.99',
  };

  it('PUBLIC_EXTEND_ENABLED=false: coverage on an ordinary parent is removed with a notice and no Extend call', async () => {
    const fetchMock = stubExtend();
    const fake = new FakeCart([MATTRESS_LINE, named]);
    const off = {...EXTEND_ENV, PUBLIC_EXTEND_ENABLED: 'false'};
    const result = await revalidateCartOffers(
      setup(fake, undefined, off).runtime,
      fake.snapshot(),
    );
    expect(fake.lineIds()).toEqual([MATTRESS_LINE.id]);
    expect(result.view?.notices.length).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
    // Idempotent: the second pass finds nothing left to remove.
    const before = fake.calls.length;
    await revalidateCartOffers(
      setup(fake, undefined, off).runtime,
      fake.snapshot(),
    );
    expect(fake.calls.length).toBe(before);
  });

  it('flag ON, Extend down: coverage is kept (genuine outage rule)', async () => {
    stubExtend(503);
    const fake = new FakeCart([MATTRESS_LINE, cover('cov', MATTRESS_LINE.id)]);
    await revalidateCartOffers(setup(fake).runtime, fake.snapshot());
    expect(fake.lineIds()).toContain('cov');
  });
});

describe('a cart with many sizes of one product is judged, not waved through (review of d068db6, Major A)', () => {
  const sizeLine = (n: number, parentOf?: string) => ({
    id: `gid://shopify/CartLine/size${n}`,
    variantId: GID.mattressQueen,
    productId: GID.mattress,
    size: 'Queen',
    priceCents: 100_000 + n * 1_000,
    ...(parentOf ? {parentId: parentOf} : {}),
  });

  it('four sizes: a $29.99 price-point SKU under any of them is removed, the quoted $79.99 plan stays', async () => {
    stubExtend();
    const lines = [1, 2, 3, 4].map((n) => sizeLine(n));
    const fake = new FakeCart([
      ...lines,
      cover('good', lines[0]?.id ?? null, 7999),
      cover('cheap', lines[3]?.id ?? null, 2999),
    ]);
    const result = await revalidateCartOffers(
      setup(fake).runtime,
      fake.snapshot(),
    );
    expect(fake.lineIds()).toContain('good');
    expect(fake.lineIds()).not.toContain('cheap');
    expect(result.view?.notices.join(' ')).toMatch(/price no longer matches/i);
  });

  it('more sizes than one quote can ask about: coverage on the unasked lines is removed with a notice, not kept unchecked', async () => {
    const fetchMock = stubExtend();
    const lines = Array.from({length: 10}, (_, n) => sizeLine(n + 1));
    const fake = new FakeCart([
      ...lines,
      cover('first', lines[0]?.id ?? null, 7999),
      cover('last', lines[9]?.id ?? null, 7999),
    ]);
    const result = await revalidateCartOffers(
      setup(fake).runtime,
      fake.snapshot(),
    );
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(8);
    expect(fake.lineIds()).toContain('first');
    expect(fake.lineIds()).not.toContain('last');
    expect(result.extend?.degraded).toContain('lines-unjudged');
    expect(result.view?.notices.join(' ')).toMatch(/price no longer matches/i);
    // The unchecked line gets no offer either.
    expect(
      result.view?.accidentProtection?.lines.map((l) => l.lineId),
    ).not.toContain(lines[9]?.id);
  });
});
