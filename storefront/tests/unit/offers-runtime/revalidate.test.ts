import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {CartApiQueryFragment} from 'storefrontapi.generated';
import {fakeStorefront} from '../catalog/fake-storefront';
import {decideCheckout} from '~/lib/cart/checkout';
import {withCoverageRoles} from '~/lib/offers/roles';
import type {CartLike} from '~/lib/offers/types';
import {parseOfferConfig} from '~/lib/offers-runtime/config';
import {buildOfferContext} from '~/lib/offers-runtime/context';
import {
  revalidateCart,
  type CartPort,
  type MutationOutcome,
} from '~/lib/offers-runtime/revalidate';
import {
  resetOfferConfigLogsForTests,
  revalidateCartOffers,
  type OfferRuntime,
} from '~/lib/offers-runtime/server';
import {
  CONFIG,
  ENV,
  FakeCart,
  GID,
  MATTRESS_LINE,
  cartOf,
  storefrontResponder,
} from '~/lib/offers-runtime/test-fixtures';

// REQ-PRE-006 / P4-11: the server revalidates the real cart with the one offer engine before checkout.
// Tampered carts are corrected or refused, never trusted; browser-supplied attributes and roles are ignored.

const CHOICE_IN_HOME = {key: 'delivery_choice', value: 'in-home'};
const OTHER_LINE = {
  id: 'gid://shopify/CartLine/o',
  variantId: GID.otherVariant,
  productId: GID.other,
};
const GIFT_LINE = {
  id: 'gid://shopify/CartLine/gift',
  variantId: GID.gift,
  productId: GID.giftPillow,
};
const HAUL_LINE = {
  id: 'gid://shopify/CartLine/haul',
  variantId: GID.haulVariant,
  productId: GID.haul,
};
const PROTECTOR_LINE = {
  id: 'gid://shopify/CartLine/prot',
  variantId: GID.protectorQueen,
  productId: GID.protector,
  size: 'Queen',
};

function runtime(fake: FakeCart): OfferRuntime {
  const {storefront} = fakeStorefront(storefrontResponder());
  return {storefront, cart: fake, env: ENV, production: true};
}

async function run(fake: FakeCart) {
  return revalidateCartOffers(runtime(fake), fake.snapshot());
}

const RULES = parseOfferConfig(CONFIG).config;

describe('REQ-PRE-006 revalidation of a Shopify cart (tamper cases)', () => {
  it('gift without a qualifier is removed (orphan gift)', async () => {
    const fake = new FakeCart([{...GIFT_LINE}, OTHER_LINE]);
    const result = await run(fake);
    expect(fake.lineIds()).toEqual([OTHER_LINE.id]);
    expect(result.check?.status).toBe('corrected');
    expect(result.view?.notices.join(' ')).toMatch(/free gift was removed/i);
  });

  it('keeps a gift while its qualifying mattress is present, and lowers extra units to the allowance', async () => {
    const fake = new FakeCart([MATTRESS_LINE, {...GIFT_LINE, quantity: 3}]);
    await run(fake);
    expect(fake.quantityOf(GIFT_LINE.id)).toBe(1);
  });

  it('ignores a forged role attribute: it neither creates a gift nor protects one', async () => {
    const fake = new FakeCart([
      {
        ...OTHER_LINE,
        attributes: [
          {key: '_role', value: 'gift'},
          {key: 'role', value: 'coverage'},
          {key: '_extend_covered_line', value: 'x'},
        ],
      },
      // A real gift variant claiming to be an ordinary line is still a gift.
      {...GIFT_LINE, attributes: [{key: '_role', value: 'regular'}]},
    ]);
    await run(fake);
    expect(fake.lineIds()).toEqual([OTHER_LINE.id]);
  });

  it('a coverage role that arrives with the cart is cleared: only the server variant list decides', () => {
    const forged: CartLike = {
      lines: [
        {
          id: 'l1',
          variantId: GID.otherVariant,
          productId: GID.other,
          quantity: 1,
          attributes: {},
          size: null,
          parentLineId: null,
          role: 'coverage',
        },
      ],
      subtotalCents: 0,
    };
    expect(withCoverageRoles(forged, new Set()).lines[0].role).toBeNull();
  });

  it('a forged parent: coverage nested under a gift, or under a line that does not exist, is removed', async () => {
    const cart = cartOf([
      MATTRESS_LINE,
      {...GIFT_LINE},
      {
        id: 'gid://shopify/CartLine/cov1',
        variantId: GID.coverageVariant,
        productId: GID.other,
        parentId: GIFT_LINE.id,
      },
      {
        id: 'gid://shopify/CartLine/cov2',
        variantId: GID.coverageVariant,
        productId: GID.other,
        parentId: 'gid://shopify/CartLine/missing',
      },
    ]);
    const removed: string[] = [];
    const port: CartPort<CartApiQueryFragment> = {
      removeLines: (ids) => {
        removed.push(...ids);
        return Promise.resolve({
          cart: cartOf([MATTRESS_LINE, GIFT_LINE]),
          failed: false,
        });
      },
      updateLines: () => Promise.resolve({cart: null, failed: false}),
      refresh: () => Promise.resolve(null),
    };
    const result = await revalidateCart(cart, port, {
      rules: RULES.rules,
      // The server's own list of coverage variants (what the Extend seam provides once connected).
      prepare: (c) =>
        Promise.resolve(withCoverageRoles(c, new Set([GID.coverageVariant]))),
      contextFor: (c) =>
        buildOfferContext(c, {
          zip: null,
          zone: null,
          protectionEligibleLineIds: [],
        }),
    });
    expect(removed.sort()).toEqual([
      'gid://shopify/CartLine/cov1',
      'gid://shopify/CartLine/cov2',
    ]);
    expect(result.status).toBe('corrected');
  });

  it('haul-away lines are refused (not repaired) when delivery is not in-home inside the zone', async () => {
    const fake = new FakeCart([MATTRESS_LINE, {...HAUL_LINE, quantity: 1}]);
    const result = await run(fake);
    expect(result.check?.status).toBe('blocked');
    expect(result.check?.blocked[0]?.code).toBe('haul-away-not-eligible');
    expect(fake.calls).toEqual([]);
    expect(result.view?.blocked.length).toBeGreaterThan(0);
  });

  it('haul-away over the maximum is lowered when the shopper is eligible', async () => {
    const cart = cartOf([MATTRESS_LINE, {...HAUL_LINE, quantity: 5}], {
      attributes: [CHOICE_IN_HOME],
    });
    const updates: unknown[] = [];
    const port: CartPort<CartApiQueryFragment> = {
      removeLines: () => Promise.resolve({cart: null, failed: false}),
      updateLines: (lines) => {
        updates.push(...lines);
        return Promise.resolve({
          cart: cartOf([MATTRESS_LINE, {...HAUL_LINE, quantity: 2}], {
            attributes: [CHOICE_IN_HOME],
          }),
          failed: false,
        });
      },
      refresh: () => Promise.resolve(null),
    };
    const result = await revalidateCart(cart, port, {
      rules: RULES.rules,
      prepare: (c) => Promise.resolve(c),
      contextFor: (c) =>
        buildOfferContext(c, {
          zip: '60645',
          zone: RULES.zone,
          protectionEligibleLineIds: [],
        }),
    });
    expect(updates).toEqual([{id: HAUL_LINE.id, quantity: 2}]);
    expect(result.status).toBe('corrected');
    expect(result.blocked).toEqual([]);
  });

  it('a protector without its mattress, and one in the wrong size, are removed', async () => {
    const orphan = new FakeCart([OTHER_LINE, {...PROTECTOR_LINE}]);
    await run(orphan);
    expect(orphan.lineIds()).toEqual([OTHER_LINE.id]);

    const wrong = new FakeCart([
      {...MATTRESS_LINE, variantId: GID.mattressKing, size: 'King'},
      {...PROTECTOR_LINE},
    ]);
    await run(wrong);
    expect(wrong.lineIds()).toEqual([MATTRESS_LINE.id]);
  });

  it('is idempotent: a second run on the repaired cart changes nothing', async () => {
    const fake = new FakeCart([
      OTHER_LINE,
      {...GIFT_LINE},
      {...PROTECTOR_LINE},
    ]);
    await run(fake);
    const callsAfterFirst = fake.calls.length;
    const second = await run(fake);
    expect(fake.calls).toHaveLength(callsAfterFirst);
    expect(second.check?.status).toBe('ok');
  });

  it('does not touch a clean cart', async () => {
    const fake = new FakeCart([MATTRESS_LINE, {...GIFT_LINE}]);
    const result = await run(fake);
    expect(fake.calls).toEqual([]);
    expect(result.check?.status).toBe('ok');
  });

  it('recovers when Shopify rejects a repair: reads the cart again and retries', async () => {
    const fake = new FakeCart([{...GIFT_LINE}]);
    fake.failNext = true;
    const result = await run(fake);
    expect(fake.lineIds()).toEqual([]);
    expect(result.check?.status).not.toBe('blocked');
  });

  it('a repair that never takes effect leaves the cart blocked, not handed off', async () => {
    const stuck = cartOf([{...GIFT_LINE}]);
    const port: CartPort<CartApiQueryFragment> = {
      removeLines: (): Promise<MutationOutcome<CartApiQueryFragment>> =>
        Promise.resolve({cart: stuck, failed: false}),
      updateLines: () => Promise.resolve({cart: stuck, failed: false}),
      refresh: () => Promise.resolve(stuck),
    };
    const result = await revalidateCart(stuck, port, {
      rules: RULES.rules,
      prepare: (c) => Promise.resolve(c),
      contextFor: (c) =>
        buildOfferContext(c, {
          zip: null,
          zone: null,
          protectionEligibleLineIds: [],
        }),
      maxPasses: 2,
    });
    expect(result.status).toBe('blocked');
    expect(result.blocked[0]?.code).toBe('unverified');
  });

  it('a line with a quantity the engine cannot trust blocks the hand-off', async () => {
    const fake = new FakeCart([{...MATTRESS_LINE, quantity: 0}]);
    const result = await run(fake);
    expect(result.check?.status).toBe('blocked');
    expect(result.check?.blocked[0]?.code).toBe('invalid-quantity');
  });

  describe('missing configuration (fail closed in production, REQ-PRE-006)', () => {
    beforeEach(resetOfferConfigLogsForTests); // a problem is logged once per isolate (RS-01)
    const lines = [{...GIFT_LINE}, OTHER_LINE];

    it.each([
      ['missing', {}],
      ['blank', {OFFER_CONFIG_JSON: '  '}],
      ['broken JSON', {OFFER_CONFIG_JSON: '{nope'}],
    ])(
      'production: a %s configuration pauses checkout and repairs nothing',
      async (_name, env) => {
        const fake = new FakeCart(lines);
        const {storefront} = fakeStorefront(storefrontResponder());
        const result = await revalidateCartOffers(
          {storefront, cart: fake, env, production: true},
          fake.snapshot(),
        );
        expect(fake.calls).toEqual([]);
        expect(result.view?.blocked[0]?.code).toBe('unverified');
        expect(result.view?.blocked[0]?.message).toMatch(/checkout is paused/i);
        expect(decideCheckout(result.cart, result.view).status).toBe('blocked');
      },
    );

    it('OFFERS_ENABLED=false is the explicit "offers off": allowed in production, not blocked, not repaired', async () => {
      const fake = new FakeCart(lines);
      const {storefront} = fakeStorefront(storefrontResponder());
      const result = await revalidateCartOffers(
        {
          storefront,
          cart: fake,
          env: {OFFERS_ENABLED: 'false'},
          production: true,
        },
        fake.snapshot(),
      );
      expect(result.view?.blocked).toEqual([]);
      expect(fake.calls).toEqual([]);
    });

    it('any other OFFERS_ENABLED value does not switch offers off', async () => {
      const fake = new FakeCart(lines);
      const {storefront} = fakeStorefront(storefrontResponder());
      const result = await revalidateCartOffers(
        {storefront, cart: fake, env: {OFFERS_ENABLED: 'no'}, production: true},
        fake.snapshot(),
      );
      expect(result.view?.blocked[0]?.code).toBe('unverified');
    });

    it('a configured store that loses its configuration stops handing carts on', async () => {
      const fake = new FakeCart(lines);
      const {storefront} = fakeStorefront(storefrontResponder());
      const before = await revalidateCartOffers(
        {storefront, cart: fake, env: ENV, production: true},
        fake.snapshot(),
      );
      expect(before.view?.blocked).toEqual([]);
      const after = await revalidateCartOffers(
        {storefront, cart: fake, env: {}, production: true},
        fake.snapshot(),
      );
      expect(decideCheckout(after.cart, after.view).status).toBe('blocked');
    });

    it('development and mock stores run with offers off: the cart is left alone and not blocked', async () => {
      const fake = new FakeCart(lines);
      const {storefront} = fakeStorefront(storefrontResponder());
      const result = await revalidateCartOffers(
        {storefront, cart: fake, env: {}, production: false},
        fake.snapshot(),
      );
      expect(fake.calls).toEqual([]);
      expect(result.view?.gifts).toEqual([]);
      expect(result.view?.blocked).toEqual([]);
    });

    it('logs the problem by name, never the payload', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const fake = new FakeCart(lines);
      const {storefront} = fakeStorefront(storefrontResponder());
      await revalidateCartOffers(
        {
          storefront,
          cart: fake,
          env: {OFFER_CONFIG_JSON: '{secret-looking-text'},
          production: true,
        },
        fake.snapshot(),
      );
      const logged = JSON.stringify(spy.mock.calls);
      expect(logged).toContain('offers.config_problem');
      expect(logged).not.toContain('secret-looking-text');
    });
  });

  describe('incomplete product facts (no over-repair)', () => {
    // A gift that qualifies by COLLECTION: judged by the collections of the products in the cart.
    const collectionEnv = {
      OFFER_CONFIG_JSON: JSON.stringify({
        rules: {
          gifts: [
            {
              id: 'gift-by-collection',
              name: 'Free pillow',
              qualifyingCollectionIds: ['gid://shopify/Collection/1'],
              giftVariantIdsBySize: {Standard: GID.gift},
              maxQuantity: 1,
            },
          ],
        },
      }),
    };
    const lines = [MATTRESS_LINE, {...GIFT_LINE}];

    async function runWith(
      respond: (call: {
        query: string;
        variables: Record<string, unknown>;
      }) => unknown,
      cartLines = lines,
    ) {
      const fake = new FakeCart(cartLines);
      const {storefront} = fakeStorefront(respond);
      const result = await revalidateCartOffers(
        {storefront, cart: fake, env: collectionEnv, production: false},
        fake.snapshot(),
      );
      return {fake, result};
    }

    it('complete read: the gift stays because its mattress is in the collection', async () => {
      const {fake, result} = await runWith(storefrontResponder());
      expect(fake.calls).toEqual([]);
      expect(result.check?.status).toBe('ok');
    });

    it('a failed read makes no repairs and pauses checkout', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const {fake, result} = await runWith((call) => {
        if (call.query.includes('query CartOfferProducts')) {
          throw new Error('Storefront down');
        }
        return storefrontResponder()(call);
      });
      expect(fake.calls).toEqual([]);
      expect(fake.lineIds()).toContain(GIFT_LINE.id);
      expect(result.view?.blocked[0]?.code).toBe('unverified');
    });

    it('a read that misses a product makes no repairs and pauses checkout', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const {fake, result} = await runWith((call) =>
        call.query.includes('query CartOfferProducts')
          ? {nodes: []}
          : storefrontResponder()(call),
      );
      expect(fake.calls).toEqual([]);
      expect(result.view?.blocked.length).toBeGreaterThan(0);
    });

    it('more than 100 distinct products is a truncated read: no repairs, checkout paused', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const many = Array.from({length: 101}, (_, i) => ({
        id: `gid://shopify/CartLine/many-${i}`,
        variantId: `gid://shopify/ProductVariant/${1000 + i}`,
        productId: `gid://shopify/Product/${1000 + i}`,
      }));
      const {fake, result} = await runWith(storefrontResponder(), [
        MATTRESS_LINE,
        {...GIFT_LINE},
        ...many,
      ]);
      expect(fake.calls).toEqual([]);
      expect(result.view?.blocked[0]?.code).toBe('unverified');
    });

    it('without collection-qualified rules a failed read does not stop the cart (only size choices are lost)', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const fake = new FakeCart([MATTRESS_LINE]);
      const {storefront} = fakeStorefront((call) => {
        if (call.query.includes('query CartOfferProducts')) {
          throw new Error('Storefront down');
        }
        return storefrontResponder()(call);
      });
      const result = await revalidateCartOffers(
        {storefront, cart: fake, env: ENV, production: true},
        fake.snapshot(),
      );
      expect(result.view?.blocked).toEqual([]);
      expect(result.view?.lineSizes).toEqual({});
    });
  });

  it('an empty or missing cart needs no check', async () => {
    const fake = new FakeCart([]);
    expect((await run(fake)).view).toBeNull();
    const {storefront} = fakeStorefront(storefrontResponder());
    const none = await revalidateCartOffers(
      {storefront, cart: fake, env: ENV, production: true},
      null,
    );
    expect(none).toEqual({cart: null, check: null, view: null});
  });
});
