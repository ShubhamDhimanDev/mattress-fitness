import {describe, expect, it} from 'vitest';
import type {CartApiQueryFragment} from 'storefrontapi.generated';
import {fakeStorefront} from '../catalog/fake-storefront';
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
  return {storefront, cart: fake, env: ENV};
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

  it('with no rules configured the cart is left alone (degrades to no offers)', async () => {
    const fake = new FakeCart([{...GIFT_LINE}]);
    const {storefront} = fakeStorefront(storefrontResponder());
    const result = await revalidateCartOffers(
      {storefront, cart: fake, env: {}},
      fake.snapshot(),
    );
    expect(fake.calls).toEqual([]);
    expect(result.view?.gifts).toEqual([]);
  });

  it('an empty or missing cart needs no check', async () => {
    const fake = new FakeCart([]);
    expect((await run(fake)).view).toBeNull();
    const {storefront} = fakeStorefront(storefrontResponder());
    const none = await revalidateCartOffers(
      {storefront, cart: fake, env: ENV},
      null,
    );
    expect(none).toEqual({cart: null, check: null, view: null});
  });
});
