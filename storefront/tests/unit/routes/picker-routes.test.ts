import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {fakeStorefront} from '../catalog/fake-storefront';
import {action as cartAction, loader as cartLoader} from '~/routes/cart';
import {loader as stepsLoader} from '~/routes/checkout-steps';
import {
  ADD_ADDON_ACTION,
  ADD_BUNDLE_ACTION,
  ADD_GIFT_ACTION,
} from '~/lib/cart/custom-actions';
import {PICKER_STEP_FAILURE_TEXT} from '~/lib/offers-runtime/messages';
import type {CartLineAddInput} from '~/lib/offers-runtime/server';
import {
  CONFIG,
  FakeCart,
  GID,
  MATTRESS_LINE,
  storefrontResponder,
} from '~/lib/offers-runtime/test-fixtures';

// REQ-CART-002 / REQ-CART-003 / REQ-ADD-002 / REQ-PROMO-001 / T-01 / T-02: the real `/cart` and `/checkout-steps` route
// functions for the three picker actions, against an in-memory cart and a fake Storefront (mock-green only: no
// development store exists, so no Shopify discount has ever priced these lines).

const ORIGIN = 'http://localhost:3000';
const RULES = {
  ...CONFIG.rules,
  comfortGuarantee: undefined,
  gifts: [
    {
      id: 'gift-pillow',
      name: 'Free pillow',
      qualifyingProductIds: [GID.mattress],
      giftVariantIdsBySize: {Standard: GID.gift, Plush: GID.giftAlt},
      maxQuantity: 1,
    },
  ],
  bundles: [
    {
      id: 'sleep-set',
      name: 'Sleep set',
      anchorProductId: GID.mattress,
      members: [
        {
          productId: GID.foundation,
          quantity: 1,
          variants: {
            type: 'by-size',
            variantIdBySize: {Queen: GID.foundationQueen},
          },
        },
        {
          productId: GID.pillow,
          quantity: 2,
          variants: {type: 'single', variantId: GID.pillowVariant},
        },
      ],
    },
  ],
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
  PUBLIC_GIFT_PICKER_ENABLED: 'true',
};

class PartialCart extends FakeCart {
  override addLines(lines: CartLineAddInput[]) {
    const [first] = lines;
    if (first) void super.addLines([first]);
    return Promise.resolve({
      cart: this.snapshot(),
      userErrors: [{message: 'One line could not be added'}],
    });
  }
}

function contextFor(fake: FakeCart) {
  const {storefront} = fakeStorefront(storefrontResponder());
  return {
    storefront,
    env: ENV,
    cart: {
      get: () => fake.get(),
      removeLines: (ids: string[]) => fake.removeLines(ids),
      updateLines: (
        lines: Array<{id: string; quantity: number; merchandiseId?: string}>,
      ) => fake.updateLines(lines),
      addLines: (lines: CartLineAddInput[]) => fake.addLines(lines),
      updateAttributes: (attributes: Array<{key: string; value: string}>) =>
        fake.updateAttributes(attributes),
      setCartId: () => new Headers(),
      create: () => Promise.resolve({cart: {id: 'gid://shopify/Cart/new'}}),
    },
  };
}

function args(request: Request, context: object) {
  // Route.*Args are framework-generated; only request, context and params are used (test-only narrowing, as in cart-routes.test.ts).
  return {request, context, params: {}} as never;
}

function post(action: string, inputs: unknown, headers: HeadersInit = {}) {
  const form = new FormData();
  form.set('cartFormInput', JSON.stringify({action, inputs}));
  return new Request(`${ORIGIN}/cart`, {method: 'POST', body: form, headers});
}

function unwrap(result: unknown): {
  data: Record<string, unknown>;
  status: number;
} {
  if (
    typeof result === 'object' &&
    result !== null &&
    'data' in result &&
    'init' in result
  ) {
    const {data, init} = result;
    const status =
      typeof init === 'object' && init !== null && 'status' in init
        ? Number(init.status)
        : 200;
    if (typeof data === 'object' && data !== null) {
      return {data: Object.fromEntries(Object.entries(data)), status};
    }
  }
  throw new Error(`Not a data() result: ${String(result)}`);
}

function messagesOf(list: unknown): string[] {
  return Array.isArray(list)
    ? list.flatMap((entry: unknown) =>
        typeof entry === 'object' &&
        entry !== null &&
        'message' in entry &&
        typeof entry.message === 'string'
          ? [entry.message]
          : [],
      )
    : [];
}

function offersOf(data: Record<string, unknown>) {
  const offers = data.offers;
  if (typeof offers !== 'object' || offers === null) {
    throw new Error('No offers view in the answer');
  }
  return Object.fromEntries(Object.entries(offers));
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('gift picker through /cart (REQ-CART-002)', () => {
  it('adds the chosen gift and answers with the refreshed view', async () => {
    const fake = new FakeCart([MATTRESS_LINE]);
    const {data, status} = unwrap(
      await cartAction(
        args(
          post(ADD_GIFT_ACTION, {
            ruleId: 'gift-pillow',
            variantId: GID.giftAlt,
          }),
          contextFor(fake),
        ),
      ),
    );
    expect(status).toBe(200);
    expect(messagesOf(data.errors)).toEqual([]);
    expect(fake.allSpecs().map((spec) => spec.variantId)).toContain(
      GID.giftAlt,
    );
    expect(offersOf(data).gifts).toEqual([]);
  });

  it('a forged variant answers 400 with a fixed message and changes nothing', async () => {
    const fake = new FakeCart([MATTRESS_LINE]);
    const {data, status} = unwrap(
      await cartAction(
        args(
          post(ADD_GIFT_ACTION, {
            ruleId: 'gift-pillow',
            variantId: GID.otherVariant,
            quantity: 40,
          }),
          contextFor(fake),
        ),
      ),
    );
    expect(status).toBe(400);
    expect(messagesOf(data.errors)).toEqual([
      PICKER_STEP_FAILURE_TEXT['gift-choice-invalid'],
    ]);
    expect(fake.lineIds()).toEqual([MATTRESS_LINE.id]);
  });

  it('a malformed request answers 400 before anything is read from Shopify', async () => {
    const fake = new FakeCart([MATTRESS_LINE]);
    const {status} = unwrap(
      await cartAction(
        args(
          post(ADD_GIFT_ACTION, {ruleId: 7, variantId: 'nope'}),
          contextFor(fake),
        ),
      ),
    );
    expect(status).toBe(400);
    expect(fake.calls).toEqual([]);
  });

  it('refuses a cross-site post', async () => {
    const fake = new FakeCart([MATTRESS_LINE]);
    const response = await cartAction(
      args(
        post(
          ADD_GIFT_ACTION,
          {ruleId: 'gift-pillow', variantId: GID.gift},
          {Origin: 'https://evil.example'},
        ),
        contextFor(fake),
      ),
    );
    expect(unwrap(response).status).toBe(403);
    expect(fake.calls).toEqual([]);
  });

  it('shows a gift Shopify does not price at 0 as a reason to pause checkout, in the answer, the cart page and the hand-off', async () => {
    const fake = new FakeCart([MATTRESS_LINE]);
    fake.giftDiscountLive = false;
    const answer = unwrap(
      await cartAction(
        args(
          post(ADD_GIFT_ACTION, {
            ruleId: 'gift-pillow',
            variantId: GID.gift,
          }),
          contextFor(fake),
        ),
      ),
    );
    const blocked = offersOf(answer.data).blocked;
    expect(blocked).toEqual([expect.objectContaining({code: 'gift-not-free'})]);

    const page = unwrap(
      await cartLoader(args(new Request(`${ORIGIN}/cart`), contextFor(fake))),
    );
    expect(offersOf(page.data).blocked).toEqual(blocked);

    const steps = unwrap(
      await stepsLoader(
        args(new Request(`${ORIGIN}/checkout-steps`), contextFor(fake)),
      ),
    );
    expect(steps.data).toMatchObject({
      state: 'blocked',
      reasons: [expect.objectContaining({code: 'gift-not-free'})],
    });
  });
});

describe('add-on picker through /cart (REQ-CART-003)', () => {
  it('adds a size-matched add-on and refuses the wrong size', async () => {
    const fake = new FakeCart([MATTRESS_LINE]);
    const ok = unwrap(
      await cartAction(
        args(
          post(ADD_ADDON_ACTION, {variantId: GID.foundationQueen}),
          contextFor(fake),
        ),
      ),
    );
    expect(ok.status).toBe(200);
    const wrong = unwrap(
      await cartAction(
        args(
          post(ADD_ADDON_ACTION, {variantId: GID.foundationKing}),
          contextFor(fake),
        ),
      ),
    );
    expect(wrong.status).toBe(400);
    expect(messagesOf(wrong.data.errors)).toEqual([
      PICKER_STEP_FAILURE_TEXT['addon-not-offered'],
    ]);
    expect(fake.allSpecs().map((spec) => spec.variantId)).toEqual([
      GID.mattressQueen,
      GID.foundationQueen,
    ]);
  });
});

describe('bundle picker through /cart (REQ-ADD-002)', () => {
  it('lists the bundle on the cart page, then adds every missing companion in one request', async () => {
    const fake = new FakeCart([MATTRESS_LINE]);
    const page = unwrap(
      await cartLoader(args(new Request(`${ORIGIN}/cart`), contextFor(fake))),
    );
    expect(offersOf(page.data).bundles).toEqual([
      expect.objectContaining({status: 'incomplete', bundleId: 'sleep-set'}),
    ]);

    const {data, status} = unwrap(
      await cartAction(
        args(
          post(ADD_BUNDLE_ACTION, {
            bundleId: 'sleep-set',
            anchorLineId: MATTRESS_LINE.id,
          }),
          contextFor(fake),
        ),
      ),
    );
    expect(status).toBe(200);
    expect(messagesOf(data.errors)).toEqual([]);
    expect(fake.allSpecs().map((spec) => spec.variantId)).toEqual([
      GID.mattressQueen,
      GID.foundationQueen,
      GID.pillowVariant,
    ]);
    // Complete and Shopify reports no saving (no discount exists): nothing is shown, no number is invented.
    expect(offersOf(data).bundles).toEqual([]);
  });

  it('says so when only part of the set was added', async () => {
    const fake = new PartialCart([MATTRESS_LINE]);
    const {data} = unwrap(
      await cartAction(
        args(
          post(ADD_BUNDLE_ACTION, {
            bundleId: 'sleep-set',
            anchorLineId: MATTRESS_LINE.id,
          }),
          contextFor(fake),
        ),
      ),
    );
    expect(messagesOf(data.warnings)).toContain(
      PICKER_STEP_FAILURE_TEXT['bundle-partial'],
    );
  });

  it('a forged anchor answers 400 and adds nothing', async () => {
    const fake = new FakeCart([MATTRESS_LINE]);
    const {data, status} = unwrap(
      await cartAction(
        args(
          post(ADD_BUNDLE_ACTION, {
            bundleId: 'sleep-set',
            anchorLineId: 'gid://shopify/CartLine/forged',
          }),
          contextFor(fake),
        ),
      ),
    );
    expect(status).toBe(400);
    expect(messagesOf(data.errors)).toEqual([
      PICKER_STEP_FAILURE_TEXT['bundle-not-offered'],
    ]);
    expect(fake.lineIds()).toEqual([MATTRESS_LINE.id]);
  });
});
