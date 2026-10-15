import {describe, expect, it} from 'vitest';
import {fakeStorefront} from '../catalog/fake-storefront';
import {
  validateAddAddOn,
  validateAddBundle,
  validateAddGift,
} from '~/lib/cart/actions';
import {decideCheckout} from '~/lib/cart/checkout';
import {revalidateCartGate} from '~/lib/offers-runtime/cart-gate';
import {
  addAddOn,
  addBundle,
  addGift,
  type PickerResult,
} from '~/lib/offers-runtime/picker-steps';
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

// REQ-CART-002 / REQ-CART-003 / REQ-ADD-002 / REQ-PROMO-001 / REQ-PROMO-002 / T-01 / T-02: the cart pickers' accept
// actions against the real cart gate, a fake Storefront and an in-memory cart. The browser names ids taken from the view;
// everything else (quantity, lines, price) is the server's. Mock-green only: nothing here has run against a development
// store (V-03: the Shopify discounts that make a gift free and a bundle cheaper do not exist on any store yet).

const GIFT_RULE = {
  id: 'gift-pillow',
  name: 'Free pillow',
  qualifyingProductIds: [GID.mattress],
  giftVariantIdsBySize: {Standard: GID.gift, Plush: GID.giftAlt},
  maxQuantity: 1,
};
const BUNDLE_RULE = {
  id: 'sleep-set',
  name: 'Sleep set',
  discountTitle: 'Sleep set saving',
  anchorProductId: GID.mattress,
  members: [
    {
      productId: GID.foundation,
      quantity: 1,
      variants: {
        type: 'by-size',
        variantIdBySize: {
          Queen: GID.foundationQueen,
          King: GID.foundationKing,
        },
      },
    },
    {
      productId: GID.pillow,
      quantity: 2,
      variants: {type: 'single', variantId: GID.pillowVariant},
    },
  ],
};
const RULES = {
  ...CONFIG.rules,
  // No comfort-guarantee: the protector step would add noise to the calls these tests count.
  comfortGuarantee: undefined,
  gifts: [GIFT_RULE],
  bundles: [BUNDLE_RULE],
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
const ENV = {
  OFFER_CONFIG_JSON: JSON.stringify({...CONFIG, rules: RULES}),
  // The gift picker is off by default until V-03 (m2); these tests exercise it switched on.
  PUBLIC_GIFT_PICKER_ENABLED: 'true',
};

function runtime(
  fake: FakeCart,
  options: {env?: object; soldOut?: string[]; production?: boolean} = {},
): OfferRuntime {
  const {storefront} = fakeStorefront(
    storefrontResponder({soldOut: options.soldOut ?? []}),
  );
  return {
    storefront,
    cart: fake,
    env: options.env ?? ENV,
    production: options.production ?? true,
  };
}

const KING_MATTRESS = {
  ...MATTRESS_LINE,
  variantId: GID.mattressKing,
  size: 'King',
};
const OTHER_LINE = {
  id: 'gid://shopify/CartLine/o',
  variantId: GID.otherVariant,
  productId: GID.other,
};
const FOUNDATION_LINE = {
  id: 'gid://shopify/CartLine/f',
  variantId: GID.foundationQueen,
  productId: GID.foundation,
};
const PILLOW_LINE = {
  id: 'gid://shopify/CartLine/p',
  variantId: GID.pillowVariant,
  productId: GID.pillow,
  quantity: 2,
};

const addCalls = (fake: FakeCart) =>
  fake.calls.filter((call) => call.method === 'addLines');

function rejectedCode(result: PickerResult): string {
  return result.status === 'rejected' ? result.code : 'ok';
}

describe('addGift (REQ-CART-002, REQ-PROMO-001)', () => {
  const input = (variantId: string, ruleId = GIFT_RULE.id) => ({
    ruleId,
    variantId,
  });

  it('adds exactly one of the chosen gift, and the cart gate is then clean with the allowance used up', async () => {
    const fake = new FakeCart([MATTRESS_LINE]);
    const result = await addGift(
      runtime(fake),
      fake.snapshot(),
      input(GID.giftAlt),
    );
    expect(result.status).toBe('ok');
    expect(addCalls(fake)).toEqual([
      {
        method: 'addLines',
        lines: [{merchandiseId: GID.giftAlt, quantity: 1}],
      },
    ]);
    const gate = await revalidateCartGate(runtime(fake), fake.snapshot());
    expect(gate.view?.blocked).toEqual([]);
    expect(gate.view?.gifts).toEqual([]);
  });

  it('refuses a rule id the cart is not offered (forged or stale)', async () => {
    const fake = new FakeCart([MATTRESS_LINE]);
    const result = await addGift(
      runtime(fake),
      fake.snapshot(),
      input(GID.gift, 'gift-that-does-not-exist'),
    );
    expect(rejectedCode(result)).toBe('gift-not-offered');
    expect(addCalls(fake)).toEqual([]);
  });

  it.each([
    ['a variant of another product', GID.otherVariant],
    ['an add-on variant', GID.pillowVariant],
    ['a protector variant', GID.protectorQueen],
    [
      'a variant that is a real gift only by its look',
      'gid://shopify/ProductVariant/33',
    ],
  ])(
    'refuses %s named as the gift (forged variant)',
    async (_name, variantId) => {
      const fake = new FakeCart([MATTRESS_LINE]);
      const result = await addGift(
        runtime(fake),
        fake.snapshot(),
        input(variantId),
      );
      expect(rejectedCode(result)).toBe('gift-choice-invalid');
      expect(addCalls(fake)).toEqual([]);
    },
  );

  it('refuses the gift when no qualifying item is in the cart (ineligible)', async () => {
    const fake = new FakeCart([OTHER_LINE]);
    const result = await addGift(
      runtime(fake),
      fake.snapshot(),
      input(GID.gift),
    );
    expect(rejectedCode(result)).toBe('gift-not-offered');
    expect(addCalls(fake)).toEqual([]);
  });

  it('refuses a second gift when the allowance is used up (quantity above the cap)', async () => {
    const fake = new FakeCart([MATTRESS_LINE]);
    await addGift(runtime(fake), fake.snapshot(), input(GID.gift));
    const second = await addGift(
      runtime(fake),
      fake.snapshot(),
      input(GID.giftAlt),
    );
    expect(rejectedCode(second)).toBe('gift-not-offered');
    expect(addCalls(fake)).toHaveLength(1);
  });

  it('refuses a gift variant that is sold out', async () => {
    const fake = new FakeCart([MATTRESS_LINE]);
    const result = await addGift(
      runtime(fake, {soldOut: [GID.giftAlt]}),
      fake.snapshot(),
      input(GID.giftAlt),
    );
    expect(rejectedCode(result)).toBe('gift-choice-invalid');
    expect(addCalls(fake)).toEqual([]);
  });

  it('fails closed in production without the offer configuration (cannot tell a gift from an ordinary line)', async () => {
    const fake = new FakeCart([MATTRESS_LINE]);
    const result = await addGift(
      runtime(fake, {env: {}}),
      fake.snapshot(),
      input(GID.gift),
    );
    expect(rejectedCode(result)).toBe('unverified');
    expect(addCalls(fake)).toEqual([]);
  });

  it('with the offers switched off nothing is offered, so nothing is added', async () => {
    const fake = new FakeCart([MATTRESS_LINE]);
    const result = await addGift(
      runtime(fake, {env: {...ENV, OFFERS_ENABLED: 'false'}}),
      fake.snapshot(),
      input(GID.gift),
    );
    expect(rejectedCode(result)).toBe('gift-not-offered');
    expect(addCalls(fake)).toEqual([]);
  });

  it('refuses when there is no cart', async () => {
    const fake = new FakeCart([]);
    const result = await addGift(runtime(fake), null, input(GID.gift));
    expect(rejectedCode(result)).toBe('cart-gone');
  });

  it('reports a refused add and leaves the cart as it was', async () => {
    const fake = new FakeCart([MATTRESS_LINE]);
    fake.failNext = true;
    const result = await addGift(
      runtime(fake),
      fake.snapshot(),
      input(GID.gift),
    );
    expect(rejectedCode(result)).toBe('add-failed');
    expect(fake.lineIds()).toEqual([MATTRESS_LINE.id]);
  });

  it('pauses checkout, and keeps the line, when Shopify does not price the gift at 0 (T-02)', async () => {
    const fake = new FakeCart([MATTRESS_LINE]);
    fake.giftDiscountLive = false;
    const result = await addGift(
      runtime(fake),
      fake.snapshot(),
      input(GID.gift),
    );
    expect(result.status).toBe('ok');
    const gate = await revalidateCartGate(runtime(fake), fake.snapshot());
    const reason = gate.view?.blocked.find((r) => r.code === 'gift-not-free');
    expect(reason?.lineIds).toHaveLength(1);
    expect(fake.lineIds()).toHaveLength(2);
    expect(decideCheckout(gate.cart, gate.view).status).toBe('blocked');
  });

  it('does not pause checkout for a gift Shopify prices at 0', async () => {
    const fake = new FakeCart([MATTRESS_LINE]);
    await addGift(runtime(fake), fake.snapshot(), input(GID.gift));
    const gate = await revalidateCartGate(runtime(fake), fake.snapshot());
    expect(gate.view?.blocked).toEqual([]);
  });
});

describe('validateAddGift / validateAddAddOn / validateAddBundle (T-01)', () => {
  it('keeps the ids and drops a quantity, a price and anything else', () => {
    expect(
      validateAddGift({
        ruleId: 'gift-pillow',
        variantId: GID.gift,
        quantity: 50,
        price: '0.00',
        discount: 'FREE',
      }),
    ).toEqual({
      status: 'ok',
      value: {ruleId: 'gift-pillow', variantId: GID.gift},
    });
    expect(
      validateAddAddOn({variantId: GID.pillowVariant, quantity: 50}),
    ).toEqual({status: 'ok', value: {variantId: GID.pillowVariant}});
    expect(
      validateAddBundle({
        bundleId: 'sleep-set',
        anchorLineId: MATTRESS_LINE.id,
        lines: [{merchandiseId: GID.otherVariant, quantity: 9}],
      }),
    ).toEqual({
      status: 'ok',
      value: {bundleId: 'sleep-set', anchorLineId: MATTRESS_LINE.id},
    });
  });

  it.each([
    ['no input', undefined],
    ['an array', []],
    ['a rule id that is not a string', {ruleId: 5, variantId: GID.gift}],
    ['an empty rule id', {ruleId: '', variantId: GID.gift}],
    [
      'a rule id with a control character',
      {ruleId: 'a\nb', variantId: GID.gift},
    ],
    [
      'a rule id that is far too long',
      {ruleId: 'x'.repeat(500), variantId: GID.gift},
    ],
    [
      'a variant that is not a Shopify variant id',
      {ruleId: 'g', variantId: 'abc'},
    ],
    [
      'a product id as the variant',
      {ruleId: 'g', variantId: 'gid://shopify/Product/1'},
    ],
  ])('refuses a gift request with %s', (_name, raw) => {
    expect(validateAddGift(raw).status).toBe('invalid');
  });

  it.each([
    ['no input', undefined],
    ['a malformed variant', {variantId: '31'}],
    ['a line id as the variant', {variantId: MATTRESS_LINE.id}],
  ])('refuses an add-on request with %s', (_name, raw) => {
    expect(validateAddAddOn(raw).status).toBe('invalid');
  });

  it.each([
    ['no input', undefined],
    [
      'a variant id as the anchor line',
      {bundleId: 'b', anchorLineId: GID.gift},
    ],
    ['no bundle id', {anchorLineId: MATTRESS_LINE.id}],
  ])('refuses a bundle request with %s', (_name, raw) => {
    expect(validateAddBundle(raw).status).toBe('invalid');
  });
});

describe('addAddOn (REQ-CART-003, REQ-ADD-001)', () => {
  it('adds one of the size-matched add-on', async () => {
    const fake = new FakeCart([MATTRESS_LINE]);
    const result = await addAddOn(runtime(fake), fake.snapshot(), {
      variantId: GID.foundationQueen,
    });
    expect(result.status).toBe('ok');
    expect(addCalls(fake)).toEqual([
      {
        method: 'addLines',
        lines: [{merchandiseId: GID.foundationQueen, quantity: 1}],
      },
    ]);
  });

  it('shows the add-on for the mattress size in the cart only', async () => {
    const fake = new FakeCart([KING_MATTRESS]);
    const gate = await revalidateCartGate(runtime(fake), fake.snapshot());
    expect(gate.view?.addOns.map((a) => a.variant.variantId)).toEqual([
      GID.foundationKing,
      GID.pillowVariant,
    ]);
  });

  it('refuses an add-on of the wrong size (a King foundation for a Queen mattress)', async () => {
    const fake = new FakeCart([MATTRESS_LINE]);
    const result = await addAddOn(runtime(fake), fake.snapshot(), {
      variantId: GID.foundationKing,
    });
    expect(rejectedCode(result)).toBe('addon-not-offered');
    expect(addCalls(fake)).toEqual([]);
  });

  it.each([
    ['an unrelated product', GID.otherVariant],
    ['a gift variant', GID.gift],
    ['a protector variant', GID.protectorQueen],
    ['an Extend coverage variant', GID.coverageVariant],
  ])(
    'refuses %s (not an add-on the rules offer for this cart)',
    async (_name, variantId) => {
      const fake = new FakeCart([MATTRESS_LINE]);
      const result = await addAddOn(runtime(fake), fake.snapshot(), {
        variantId,
      });
      expect(rejectedCode(result)).toBe('addon-not-offered');
      expect(addCalls(fake)).toEqual([]);
    },
  );

  it('refuses an add-on when the mattress it goes with is not in the cart', async () => {
    const fake = new FakeCart([OTHER_LINE]);
    const result = await addAddOn(runtime(fake), fake.snapshot(), {
      variantId: GID.pillowVariant,
    });
    expect(rejectedCode(result)).toBe('addon-not-offered');
  });

  it('refuses a sold-out add-on and one already in the cart', async () => {
    const fake = new FakeCart([MATTRESS_LINE]);
    const soldOut = await addAddOn(
      runtime(fake, {soldOut: [GID.pillowVariant]}),
      fake.snapshot(),
      {variantId: GID.pillowVariant},
    );
    expect(rejectedCode(soldOut)).toBe('addon-not-offered');
    await addAddOn(runtime(fake), fake.snapshot(), {
      variantId: GID.pillowVariant,
    });
    const again = await addAddOn(runtime(fake), fake.snapshot(), {
      variantId: GID.pillowVariant,
    });
    expect(rejectedCode(again)).toBe('addon-not-offered');
    expect(addCalls(fake)).toHaveLength(1);
  });

  it('fails closed in production without the offer configuration', async () => {
    const fake = new FakeCart([MATTRESS_LINE]);
    const result = await addAddOn(runtime(fake, {env: {}}), fake.snapshot(), {
      variantId: GID.pillowVariant,
    });
    expect(rejectedCode(result)).toBe('unverified');
    expect(addCalls(fake)).toEqual([]);
  });

  it('reports a refused add', async () => {
    const fake = new FakeCart([MATTRESS_LINE]);
    fake.failNext = true;
    const result = await addAddOn(runtime(fake), fake.snapshot(), {
      variantId: GID.pillowVariant,
    });
    expect(rejectedCode(result)).toBe('add-failed');
  });
});

/** An in-memory cart whose bundle add lands only its first line but still reports errors (a partial add). */
class PartialCart extends FakeCart {
  override addLines(lines: CartLineAddInput[]): Promise<CartMutationResult> {
    const [first] = lines;
    if (first) void super.addLines([first]);
    return Promise.resolve({
      cart: this.snapshot(),
      userErrors: [{message: 'One line could not be added'}],
    });
  }
}

describe('bundles in the cart view (REQ-ADD-002, REQ-PROMO-002)', () => {
  it('offers the missing companions in the anchor size, all or nothing', async () => {
    const fake = new FakeCart([MATTRESS_LINE]);
    const gate = await revalidateCartGate(runtime(fake), fake.snapshot());
    expect(gate.view?.bundles).toHaveLength(1);
    const [bundle] = gate.view?.bundles ?? [];
    expect(bundle).toMatchObject({
      bundleId: 'sleep-set',
      anchorLineId: MATTRESS_LINE.id,
      status: 'incomplete',
      savings: null,
    });
    expect(
      bundle?.missing.map((m) => [m.variant.variantId, m.quantity]),
    ).toEqual([
      [GID.foundationQueen, 1],
      [GID.pillowVariant, 2],
    ]);
  });

  it('offers nothing when one companion is sold out (a partial set would not earn the saving)', async () => {
    const fake = new FakeCart([MATTRESS_LINE]);
    const gate = await revalidateCartGate(
      runtime(fake, {soldOut: [GID.pillowVariant]}),
      fake.snapshot(),
    );
    expect(gate.view?.bundles).toEqual([]);
  });

  it('offers nothing when a companion has no variant in the mattress size', async () => {
    const queenOnly = {
      ...BUNDLE_RULE,
      members: [
        {
          ...BUNDLE_RULE.members[0],
          variants: {
            type: 'by-size',
            variantIdBySize: {Queen: GID.foundationQueen},
          },
        },
      ],
    };
    const env = {
      OFFER_CONFIG_JSON: JSON.stringify({
        ...CONFIG,
        rules: {...RULES, bundles: [queenOnly]},
      }),
    };
    const fake = new FakeCart([KING_MATTRESS]);
    const gate = await revalidateCartGate(
      runtime(fake, {env}),
      fake.snapshot(),
    );
    expect(gate.view?.bundles).toEqual([]);
  });

  it('shows no bundle when the anchor product is not in the cart', async () => {
    const fake = new FakeCart([OTHER_LINE]);
    const gate = await revalidateCartGate(runtime(fake), fake.snapshot());
    expect(gate.view?.bundles).toEqual([]);
  });

  const COMPLETE = [FOUNDATION_LINE, PILLOW_LINE];
  const savingsOf = async (
    lines: ConstructorParameters<typeof FakeCart>[0],
  ) => {
    const fake = new FakeCart(lines);
    const gate = await revalidateCartGate(runtime(fake), fake.snapshot());
    return gate.view?.bundles ?? [];
  };

  it('shows the saving of the own automatic discount of the bundle, summed from its lines, and nothing else', async () => {
    const bundles = await savingsOf([
      {
        ...MATTRESS_LINE,
        discountCents: 5000,
        discountTitle: 'Sleep set saving',
      },
      {
        ...FOUNDATION_LINE,
        discountCents: 2500,
        discountTitle: '  sleep SET saving ',
      },
      {...PILLOW_LINE, discountCents: 1000, discountTitle: 'Sleep set saving'},
      // A discount on an unrelated line is not this bundle's saving.
      {...OTHER_LINE, discountCents: 9900, discountTitle: 'Sleep set saving'},
    ]);
    expect(bundles).toEqual([
      expect.objectContaining({
        status: 'complete',
        missing: [],
        savings: {amount: '85.00', currencyCode: 'USD'},
      }),
    ]);
  });

  it('M1: a code discount on the bundle lines is not the bundle saving', async () => {
    expect(
      await savingsOf([
        {...MATTRESS_LINE, discountCents: 5000, discountKind: 'code'},
        ...COMPLETE,
      ]),
    ).toEqual([]);
  });

  it('M1: an unrelated automatic sale on the bundle lines is not the bundle saving', async () => {
    expect(
      await savingsOf([
        {...MATTRESS_LINE, discountCents: 5000, discountTitle: 'Summer sale'},
        ...COMPLETE,
      ]),
    ).toEqual([]);
  });

  it('M1: only the named discount counts when a code and a sale sit on the same line', async () => {
    const bundles = await savingsOf([
      {
        ...MATTRESS_LINE,
        discountCents: 5000,
        discountTitle: 'Sleep set saving',
        alsoDiscounts: [
          {cents: 7000, kind: 'code'},
          {cents: 3000, title: 'Summer sale'},
        ],
      },
      ...COMPLETE,
    ]);
    expect(bundles[0]?.savings).toEqual({amount: '50.00', currencyCode: 'USD'});
  });

  it('M1: a rule without a discount title shows no figure, whatever Shopify reports', async () => {
    const env = {
      ...ENV,
      OFFER_CONFIG_JSON: JSON.stringify({
        ...CONFIG,
        rules: {
          ...RULES,
          bundles: [{...BUNDLE_RULE, discountTitle: undefined}],
        },
      }),
    };
    const fake = new FakeCart([
      {
        ...MATTRESS_LINE,
        discountCents: 5000,
        discountTitle: 'Sleep set saving',
      },
      ...COMPLETE,
    ]);
    const gate = await revalidateCartGate(
      runtime(fake, {env}),
      fake.snapshot(),
    );
    expect(gate.view?.bundles).toEqual([]);
  });

  it('M1: a companion line shared by two anchors is counted once', async () => {
    const bundles = await savingsOf([
      {
        ...MATTRESS_LINE,
        id: 'q1',
        discountCents: 5000,
        discountTitle: 'Sleep set saving',
      },
      {
        ...MATTRESS_LINE,
        id: 'q2',
        discountCents: 5000,
        discountTitle: 'Sleep set saving',
      },
      {
        ...FOUNDATION_LINE,
        quantity: 2,
        discountCents: 2000,
        discountTitle: 'Sleep set saving',
      },
      {
        ...PILLOW_LINE,
        quantity: 4,
        discountCents: 1000,
        discountTitle: 'Sleep set saving',
      },
    ]);
    // 130.00 in all (anchors 2 x 50, foundation 20, pillows 10): the shared companion lines are credited to the first anchor only.
    expect(bundles.map((b) => b.savings?.amount)).toEqual(['80.00', '50.00']);
  });

  it('shows nothing for a complete bundle when Shopify reports no saving (no number is invented)', async () => {
    const fake = new FakeCart([MATTRESS_LINE, FOUNDATION_LINE, PILLOW_LINE]);
    const gate = await revalidateCartGate(runtime(fake), fake.snapshot());
    expect(gate.view?.bundles).toEqual([]);
  });

  it('removing a companion turns the complete bundle back into an offer and drops the saving', async () => {
    const fake = new FakeCart([
      {...MATTRESS_LINE, discountCents: 5000},
      FOUNDATION_LINE,
      PILLOW_LINE,
    ]);
    await fake.removeLines([PILLOW_LINE.id]);
    const gate = await revalidateCartGate(runtime(fake), fake.snapshot());
    expect(gate.view?.bundles).toEqual([
      expect.objectContaining({status: 'incomplete', savings: null}),
    ]);
  });
});

describe('addBundle (REQ-ADD-002)', () => {
  const input = (anchorLineId = MATTRESS_LINE.id, bundleId = 'sleep-set') => ({
    bundleId,
    anchorLineId,
  });

  it('adds every missing companion in one call, with the quantities the server derived', async () => {
    const fake = new FakeCart([MATTRESS_LINE]);
    const result = await addBundle(runtime(fake), fake.snapshot(), input());
    expect(result).toMatchObject({status: 'ok'});
    expect(result.status === 'ok' && result.warning).toBeFalsy();
    expect(addCalls(fake)).toEqual([
      {
        method: 'addLines',
        lines: [
          {merchandiseId: GID.foundationQueen, quantity: 1},
          {merchandiseId: GID.pillowVariant, quantity: 2},
        ],
      },
    ]);
  });

  it('adds only what is still missing', async () => {
    const fake = new FakeCart([MATTRESS_LINE, {...PILLOW_LINE, quantity: 1}]);
    await addBundle(runtime(fake), fake.snapshot(), input());
    expect(addCalls(fake)).toEqual([
      {
        method: 'addLines',
        lines: [
          {merchandiseId: GID.foundationQueen, quantity: 1},
          {merchandiseId: GID.pillowVariant, quantity: 1},
        ],
      },
    ]);
  });

  it.each([
    ['a bundle id that does not exist', input(MATTRESS_LINE.id, 'forged')],
    [
      'an anchor line that is not in the cart',
      input('gid://shopify/CartLine/zzz'),
    ],
    ['an anchor line that is not the bundle anchor', input(OTHER_LINE.id)],
  ])('refuses %s', async (_name, request) => {
    const fake = new FakeCart([MATTRESS_LINE, OTHER_LINE]);
    const result = await addBundle(runtime(fake), fake.snapshot(), request);
    expect(rejectedCode(result)).toBe('bundle-not-offered');
    expect(addCalls(fake)).toEqual([]);
  });

  it('refuses a bundle that is already complete', async () => {
    const fake = new FakeCart([MATTRESS_LINE, FOUNDATION_LINE, PILLOW_LINE]);
    const result = await addBundle(runtime(fake), fake.snapshot(), input());
    expect(rejectedCode(result)).toBe('bundle-not-offered');
    expect(addCalls(fake)).toEqual([]);
  });

  it('refuses a bundle with a sold-out companion (all or nothing)', async () => {
    const fake = new FakeCart([MATTRESS_LINE]);
    const result = await addBundle(
      runtime(fake, {soldOut: [GID.foundationQueen]}),
      fake.snapshot(),
      input(),
    );
    expect(rejectedCode(result)).toBe('bundle-not-offered');
    expect(addCalls(fake)).toEqual([]);
  });

  it('fails closed in production without the offer configuration', async () => {
    const fake = new FakeCart([MATTRESS_LINE]);
    const result = await addBundle(
      runtime(fake, {env: {}}),
      fake.snapshot(),
      input(),
    );
    expect(rejectedCode(result)).toBe('unverified');
    expect(addCalls(fake)).toEqual([]);
  });

  it('reports a total failure and changes nothing', async () => {
    const fake = new FakeCart([MATTRESS_LINE]);
    fake.failNext = true;
    const result = await addBundle(runtime(fake), fake.snapshot(), input());
    expect(rejectedCode(result)).toBe('bundle-add-failed');
    expect(fake.lineIds()).toEqual([MATTRESS_LINE.id]);
  });

  it('reports a partial add from the cart read back, not from the mutation answer', async () => {
    const fake = new PartialCart([MATTRESS_LINE]);
    const result = await addBundle(runtime(fake), fake.snapshot(), input());
    expect(result.status).toBe('ok');
    expect(result.status === 'ok' && result.warning).toBe('bundle-partial');
    expect(fake.lineIds()).toHaveLength(2);
  });

  it('a retry after a partial add asks only for what is still missing', async () => {
    const fake = new PartialCart([MATTRESS_LINE]);
    await addBundle(runtime(fake), fake.snapshot(), input());
    const calls = addCalls(fake).length;
    const retry = new FakeCart(fake.allSpecs());
    await addBundle(runtime(retry), retry.snapshot(), input());
    expect(calls).toBe(1);
    expect(addCalls(retry)).toEqual([
      {
        method: 'addLines',
        lines: [{merchandiseId: GID.pillowVariant, quantity: 2}],
      },
    ]);
  });
});

describe('the gift picker waits for V-03 (flag PUBLIC_GIFT_PICKER_ENABLED)', () => {
  const without = (extra: object = {}) => ({
    OFFER_CONFIG_JSON: ENV.OFFER_CONFIG_JSON,
    ...extra,
  });

  it.each([
    ['unset', without()],
    ['false', without({PUBLIC_GIFT_PICKER_ENABLED: 'false'})],
    ['not exactly "true"', without({PUBLIC_GIFT_PICKER_ENABLED: 'yes'})],
  ])(
    'with the flag %s no gift is offered and none can be added',
    async (_n, env) => {
      const fake = new FakeCart([MATTRESS_LINE]);
      const gate = await revalidateCartGate(
        runtime(fake, {env}),
        fake.snapshot(),
      );
      expect(gate.view?.gifts).toEqual([]);
      const result = await addGift(runtime(fake, {env}), fake.snapshot(), {
        ruleId: GIFT_RULE.id,
        variantId: GID.gift,
      });
      expect(rejectedCode(result)).toBe('gift-not-offered');
      expect(addCalls(fake)).toEqual([]);
    },
  );

  it('add-ons and bundles are unaffected by the flag', async () => {
    const fake = new FakeCart([MATTRESS_LINE]);
    const gate = await revalidateCartGate(
      runtime(fake, {env: without()}),
      fake.snapshot(),
    );
    expect(gate.view?.addOns.length).toBeGreaterThan(0);
    expect(gate.view?.bundles).toHaveLength(1);
  });

  it('a gift already in the cart is still price-checked with the flag off (K-M1)', async () => {
    const fake = new FakeCart([MATTRESS_LINE]);
    fake.giftDiscountLive = false;
    await fake.addLines([{merchandiseId: GID.gift, quantity: 1}]);
    const gate = await revalidateCartGate(
      runtime(fake, {env: without()}),
      fake.snapshot(),
    );
    expect(gate.view?.blocked.map((r) => r.code)).toContain('gift-not-free');
  });
});

/** A cart that another tab changes after this request judged it: the first read after the judgement sees the change. */
class RacingCart extends FakeCart {
  private raced = false;
  constructor(
    lines: ConstructorParameters<typeof FakeCart>[0],
    private readonly rival: CartLineAddInput,
  ) {
    super(lines);
  }
  override get() {
    if (!this.raced) {
      this.raced = true;
      void super.addLines([this.rival]);
    }
    return super.get();
  }
}

describe('two tabs posting at once add nothing twice (K-L5)', () => {
  it('an add-on is not added when the cart changed after it was judged', async () => {
    const fake = new RacingCart([MATTRESS_LINE], {
      merchandiseId: GID.pillowVariant,
      quantity: 1,
    });
    const result = await addAddOn(runtime(fake), fake.snapshot(), {
      variantId: GID.pillowVariant,
    });
    expect(rejectedCode(result)).toBe('cart-changed');
    // Only the other tab's line is there: one pillow, not two.
    expect(
      fake.allSpecs().filter((spec) => spec.variantId === GID.pillowVariant),
    ).toEqual([expect.objectContaining({quantity: 1})]);
    expect(addCalls(fake)).toHaveLength(1);
  });

  it('a bundle is not added when the cart changed after it was judged', async () => {
    const fake = new RacingCart([MATTRESS_LINE], {
      merchandiseId: GID.foundationQueen,
      quantity: 1,
    });
    const result = await addBundle(runtime(fake), fake.snapshot(), {
      bundleId: 'sleep-set',
      anchorLineId: MATTRESS_LINE.id,
    });
    expect(rejectedCode(result)).toBe('cart-changed');
    expect(addCalls(fake)).toHaveLength(1);
  });

  it('a gift is not added when the cart changed after it was judged', async () => {
    const fake = new RacingCart([MATTRESS_LINE], {
      merchandiseId: GID.pillowVariant,
      quantity: 1,
    });
    const result = await addGift(runtime(fake), fake.snapshot(), {
      ruleId: GIFT_RULE.id,
      variantId: GID.gift,
    });
    expect(rejectedCode(result)).toBe('cart-changed');
    expect(addCalls(fake)).toHaveLength(1);
  });

  it('adds normally when nothing changed', async () => {
    const fake = new FakeCart([MATTRESS_LINE]);
    const result = await addAddOn(runtime(fake), fake.snapshot(), {
      variantId: GID.pillowVariant,
    });
    expect(result.status).toBe('ok');
  });
});
