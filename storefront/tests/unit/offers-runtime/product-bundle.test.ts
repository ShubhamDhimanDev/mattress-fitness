import {describe, expect, it} from 'vitest';
import {fakeStorefront} from '../catalog/fake-storefront';
import {validateAddProductBundle} from '~/lib/cart/actions';
import {
  bundleCompanionsForSize,
  bundleOfferedSizes,
} from '~/lib/offers/bundles';
import type {BundleRule} from '~/lib/offers/types';
import {PICKER_STEP_FAILURE_TEXT} from '~/lib/offers-runtime/messages';
import {
  readBundleSavings,
  readProductBundleAnswer,
  setForSize,
  setInCart,
  type ProductBundleSet,
} from '~/lib/offers-runtime/product-bundle';
import {
  loadProductBundle,
  productHasBundle,
} from '~/lib/offers-runtime/product-bundle-server';
import {addProductBundle} from '~/lib/offers-runtime/picker-steps';
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

// REQ-ADD-002 / REQ-PROMO-002 / REQ-CAT-008 / T-01 / T-02 (P4-06): the product page's "Frequently bought together" card.
// Pure rules (which companions in which size), the server read that lists the in-stock sets, the revalidated Add-all
// action, and the readers for the browser. Mock-green only: nothing here has run against a development store, and the
// Shopify discount that makes the set cheaper does not exist on any store yet (V-03).

const RULE: BundleRule = {
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
        variantIdBySize: {Queen: GID.foundationQueen, King: GID.foundationKing},
      },
    },
    {
      productId: GID.pillow,
      quantity: 2,
      variants: {type: 'single', variantId: GID.pillowVariant},
    },
  ],
};
const ENV = {
  OFFER_CONFIG_JSON: JSON.stringify({
    ...CONFIG,
    rules: {...CONFIG.rules, comfortGuarantee: undefined, bundles: [RULE]},
  }),
};

function runtime(
  fake: FakeCart,
  options: {env?: object; soldOut?: string[]} = {},
): OfferRuntime {
  const {storefront} = fakeStorefront(
    storefrontResponder({soldOut: options.soldOut ?? []}),
  );
  return {
    storefront,
    cart: fake,
    env: options.env ?? ENV,
    production: true,
  };
}

const addCalls = (fake: FakeCart) =>
  fake.calls.filter((call) => call.method === 'addLines');

const input = (
  anchorVariantId: string = GID.mattressQueen,
  bundleId: string = RULE.id,
) => ({
  bundleId,
  anchorVariantId,
});

function codeOf(result: Awaited<ReturnType<typeof addProductBundle>>): string {
  return result.status === 'rejected' ? result.code : 'ok';
}

describe('bundle companions per size (REQ-ADD-002)', () => {
  it('lists the sizes the rule is written for, or one size-independent entry', () => {
    expect(bundleOfferedSizes(RULE)).toEqual(['Queen', 'King']);
    const sizeless: BundleRule = {
      ...RULE,
      members: RULE.members.slice(1),
    };
    expect(bundleOfferedSizes(sizeless)).toEqual([null]);
  });

  it('gives every companion in the size, with the rule quantities and no price', () => {
    expect(bundleCompanionsForSize(RULE, ' queen ')).toEqual([
      {productId: GID.foundation, variantId: GID.foundationQueen, quantity: 1},
      {productId: GID.pillow, variantId: GID.pillowVariant, quantity: 2},
    ]);
  });

  it.each([
    ['a size no companion is offered in', 'Twin'],
    ['no size at all (a by-size companion cannot resolve)', null],
  ])('offers no set for %s (all or nothing)', (_name, size) => {
    expect(bundleCompanionsForSize(RULE, size)).toBeNull();
  });

  it('offers no set for an invalid rule (quantity 0 or 1000)', () => {
    for (const quantity of [0, 1000]) {
      const [first, ...rest] = RULE.members;
      if (!first) throw new Error('fixture');
      expect(
        bundleCompanionsForSize(
          {...RULE, members: [{...first, quantity}, ...rest]},
          'Queen',
        ),
      ).toBeNull();
    }
    expect(bundleCompanionsForSize({...RULE, members: []}, 'Queen')).toBeNull();
  });

  it('adds up two members that resolve to one variant', () => {
    const pillow = RULE.members[1];
    if (!pillow) throw new Error('fixture');
    expect(
      bundleCompanionsForSize({...RULE, members: [pillow, pillow]}, null),
    ).toEqual([
      {productId: GID.pillow, variantId: GID.pillowVariant, quantity: 4},
    ]);
  });
});

describe('productHasBundle / loadProductBundle (REQ-ADD-002, REQ-CAT-008)', () => {
  it('is true for the anchor product only, with no Shopify read', () => {
    expect(productHasBundle(ENV, GID.mattress)).toBe(true);
    // A companion's own page does not show the card.
    expect(productHasBundle(ENV, GID.foundation)).toBe(false);
    expect(productHasBundle(ENV, GID.other)).toBe(false);
    expect(productHasBundle({}, GID.mattress)).toBe(false);
    expect(
      productHasBundle({...ENV, OFFERS_ENABLED: 'false'}, GID.mattress),
    ).toBe(false);
  });

  it('lists one set per size with Shopify variants and quantities, and reads once', async () => {
    const {storefront, calls} = fakeStorefront(storefrontResponder());
    const answer = await loadProductBundle(storefront, ENV, GID.mattress);
    expect(answer).toMatchObject({
      status: 'ok',
      bundle: {
        bundleId: 'sleep-set',
        sets: [
          {
            size: 'Queen',
            items: [
              {quantity: 1, variant: {variantId: GID.foundationQueen}},
              {quantity: 2, variant: {variantId: GID.pillowVariant}},
            ],
          },
          {
            size: 'King',
            items: [
              {quantity: 1, variant: {variantId: GID.foundationKing}},
              {quantity: 2, variant: {variantId: GID.pillowVariant}},
            ],
          },
        ],
      },
    });
    expect(calls).toHaveLength(1);
    // Prices are Shopify's, passed through as strings; the server added no number of its own.
    expect(JSON.stringify(answer)).not.toMatch(/saving|total|discount/i);
  });

  it('drops a size whose set has a sold-out companion, and keeps the others', async () => {
    const {storefront} = fakeStorefront(
      storefrontResponder({soldOut: [GID.foundationKing]}),
    );
    const answer = await loadProductBundle(storefront, ENV, GID.mattress);
    expect(answer).toMatchObject({
      status: 'ok',
      bundle: {sets: [{size: 'Queen'}]},
    });
    expect(answer.status === 'ok' && answer.bundle?.sets).toHaveLength(1);
  });

  it('shows nothing when every size has a sold-out companion', async () => {
    const {storefront} = fakeStorefront(
      storefrontResponder({soldOut: [GID.pillowVariant]}),
    );
    expect(await loadProductBundle(storefront, ENV, GID.mattress)).toEqual({
      status: 'ok',
      bundle: null,
    });
  });

  it('shows nothing, with no Shopify read, for a product that anchors no bundle', async () => {
    const {storefront, calls} = fakeStorefront(storefrontResponder());
    expect(await loadProductBundle(storefront, ENV, GID.other)).toEqual({
      status: 'ok',
      bundle: null,
    });
    expect(calls).toEqual([]);
  });

  it('says unavailable, never an empty answer, when the Shopify read fails', async () => {
    const {storefront} = fakeStorefront(() => {
      throw new Error('upstream down');
    });
    expect(await loadProductBundle(storefront, ENV, GID.mattress)).toEqual({
      status: 'unavailable',
    });
  });
});

describe('addProductBundle (REQ-ADD-002, T-01)', () => {
  it('adds the viewed variant and every companion in its size in ONE call, with rule quantities', async () => {
    const fake = new FakeCart([]);
    const result = await addProductBundle(runtime(fake), null, input());
    expect(result.status).toBe('ok');
    expect(addCalls(fake)).toEqual([
      {
        method: 'addLines',
        lines: [
          {merchandiseId: GID.mattressQueen, quantity: 1},
          {merchandiseId: GID.foundationQueen, quantity: 1},
          {merchandiseId: GID.pillowVariant, quantity: 2},
        ],
      },
    ]);
  });

  it('uses the size Shopify reports for the anchor variant: King adds the King foundation', async () => {
    const fake = new FakeCart([]);
    await addProductBundle(runtime(fake), null, input(GID.mattressKing));
    expect(
      addCalls(fake).flatMap((call) =>
        'lines' in call && Array.isArray(call.lines) ? call.lines : [],
      ),
    ).toEqual([
      {merchandiseId: GID.mattressKing, quantity: 1},
      {merchandiseId: GID.foundationKing, quantity: 1},
      {merchandiseId: GID.pillowVariant, quantity: 2},
    ]);
  });

  it('adds only what the cart does not hold yet', async () => {
    const fake = new FakeCart([
      MATTRESS_LINE,
      {
        id: 'gid://shopify/CartLine/p',
        variantId: GID.pillowVariant,
        productId: GID.pillow,
        quantity: 2,
      },
    ]);
    await addProductBundle(runtime(fake), fake.snapshot(), input());
    expect(addCalls(fake)).toEqual([
      {
        method: 'addLines',
        lines: [{merchandiseId: GID.foundationQueen, quantity: 1}],
      },
    ]);
  });

  it('refuses when the whole set is already in the cart, so a repeat cannot double it', async () => {
    const fake = new FakeCart([MATTRESS_LINE]);
    await addProductBundle(runtime(fake), fake.snapshot(), input());
    const again = await addProductBundle(
      runtime(fake),
      fake.snapshot(),
      input(),
    );
    expect(codeOf(again)).toBe('bundle-already-in-cart');
    expect(addCalls(fake)).toHaveLength(1);
  });

  it.each([
    ['a bundle id that does not exist', input(GID.mattressQueen, 'forged')],
    ['an anchor variant of another product', input(GID.otherVariant)],
    ['a companion variant as the anchor', input(GID.foundationQueen)],
    ['a gift variant as the anchor', input(GID.gift)],
    ['a protector variant as the anchor', input(GID.protectorQueen)],
    ['the haul-away variant as the anchor', input(GID.haulVariant)],
  ])('refuses %s and adds nothing', async (_name, request) => {
    const fake = new FakeCart([]);
    const result = await addProductBundle(runtime(fake), null, request);
    expect(codeOf(result)).toBe('bundle-not-offered');
    expect(addCalls(fake)).toEqual([]);
  });

  it('refuses the whole set when one member is sold out (no partial set, no saving without all of it)', async () => {
    const fake = new FakeCart([]);
    const result = await addProductBundle(
      runtime(fake, {soldOut: [GID.pillowVariant]}),
      null,
      input(),
    );
    expect(codeOf(result)).toBe('bundle-not-offered');
    expect(addCalls(fake)).toEqual([]);
  });

  it('refuses when the viewed size is sold out', async () => {
    const fake = new FakeCart([]);
    const result = await addProductBundle(
      runtime(fake, {soldOut: [GID.mattressQueen]}),
      null,
      input(),
    );
    expect(codeOf(result)).toBe('bundle-not-offered');
    expect(addCalls(fake)).toEqual([]);
  });

  it('refuses when a companion has no variant in the viewed size', async () => {
    const queenOnly: BundleRule = {
      ...RULE,
      members: [
        {
          productId: GID.foundation,
          quantity: 1,
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
        rules: {...CONFIG.rules, bundles: [queenOnly]},
      }),
    };
    const fake = new FakeCart([]);
    const result = await addProductBundle(
      runtime(fake, {env}),
      null,
      input(GID.mattressKing),
    );
    expect(codeOf(result)).toBe('bundle-not-offered');
    expect(addCalls(fake)).toEqual([]);
  });

  it('fails closed in production without the offer configuration', async () => {
    const fake = new FakeCart([]);
    const result = await addProductBundle(
      runtime(fake, {env: {}}),
      null,
      input(),
    );
    expect(codeOf(result)).toBe('unverified');
    expect(addCalls(fake)).toEqual([]);
  });

  it('adds nothing when the cart changed after it was judged (two tabs)', async () => {
    class RacingCart extends FakeCart {
      private raced = false;
      override get() {
        if (!this.raced) {
          this.raced = true;
          void super.addLines([{merchandiseId: GID.otherVariant, quantity: 1}]);
        }
        return super.get();
      }
    }
    const fake = new RacingCart([MATTRESS_LINE]);
    const result = await addProductBundle(
      runtime(fake),
      fake.snapshot(),
      input(),
    );
    expect(codeOf(result)).toBe('cart-changed');
    expect(addCalls(fake)).toHaveLength(1);
  });

  it('starts a fresh cart with the same lines when the cart cookie is stale', async () => {
    class StaleCart extends FakeCart {
      private first = true;
      override addLines(
        lines: CartLineAddInput[],
      ): Promise<CartMutationResult> {
        if (!this.first) return super.addLines(lines);
        this.first = false;
        this.calls.push({method: 'addLines', lines});
        // Shopify answers a stale cart id with no cart and no error.
        return Promise.resolve({cart: null});
      }
    }
    const fake = new StaleCart([]);
    const created: CartLineAddInput[][] = [];
    const result = await addProductBundle(
      runtime(fake),
      null,
      input(),
      (request) => {
        created.push(request.lines);
        return fake.addLines(request.lines);
      },
    );
    expect(created).toEqual([
      [
        {merchandiseId: GID.mattressQueen, quantity: 1},
        {merchandiseId: GID.foundationQueen, quantity: 1},
        {merchandiseId: GID.pillowVariant, quantity: 2},
      ],
    ]);
    expect(result.status).toBe('ok');
    expect(fake.lineIds()).toHaveLength(3);
  });

  it('reports a total failure and changes nothing', async () => {
    const fake = new FakeCart([]);
    fake.failNext = true;
    const result = await addProductBundle(runtime(fake), null, input());
    expect(codeOf(result)).toBe('bundle-add-failed');
    expect(fake.lineIds()).toEqual([]);
  });

  it('reports a partial add from the cart read back, not from the mutation answer', async () => {
    class PartialCart extends FakeCart {
      override addLines(
        lines: CartLineAddInput[],
      ): Promise<CartMutationResult> {
        const [first] = lines;
        if (first) void super.addLines([first]);
        return Promise.resolve({
          cart: this.snapshot(),
          userErrors: [{message: 'One line could not be added'}],
        });
      }
    }
    const fake = new PartialCart([]);
    const result = await addProductBundle(runtime(fake), null, input());
    expect(result.status).toBe('ok');
    expect(result.status === 'ok' && result.warning).toBe('bundle-partial');
  });

  it('has a fixed refusal text for an already-complete set', () => {
    expect(PICKER_STEP_FAILURE_TEXT['bundle-already-in-cart']).toMatch(
      /already in your cart/,
    );
  });
});

describe('validateAddProductBundle (T-01)', () => {
  it('keeps the bundle id and the variant id and drops a quantity, a price, lines and a discount', () => {
    expect(
      validateAddProductBundle({
        bundleId: 'sleep-set',
        anchorVariantId: GID.mattressQueen,
        quantity: 50,
        price: '0.00',
        discount: 'FREE',
        lines: [{merchandiseId: GID.otherVariant, quantity: 9}],
      }),
    ).toEqual({
      status: 'ok',
      value: {bundleId: 'sleep-set', anchorVariantId: GID.mattressQueen},
    });
  });

  it.each([
    ['no input', undefined],
    ['an array', []],
    ['no bundle id', {anchorVariantId: GID.mattressQueen}],
    ['an empty bundle id', {bundleId: '', anchorVariantId: GID.mattressQueen}],
    [
      'a bundle id with a control character',
      {bundleId: 'a\nb', anchorVariantId: GID.mattressQueen},
    ],
    [
      'a far too long bundle id',
      {bundleId: 'x'.repeat(500), anchorVariantId: GID.mattressQueen},
    ],
    [
      'a product id as the variant',
      {bundleId: 'b', anchorVariantId: GID.mattress},
    ],
    [
      'a cart line id as the variant',
      {bundleId: 'b', anchorVariantId: MATTRESS_LINE.id},
    ],
    ['a number as the variant', {bundleId: 'b', anchorVariantId: 11}],
  ])('refuses %s', (_name, raw) => {
    expect(validateAddProductBundle(raw).status).toBe('invalid');
  });
});

describe('what the browser reads (REQ-ADD-002)', () => {
  const item = (id: string, quantity = 1) => ({
    quantity,
    variant: {
      variantId: id,
      productTitle: 'Thing',
      productHandle: 'thing',
      variantTitle: null,
      price: {amount: '10.00', currencyCode: 'USD'},
    },
  });
  const sets: ProductBundleSet[] = [
    {size: 'Queen', items: [item(GID.foundationQueen)]},
    {size: 'King', items: [item(GID.foundationKing)]},
    {size: null, items: [item(GID.pillowVariant)]},
  ];

  it('picks the set by normalised size, falls back to the size-independent set, and never guesses', () => {
    expect(setForSize(sets, ' king ')?.size).toBe('King');
    expect(setForSize(sets, 'Twin')?.size).toBeNull();
    expect(setForSize(sets, null)?.size).toBeNull();
    expect(setForSize(sets.slice(0, 2), 'Twin')).toBeNull();
    expect(setForSize(sets.slice(0, 2), null)).toBeNull();
  });

  it('knows the set is in the cart only when the exact anchor variant and every companion are there', () => {
    const [queen] = sets;
    if (!queen) throw new Error('fixture');
    const all = new Set([GID.mattressQueen, GID.foundationQueen]);
    expect(setInCart(all, GID.mattressQueen, queen)).toBe(true);
    expect(setInCart(all, GID.mattressKing, queen)).toBe(false);
    expect(
      setInCart(new Set([GID.mattressQueen]), GID.mattressQueen, queen),
    ).toBe(false);
    expect(setInCart(null, GID.mattressQueen, queen)).toBe(false);
  });

  it('reads a good answer and drops a malformed set instead of half-showing it', () => {
    const good = {
      status: 'ok',
      bundle: {
        bundleId: 'b',
        sets: [
          {size: 'Queen', items: [item(GID.foundationQueen, 2)]},
          {size: 'King', items: [{quantity: 0, variant: item('x').variant}]},
          {size: 'Twin', items: [item('not-a-variant-id')]},
          {size: 5, items: [item(GID.foundationKing)]},
        ],
      },
    };
    const answer = readProductBundleAnswer(good);
    expect(answer?.bundle?.sets.map((set) => set.size)).toEqual(['Queen']);
    expect(readProductBundleAnswer({status: 'ok', bundle: null})).toEqual({
      status: 'ok',
      bundle: null,
    });
    expect(
      readProductBundleAnswer({
        status: 'ok',
        bundle: {bundleId: 'b', sets: [{size: 'King', items: []}]},
      }),
    ).toEqual({status: 'ok', bundle: null});
  });

  it.each([
    ['not an object', 'ok'],
    ['an error body', {status: 'unavailable'}],
    ['no bundle key', {status: 'ok'}],
    ['a bundle without sets', {status: 'ok', bundle: {bundleId: 'b'}}],
  ])('treats %s as an error the card can retry', (_name, body) => {
    expect(readProductBundleAnswer(body)).toBeNull();
  });

  describe("readBundleSavings: only Shopify's figure, only for a complete bundle", () => {
    const result = (bundles: unknown) => ({
      cart: null,
      errors: [],
      warnings: [],
      analytics: {cartId: undefined},
      offers: {bundles},
    });
    const money = {amount: '85.00', currencyCode: 'USD'};

    it('returns the figure Shopify reported for the bundle', () => {
      expect(
        readBundleSavings(
          result([{bundleId: 'sleep-set', status: 'complete', savings: money}]),
          'sleep-set',
        ),
      ).toEqual(money);
    });

    it.each([
      [
        'no savings reported',
        [{bundleId: 'sleep-set', status: 'complete', savings: null}],
      ],
      [
        'an incomplete bundle',
        [{bundleId: 'sleep-set', status: 'incomplete', savings: money}],
      ],
      [
        'another bundle',
        [{bundleId: 'other', status: 'complete', savings: money}],
      ],
      [
        'a malformed figure',
        [
          {
            bundleId: 'sleep-set',
            status: 'complete',
            savings: {amount: 85, currencyCode: 'USD'},
          },
        ],
      ],
      ['no bundles list', undefined],
    ])('returns nothing for %s (no number is invented)', (_name, bundles) => {
      expect(readBundleSavings(result(bundles), 'sleep-set')).toBeNull();
    });

    it('returns nothing for data that is not a cart action result', () => {
      expect(readBundleSavings(undefined, 'sleep-set')).toBeNull();
      expect(
        readBundleSavings({offers: {bundles: []}}, 'sleep-set'),
      ).toBeNull();
    });
  });
});
