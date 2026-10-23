import {describe, expect, it} from 'vitest';
import {fakeStorefront} from '../catalog/fake-storefront';
import {validateAddAddOn} from '~/lib/cart/actions';
import {addAddOn, type PickerResult} from '~/lib/offers-runtime/picker-steps';
import type {
  CartLineAddInput,
  CartMutationResult,
  OfferRuntime,
} from '~/lib/offers-runtime/server';
import {
  CONFIG,
  FakeCart,
  GID,
  MATTRESS_LINE,
  storefrontResponder,
} from '~/lib/offers-runtime/test-fixtures';

// REQ-ADD-001 / REQ-CAT-007 / T-01 (P4-03): the product page's add-on add. The browser names the add-on variant and the
// mattress variant it is viewing; the server proves the pair against the admin-configured relations and Shopify, adds the
// mattress when it is missing, and always adds quantity one. Mock-green only: no development store has run this.

const RULES = {
  ...CONFIG.rules,
  comfortGuarantee: {
    qualifyingProductIds: [GID.mattress],
    protectorVariantIdBySize: {
      Queen: GID.protectorQueen,
      King: GID.protectorKing,
    },
  },
  matchingAddOns: {
    pillows: CONFIG.rules.matchingAddOns.pillows,
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

function setup(
  fake: FakeCart,
  options: {env?: object; soldOut?: string[]; production?: boolean} = {},
) {
  const {storefront, calls} = fakeStorefront(
    storefrontResponder({soldOut: options.soldOut ?? []}),
  );
  const runtime: OfferRuntime = {
    storefront,
    cart: fake,
    env: options.env ?? ENV,
    production: options.production ?? true,
  };
  return {runtime, calls};
}

const addCalls = (fake: FakeCart) =>
  fake.calls.filter((call) => call.method === 'addLines');

const code = (result: PickerResult) =>
  result.status === 'rejected' ? result.code : 'ok';

const FROM_PRODUCT = {
  variantId: GID.foundationQueen,
  mattressVariantId: GID.mattressQueen,
};

describe('addAddOn from the product page (REQ-ADD-001)', () => {
  it('with no cart yet adds the mattress and the add-on in one call, quantity one each', async () => {
    const fake = new FakeCart([]);
    const {runtime} = setup(fake);
    const result = await addAddOn(runtime, null, FROM_PRODUCT);
    expect(result.status).toBe('ok');
    expect(addCalls(fake)).toEqual([
      {
        method: 'addLines',
        lines: [
          {merchandiseId: GID.mattressQueen, quantity: 1},
          {merchandiseId: GID.foundationQueen, quantity: 1},
        ],
      },
    ]);
  });

  it('with the mattress already in the cart adds only the add-on (no second mattress)', async () => {
    const fake = new FakeCart([MATTRESS_LINE]);
    const {runtime} = setup(fake);
    const result = await addAddOn(runtime, fake.snapshot(), FROM_PRODUCT);
    expect(result.status).toBe('ok');
    expect(addCalls(fake)).toEqual([
      {
        method: 'addLines',
        lines: [{merchandiseId: GID.foundationQueen, quantity: 1}],
      },
    ]);
  });

  it('with the add-on already in the cart but not the mattress adds only the mattress', async () => {
    const fake = new FakeCart([
      {
        id: 'gid://shopify/CartLine/f',
        variantId: GID.foundationQueen,
        productId: GID.foundation,
      },
    ]);
    const {runtime} = setup(fake);
    await addAddOn(runtime, fake.snapshot(), FROM_PRODUCT);
    expect(addCalls(fake)[0]).toMatchObject({
      lines: [{merchandiseId: GID.mattressQueen, quantity: 1}],
    });
  });

  it('refuses when both are already in the cart, and adds nothing', async () => {
    const fake = new FakeCart([
      MATTRESS_LINE,
      {
        id: 'gid://shopify/CartLine/f',
        variantId: GID.foundationQueen,
        productId: GID.foundation,
      },
    ]);
    const {runtime} = setup(fake);
    const result = await addAddOn(runtime, fake.snapshot(), FROM_PRODUCT);
    expect(code(result)).toBe('addon-already-in-cart');
    expect(addCalls(fake)).toEqual([]);
  });

  it('offers the King foundation for the King mattress (changing size swaps the pair)', async () => {
    const fake = new FakeCart([]);
    const {runtime} = setup(fake);
    const result = await addAddOn(runtime, null, {
      variantId: GID.foundationKing,
      mattressVariantId: GID.mattressKing,
    });
    expect(result.status).toBe('ok');
    expect(addCalls(fake)[0]).toMatchObject({
      lines: [
        {merchandiseId: GID.mattressKing, quantity: 1},
        {merchandiseId: GID.foundationKing, quantity: 1},
      ],
    });
  });

  it('a size-independent relation fits every size of the mattress', async () => {
    const fake = new FakeCart([]);
    const {runtime} = setup(fake);
    const result = await addAddOn(runtime, null, {
      variantId: GID.pillowVariant,
      mattressVariantId: GID.mattressKing,
    });
    expect(result.status).toBe('ok');
  });

  describe('hostile or stale requests change nothing', () => {
    it.each([
      [
        'the wrong size (King foundation with a Queen mattress)',
        {
          variantId: GID.foundationKing,
          mattressVariantId: GID.mattressQueen,
        },
      ],
      [
        'a variant no rule relates to this mattress',
        {variantId: GID.otherVariant, mattressVariantId: GID.mattressQueen},
      ],
      [
        'a gift variant as the add-on',
        {variantId: GID.gift, mattressVariantId: GID.mattressQueen},
      ],
      [
        'an Extend coverage variant as the add-on',
        {variantId: GID.coverageVariant, mattressVariantId: GID.mattressQueen},
      ],
      [
        'a product that is not a mattress with add-ons as the mattress',
        {variantId: GID.pillowVariant, mattressVariantId: GID.otherVariant},
      ],
      [
        'a gift variant as the mattress',
        {variantId: GID.foundationQueen, mattressVariantId: GID.gift},
      ],
      [
        'a comfort protector variant as the mattress',
        {variantId: GID.foundationQueen, mattressVariantId: GID.protectorQueen},
      ],
      [
        'the haul-away service as the mattress',
        {variantId: GID.foundationQueen, mattressVariantId: GID.haulVariant},
      ],
    ])('refuses %s', async (_name, input) => {
      const fake = new FakeCart([]);
      const {runtime} = setup(fake);
      const result = await addAddOn(runtime, null, input);
      expect(code(result)).toBe('addon-not-offered');
      expect(addCalls(fake)).toEqual([]);
    });

    it('refuses a sold-out add-on', async () => {
      const fake = new FakeCart([]);
      const {runtime} = setup(fake, {soldOut: [GID.foundationQueen]});
      const result = await addAddOn(runtime, null, FROM_PRODUCT);
      expect(code(result)).toBe('addon-not-offered');
      expect(addCalls(fake)).toEqual([]);
    });

    it('refuses a sold-out mattress that is not in the cart, so no add-on is orphaned', async () => {
      const fake = new FakeCart([]);
      const {runtime} = setup(fake, {soldOut: [GID.mattressQueen]});
      const result = await addAddOn(runtime, null, FROM_PRODUCT);
      expect(code(result)).toBe('addon-not-offered');
      expect(addCalls(fake)).toEqual([]);
    });

    it('fails closed in production without the offer configuration', async () => {
      const fake = new FakeCart([]);
      const {runtime} = setup(fake, {env: {}});
      const result = await addAddOn(runtime, null, FROM_PRODUCT);
      expect(code(result)).toBe('unverified');
      expect(addCalls(fake)).toEqual([]);
    });

    it('with the offers switched off nothing is related, so nothing is added', async () => {
      const fake = new FakeCart([]);
      const {runtime} = setup(fake, {
        env: {...ENV, OFFERS_ENABLED: 'false'},
      });
      const result = await addAddOn(runtime, null, FROM_PRODUCT);
      expect(code(result)).toBe('addon-not-offered');
      expect(addCalls(fake)).toEqual([]);
    });

    it('reports a refused add', async () => {
      const fake = new FakeCart([]);
      fake.failNext = true;
      const {runtime} = setup(fake);
      const result = await addAddOn(runtime, null, FROM_PRODUCT);
      expect(code(result)).toBe('add-failed');
    });
  });

  it('refuses when the cart changed after it was read (two tabs, K-L5)', async () => {
    // The first read after the cart was handed in sees a line another tab added.
    class RacingCart extends FakeCart {
      private raced = false;
      override get() {
        if (!this.raced) {
          this.raced = true;
          void super.addLines([
            {merchandiseId: GID.pillowVariant, quantity: 1},
          ]);
        }
        return super.get();
      }
    }
    const fake = new RacingCart([MATTRESS_LINE]);
    const {runtime} = setup(fake);
    const result = await addAddOn(runtime, fake.snapshot(), FROM_PRODUCT);
    expect(code(result)).toBe('cart-changed');
    expect(addCalls(fake)).toHaveLength(1);
  });

  it('starts a fresh cart with the same lines when the cart cookie points at none', async () => {
    class StaleCookieCart extends FakeCart {
      override addLines(
        lines: CartLineAddInput[],
      ): Promise<CartMutationResult> {
        this.calls.push({method: 'addLines', lines});
        return Promise.resolve({cart: null});
      }
    }
    const fake = new StaleCookieCart([]);
    const {runtime} = setup(fake);
    const created: CartLineAddInput[][] = [];
    const result = await addAddOn(runtime, null, FROM_PRODUCT, ({lines}) => {
      created.push(lines);
      return Promise.resolve({cart: {id: 'gid://shopify/Cart/new'}} as never);
    });
    expect(result.status).toBe('ok');
    expect(created).toEqual([
      [
        {merchandiseId: GID.mattressQueen, quantity: 1},
        {merchandiseId: GID.foundationQueen, quantity: 1},
      ],
    ]);
  });

  it('does not start a second cart when the first add really failed', async () => {
    const fake = new FakeCart([]);
    fake.failNext = true;
    const {runtime} = setup(fake);
    let created = 0;
    await addAddOn(runtime, null, FROM_PRODUCT, () => {
      created += 1;
      return Promise.resolve({});
    });
    expect(created).toBe(0);
  });
});

describe('addAddOn from the cart no longer runs the full cart gate first (P4-03 cost)', () => {
  it('reads only the one variant it adds, not product facts, Extend inputs or the offers view', async () => {
    const fake = new FakeCart([MATTRESS_LINE]);
    const {runtime, calls} = setup(fake);
    const result = await addAddOn(runtime, fake.snapshot(), {
      variantId: GID.foundationQueen,
    });
    expect(result.status).toBe('ok');
    expect(calls.map((call) => /query (\w+)/.exec(call.query)?.[1])).toEqual([
      'CartOfferVariants',
    ]);
    expect(calls[0]?.variables).toEqual({ids: [GID.foundationQueen]});
  });

  it('still refuses a variant the rules do not offer for the mattress in the cart, with no add', async () => {
    const fake = new FakeCart([MATTRESS_LINE]);
    const {runtime, calls} = setup(fake);
    const result = await addAddOn(runtime, fake.snapshot(), {
      variantId: GID.foundationKing,
    });
    expect(code(result)).toBe('addon-not-offered');
    // Refused on the rules alone, before any Shopify read.
    expect(calls).toEqual([]);
    expect(addCalls(fake)).toEqual([]);
  });

  it('refuses an empty cart', async () => {
    const fake = new FakeCart([]);
    const {runtime} = setup(fake);
    expect(
      code(
        await addAddOn(runtime, fake.snapshot(), {
          variantId: GID.foundationQueen,
        }),
      ),
    ).toBe('cart-gone');
    expect(
      code(await addAddOn(runtime, null, {variantId: GID.foundationQueen})),
    ).toBe('cart-gone');
  });
});

describe('validateAddAddOn (T-01)', () => {
  it('keeps the two ids and drops a quantity, a price and anything else', () => {
    expect(
      validateAddAddOn({
        variantId: GID.foundationQueen,
        mattressVariantId: GID.mattressQueen,
        quantity: 50,
        price: '0.00',
        parent: {lineId: 'x'},
      }),
    ).toEqual({
      status: 'ok',
      value: {
        variantId: GID.foundationQueen,
        mattressVariantId: GID.mattressQueen,
      },
    });
  });

  it('keeps the cart picker shape when no mattress is named', () => {
    expect(validateAddAddOn({variantId: GID.foundationQueen})).toEqual({
      status: 'ok',
      value: {variantId: GID.foundationQueen},
    });
  });

  it.each([
    ['a malformed mattress id', {mattressVariantId: 'abc'}],
    ['a product id as the mattress', {mattressVariantId: GID.mattress}],
    ['a mattress id that is not a string', {mattressVariantId: 5}],
    ['a null mattress id', {mattressVariantId: null}],
    [
      'the add-on itself as the mattress',
      {mattressVariantId: GID.foundationQueen},
    ],
  ])('refuses %s instead of treating it as the cart picker', (_name, extra) => {
    expect(
      validateAddAddOn({variantId: GID.foundationQueen, ...extra}).status,
    ).toBe('invalid');
  });
});
