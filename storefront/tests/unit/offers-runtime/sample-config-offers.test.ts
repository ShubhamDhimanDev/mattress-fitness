import {describe, expect, it} from 'vitest';
import {fakeStorefront} from '../catalog/fake-storefront';
import {freeDeliveryMessage} from '~/lib/offers/free-delivery';
import {evaluateOffers} from '~/lib/offers/evaluate';
import {makeCart, makeContext} from '~/lib/offers/test-fixtures';
import {revalidateCartGate} from '~/lib/offers-runtime/cart-gate';
import type {OfferRuntime} from '~/lib/offers-runtime/server';
import {FakeCart} from '~/lib/offers-runtime/test-fixtures';
import {
  HAUL_HANDLE,
  loadExampleConfig,
  loadSampleCatalog,
  minifiedExampleConfig,
  productId,
  sampleStorefrontResponder,
  SIZES,
  variantId,
  type SampleSize,
} from './sample-config-support';

// P4-12 interim (DEC-082): proves the PLACEHOLDER example configuration and the offer code agree, by running the pure
// engine and the real cart gate on carts built from the example configuration and the sample catalog sheets. Mock-green
// only: the Storefront answers come from the sample sheets, the cart is an in-memory fake, and no Shopify discount
// exists anywhere (V-03 and V-27 stay open). REQ-CART-002, REQ-CART-003, REQ-CART-004, REQ-ADD-001, REQ-ADD-002,
// REQ-PRE-002, REQ-PRE-003, REQ-PROMO-001, REQ-PROMO-002.

const catalog = loadSampleCatalog();
const loaded = loadExampleConfig();
const {rules, zone} = loaded.config;

const IN_ZONE = '60645';
const OUT_OF_ZONE = '90210';
const SLEEP_SET_TITLE = 'Sleep set 10% off (placeholder)';
const IN_HOME = [{key: 'delivery_choice', value: 'in-home'}];

type Spec = ConstructorParameters<typeof FakeCart>[0][number];

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const lineId = (handle: string, size: string | null) =>
  `gid://shopify/CartLine/${handle}-${slug(size ?? 'default')}`;

function payable(handle: string, size: SampleSize): number {
  const variant = catalog
    .get(handle)
    ?.variants.find((candidate) => candidate.size === size);
  if (!variant)
    throw new Error(`${handle} ${size} is not in the sample sheets`);
  return variant.payableCents;
}

/** A catalog line at the price a shopper pays (the sheet's sale price when there is one). */
function line(
  handle: string,
  size: SampleSize,
  extra: Partial<Spec> = {},
): Spec {
  return {
    id: lineId(handle, size),
    variantId: variantId(handle, size),
    productId: productId(handle),
    size,
    priceCents: payable(handle, size),
    ...extra,
  };
}

/** The haul-away service: one default variant, created by hand in admin. */
function haulLine(quantity: number): Spec {
  return {
    id: lineId(HAUL_HANDLE, null),
    variantId: variantId(HAUL_HANDLE, 'Twin'),
    productId: productId(HAUL_HANDLE),
    size: null,
    quantity,
    priceCents: 4900,
  };
}

/** A gift pillow line the way Shopify returns it once the automatic discount applies: full price, line total 0. */
function giftLine(size: SampleSize, totalCents: number): Spec {
  return line('sample-gift-pillow', size, {totalCents});
}

const ENV = {
  OFFER_CONFIG_JSON: minifiedExampleConfig(),
  PUBLIC_GIFT_PICKER_ENABLED: 'true',
};

function runtime(
  fake: FakeCart,
  options: {
    zip?: string | null;
    env?: object;
    soldOut?: readonly string[];
  } = {},
): OfferRuntime {
  const {storefront} = fakeStorefront(
    sampleStorefrontResponder(catalog, {soldOut: options.soldOut ?? []}),
  );
  return {
    storefront,
    cart: fake,
    env: options.env ?? ENV,
    production: true,
    zip: options.zip === undefined ? IN_ZONE : options.zip,
  };
}

async function judge(
  specs: readonly Spec[],
  options: {
    attributes?: Array<{key: string; value: string}>;
    subtotalCents?: number;
    zip?: string | null;
    env?: object;
    soldOut?: readonly string[];
  } = {},
) {
  const fake = new FakeCart(specs, {
    attributes: options.attributes ?? [],
    subtotalCents: options.subtotalCents ?? 300000,
  });
  const result = await revalidateCartGate(
    runtime(fake, options),
    fake.snapshot(),
  );
  const view = result.view;
  if (view === null) throw new Error('the cart was not judged');
  return {fake, result, view};
}

describe("gift with purchase (DEC-082): one free pillow of the shopper's choice (REQ-CART-002, REQ-PROMO-001)", () => {
  it('is offered with a queen-or-larger qualifying mattress, as a choice between the two gift pillows, in stock only', async () => {
    const {view} = await judge([line('luxe-hybrid', 'Queen')]);
    expect(view.blocked).toEqual([]);
    expect(view.gifts).toHaveLength(1);
    const [offer] = view.gifts;
    expect(offer?.ruleId).toBe('placeholder-gift-pillow');
    expect(offer?.remainingQuantity).toBe(1);
    expect(offer?.sizes.map((s) => [s.size, s.variant.variantId])).toEqual([
      ['Queen', variantId('sample-gift-pillow', 'Queen')],
      ['King', variantId('sample-gift-pillow', 'King')],
    ]);
  });

  it('hides a sold-out gift choice and keeps the other', async () => {
    const {view} = await judge([line('luxe-foam', 'King')], {
      soldOut: [variantId('sample-gift-pillow', 'King')],
    });
    expect(view.gifts[0]?.sizes.map((s) => s.size)).toEqual(['Queen']);
  });

  it('is not offered for a mattress outside the rule, whatever its size or price (the rule qualifies products, not sizes)', async () => {
    // A Queen Cloudmere costs $1299 but its product also has a Twin, so it is not listed (see sample-config.test.ts).
    const {view} = await judge([line('cloudmere-hybrid', 'Queen')]);
    expect(view.gifts).toEqual([]);
  });

  it('is not offered while the picker switch is off, and a gift already in the cart is still judged', async () => {
    const off = {OFFER_CONFIG_JSON: minifiedExampleConfig()};
    const free = await judge(
      [line('luxe-hybrid', 'Queen'), giftLine('Queen', 0)],
      {env: off},
    );
    expect(free.view.gifts).toEqual([]);
    expect(free.view.blocked).toEqual([]);
    const charged = await judge(
      [line('luxe-hybrid', 'Queen'), giftLine('Queen', 5900)],
      {env: off},
    );
    expect(charged.view.blocked.map((reason) => reason.code)).toEqual([
      'gift-not-free',
    ]);
  });

  it('is accepted at $0 and the allowance is then used up', async () => {
    const {view, fake} = await judge([
      line('luxe-hybrid', 'Queen'),
      giftLine('King', 0),
    ]);
    expect(view.blocked).toEqual([]);
    expect(view.gifts).toEqual([]);
    expect(fake.calls).toEqual([]);
  });

  it('pauses checkout when Shopify charges for the gift, naming the gift line (the discount is missing or inactive)', async () => {
    const {view} = await judge([
      line('luxe-hybrid', 'Queen'),
      giftLine('Queen', 5900),
    ]);
    expect(view.blocked).toHaveLength(1);
    expect(view.blocked[0]).toMatchObject({
      code: 'gift-not-free',
      lineIds: [lineId('sample-gift-pillow', 'Queen')],
    });
  });

  it('removes the gift when the qualifying mattress is not in the cart (orphan rule)', async () => {
    const {fake, view} = await judge([
      line('cloudmere-hybrid', 'Queen'),
      giftLine('Queen', 0),
    ]);
    expect(fake.lineIds()).not.toContain(lineId('sample-gift-pillow', 'Queen'));
    expect(view.blocked).toEqual([]);
  });

  it('keeps one gift per order: a second gift unit is cut back', async () => {
    const {fake} = await judge([
      line('luxe-hybrid', 'Queen'),
      giftLine('Queen', 0),
      line('sample-gift-pillow', 'King', {totalCents: 0}),
    ]);
    const gifts = fake
      .allSpecs()
      .filter((spec) => spec.productId === productId('sample-gift-pillow'));
    expect(gifts).toHaveLength(1);
  });
});

describe('sleep-set bundle (DEC-082): mattress + protector + pillow at 10% off (REQ-ADD-002, REQ-PROMO-002)', () => {
  const bundleCart = (title: string, kind?: 'automatic' | 'code') => [
    line('luxe-hybrid', 'Queen', {
      discountCents: 17990,
      discountTitle: title,
      ...(kind ? {discountKind: kind} : {}),
    }),
    line('sample-protector', 'Queen', {
      discountCents: 1190,
      discountTitle: title,
      ...(kind ? {discountKind: kind} : {}),
    }),
    line('sample-pillow', 'Queen', {
      discountCents: 590,
      discountTitle: title,
      ...(kind ? {discountKind: kind} : {}),
    }),
  ];

  it('offers Add all with the missing companions in the mattress size while only the mattress is in the cart', async () => {
    const {view} = await judge([line('luxe-hybrid', 'Queen')]);
    expect(view.bundles).toHaveLength(1);
    expect(view.bundles[0]).toMatchObject({
      bundleId: 'placeholder-sleep-set-luxe-hybrid',
      status: 'incomplete',
      savings: null,
    });
    expect(
      view.bundles[0]?.missing.map((m) => [m.variant.variantId, m.quantity]),
    ).toEqual([
      [variantId('sample-protector', 'Queen'), 1],
      [variantId('sample-pillow', 'Queen'), 1],
    ]);
  });

  it('asks for the protector of the smaller size on a Twin Cloudmere', async () => {
    const {view} = await judge([line('cloudmere-hybrid', 'Twin')]);
    expect(view.bundles[0]?.missing.map((m) => m.variant.variantId)).toEqual([
      variantId('sample-protector', 'Twin'),
      variantId('sample-pillow', 'Queen'),
    ]);
  });

  it("shows the saving Shopify reports for the automatic discount with the rule's title, summed over the three lines", async () => {
    const {view} = await judge(bundleCart(SLEEP_SET_TITLE));
    expect(view.bundles).toHaveLength(1);
    expect(view.bundles[0]).toMatchObject({
      status: 'complete',
      missing: [],
      savings: {amount: '197.70', currencyCode: 'USD'},
    });
  });

  it('matches the discount title ignoring capitals and extra spaces, as the admin guide says', async () => {
    const {view} = await judge(
      bundleCart('  SLEEP set 10%  off (Placeholder) '),
    );
    expect(view.bundles[0]?.savings?.amount).toBe('197.70');
  });

  it.each([
    [
      'an automatic discount with another title (a sitewide sale)',
      'Spring sale',
      undefined,
    ],
    ['a discount code', SLEEP_SET_TITLE, 'code' as const],
  ])('shows no saving for %s', async (_label, title, kind) => {
    const {view} = await judge(bundleCart(title, kind));
    expect(view.bundles).toEqual([]);
  });

  it('shows no saving when the three items are in the cart but Shopify reports no discount', async () => {
    const {view} = await judge([
      line('luxe-hybrid', 'Queen'),
      line('sample-protector', 'Queen'),
      line('sample-pillow', 'Queen'),
    ]);
    expect(view.bundles).toEqual([]);
  });

  it('counts the bundle protector towards the comfort guarantee, so the shopper is not asked twice', async () => {
    const {view} = await judge(bundleCart(SLEEP_SET_TITLE));
    expect(view.comfortGuarantee?.status).toBe('accepted');
    expect(view.nextStep).not.toBe('comfort-guarantee');
  });
});

describe('comfort-guarantee protector (REQ-PRE-002)', () => {
  it('asks for the protector of the mattress size, then is satisfied by it', async () => {
    const asked = await judge([line('luxe-foam', 'King')]);
    expect(asked.view.nextStep).toBe('comfort-guarantee');
    expect(
      asked.view.comfortGuarantee?.options.map((o) => [
        o.variant.variantId,
        o.size,
        o.quantityMissing,
      ]),
    ).toEqual([[variantId('sample-protector', 'King'), 'King', 1]]);

    const satisfied = await judge([
      line('luxe-foam', 'King'),
      line('sample-protector', 'King'),
    ]);
    expect(satisfied.view.comfortGuarantee?.status).toBe('accepted');
  });

  it('removes a protector of the wrong size, or one without a qualifying mattress', async () => {
    const wrong = await judge([
      line('luxe-foam', 'King'),
      line('sample-protector', 'Queen'),
    ]);
    expect(wrong.fake.lineIds()).not.toContain(
      lineId('sample-protector', 'Queen'),
    );
    const alone = await judge([
      line('sample-sheets', 'Queen'),
      line('sample-protector', 'Queen'),
    ]);
    expect(alone.fake.lineIds()).not.toContain(
      lineId('sample-protector', 'Queen'),
    );
  });
});

describe('matching add-ons follow the mattress size (REQ-ADD-001, REQ-CART-003)', () => {
  const mattresses: ReadonlyArray<[string, SampleSize]> = [
    ['luxe-hybrid', 'Queen'],
    ['luxe-hybrid', 'King'],
    ['luxe-hybrid', 'California King'],
    ['luxe-hybrid', 'Split California King'],
    ['luxe-foam', 'Queen'],
    ['cloudmere-hybrid', 'Twin'],
    ['cloudmere-hybrid', 'Twin XL'],
    ['cloudmere-hybrid', 'Full'],
  ];

  it.each(mattresses)(
    '%s %s: foundation and sheet set in that size, the pillow once, nothing for another size',
    (handle, size) => {
      const evaluation = evaluateOffers(
        makeCart([
          {
            id: 'mattress',
            productId: productId(handle),
            variantId: variantId(handle, size),
            size,
          },
        ]),
        rules,
        makeContext({zone}),
      );
      expect(
        evaluation.matchingAddOns.map((a) => [a.category, a.variantId]),
      ).toEqual([
        ['foundation', variantId('sample-foundation', size)],
        ['pillow', variantId('sample-pillow', 'Queen')],
        ['bedding', variantId('sample-sheets', size)],
      ]);
    },
  );

  it('offers all seven foundation sizes across the Cloudmere sizes and never a size the mattress lacks', () => {
    const offered = SIZES.map((size) => {
      const evaluation = evaluateOffers(
        makeCart([
          {
            id: 'mattress',
            productId: productId('cloudmere-hybrid'),
            variantId: variantId('cloudmere-hybrid', size),
            size,
          },
        ]),
        rules,
        makeContext({zone}),
      );
      return evaluation.matchingAddOns.find((a) => a.category === 'foundation')
        ?.variantId;
    });
    expect(offered).toEqual(
      SIZES.map((size) => variantId('sample-foundation', size)),
    );
  });

  it('does not offer an add-on already in the cart again', async () => {
    const {view} = await judge([
      line('luxe-hybrid', 'King'),
      line('sample-foundation', 'King'),
    ]);
    expect(view.addOns.map((a) => a.category)).toEqual(['pillow', 'bedding']);
  });

  it("shows the add-ons with Shopify's own prices through the gate", async () => {
    const {view} = await judge([line('luxe-hybrid', 'Queen')]);
    expect(
      view.addOns.map((a) => [a.category, a.variant.price.amount]),
    ).toEqual([
      ['foundation', '279.00'],
      ['pillow', '59.00'],
      ['bedding', '139.00'],
    ]);
  });
});

describe('haul-away (REQ-PRE-003, REQ-DEL-001)', () => {
  it('is offered in-home inside the zone, with the placeholder maximum of 2 pieces and the service price from Shopify', async () => {
    const {view} = await judge([line('luxe-hybrid', 'Queen')], {
      attributes: IN_HOME,
    });
    expect(view.haulAway).toMatchObject({
      status: 'pending',
      maxPieces: 2,
      currentQuantity: 0,
    });
    expect(view.haulAway?.variant.variantId).toBe(
      variantId(HAUL_HANDLE, 'Twin'),
    );
    expect(view.haulAway?.variant.price.amount).toBe('49.00');
    expect(view.haulAway?.variant.variantTitle).toBeNull();
  });

  it('asks the delivery question first, and not at all outside the zone', async () => {
    const inside = await judge([line('luxe-hybrid', 'Queen')]);
    expect(inside.view.deliveryChoice?.status).toBe('pending');
    const outside = await judge([line('luxe-hybrid', 'Queen')], {
      zip: OUT_OF_ZONE,
    });
    expect(outside.view.deliveryChoice).toBeNull();
    expect(outside.view.haulAway).toBeNull();
  });

  it('cuts a quantity above the maximum back to 2 and leaves 2 alone', async () => {
    const over = await judge([line('luxe-hybrid', 'Queen'), haulLine(3)], {
      attributes: IN_HOME,
    });
    expect(over.fake.quantityOf(lineId(HAUL_HANDLE, null))).toBe(2);
    expect(over.view.blocked).toEqual([]);

    const exact = await judge([line('luxe-hybrid', 'Queen'), haulLine(2)], {
      attributes: IN_HOME,
    });
    expect(exact.fake.quantityOf(lineId(HAUL_HANDLE, null))).toBe(2);
    expect(exact.fake.calls).toEqual([]);
    expect(exact.view.haulAway?.status).toBe('accepted');
  });

  it.each([
    [
      'store pickup',
      {attributes: [{key: 'delivery_choice', value: 'pickup'}]},
      'pickup-selected',
    ],
    ['no delivery choice', {}, 'delivery-not-chosen'],
    [
      'a ZIP outside the zone',
      {attributes: IN_HOME, zip: OUT_OF_ZONE},
      'outside-zone',
    ],
    ['no saved ZIP', {attributes: IN_HOME, zip: null}, 'zip-missing'],
  ])(
    'refuses the hand-off with a haul-away line for %s and repairs nothing',
    async (_label, options, _reason) => {
      const {view, fake} = await judge(
        [line('luxe-hybrid', 'Queen'), haulLine(1)],
        options,
      );
      expect(view.blocked.map((reason) => reason.code)).toContain(
        'haul-away-not-eligible',
      );
      expect(fake.quantityOf(lineId(HAUL_HANDLE, null))).toBe(1);
      expect(fake.calls).toEqual([]);
    },
  );

  it('reports the exact reason in the engine', () => {
    const cart = makeCart([
      {
        id: 'mattress',
        productId: productId('luxe-hybrid'),
        variantId: variantId('luxe-hybrid', 'Queen'),
        size: 'Queen',
      },
      {
        id: 'haul',
        productId: productId(HAUL_HANDLE),
        variantId: variantId(HAUL_HANDLE, 'Twin'),
      },
    ]);
    const reasons = [
      makeContext({zone, zip: OUT_OF_ZONE}),
      makeContext({zone, zip: IN_ZONE, deliveryChoice: 'pickup'}),
      makeContext({zone, zip: null}),
    ].map(
      (context) =>
        evaluateOffers(cart, rules, context).violations.map((v) =>
          v.code === 'haul-away-not-eligible' ? v.reason : v.code,
        )[0],
    );
    expect(reasons).toEqual(['outside-zone', 'pickup-selected', 'zip-missing']);
  });
});

describe('free-delivery message (REQ-CART-004)', () => {
  const progressFor = (subtotalCents: number) =>
    evaluateOffers(makeCart([], {subtotalCents}), rules, makeContext({zone}))
      .freeDelivery;

  it('counts down to the placeholder threshold of $999 and says when it is reached, at the threshold itself', () => {
    const below = progressFor(89_900);
    expect(below).toMatchObject({
      enabled: true,
      thresholdCents: 99_900,
      remainingCents: 10_000,
      reached: false,
    });
    expect(freeDeliveryMessage(below)).toBe(
      'You are $100 away from free delivery.',
    );
    const at = progressFor(99_900);
    expect(at).toMatchObject({enabled: true, reached: true, percent: 100});
    expect(freeDeliveryMessage(at)).toBe('You have unlocked free delivery.');
  });

  it('reads the subtotal Shopify reports for the cart through the gate', async () => {
    const small = await judge([line('sample-sheets', 'Twin')], {
      subtotalCents: payable('sample-sheets', 'Twin'),
    });
    expect(small.view.freeDelivery).toMatchObject({
      enabled: true,
      reached: false,
      remainingCents: 99_900 - 8_900,
    });
    // A $999 Twin Cloudmere sits exactly on the threshold: free delivery starts AT the threshold.
    const exact = await judge([line('cloudmere-hybrid', 'Twin')], {
      subtotalCents: payable('cloudmere-hybrid', 'Twin'),
    });
    expect(exact.view.freeDelivery).toMatchObject({
      enabled: true,
      reached: true,
    });
  });
});

describe('the example configuration does not pause checkout (DEC-030)', () => {
  it('judges a mixed cart in production without blocking or repairing it', async () => {
    const {view, fake, result} = await judge(
      [
        line('luxe-hybrid', 'King'),
        line('sample-protector', 'King'),
        line('sample-pillow', 'Queen'),
        giftLine('Queen', 0),
        haulLine(2),
      ],
      {attributes: IN_HOME},
    );
    expect(result.check?.status).toBe('ok');
    expect(view.blocked).toEqual([]);
    expect(fake.calls).toEqual([]);
  });
});
