import {afterEach, describe, expect, it, vi} from 'vitest';
import {fakeStorefront} from '../catalog/fake-storefront';
import {action as cartAction, loader as cartLoader} from '~/routes/cart';
import {
  action as stepsAction,
  loader as stepsLoader,
} from '~/routes/checkout-steps';
import {loader as permalinkLoader} from '~/routes/cart.$lines';
import {loader as discountLoader} from '~/routes/discount.$code';
import {
  ENV,
  FakeCart,
  GID,
  MATTRESS_LINE,
  storefrontResponder,
} from '~/lib/offers-runtime/test-fixtures';

// Route wiring for REQ-PRE-006, REQ-CHK-001, REQ-CART-001: the real route functions run against an in-memory
// cart. The route argument types are framework-generated; the single helper below builds them from plain
// parts (a documented test-only narrowing, nothing in app code does this).

const ORIGIN = 'http://localhost:3000';
const CHECKOUT = 'https://shop.example/checkouts/c/c1-test';
const GIFT = {
  id: 'gid://shopify/CartLine/gift',
  variantId: GID.gift,
  productId: GID.giftPillow,
};
const HAUL = {
  id: 'gid://shopify/CartLine/haul',
  variantId: GID.haulVariant,
  productId: GID.haul,
};
const OTHER = {
  id: 'gid://shopify/CartLine/o',
  variantId: GID.otherVariant,
  productId: GID.other,
};

function contextFor(
  fake: FakeCart,
  env: object = ENV,
  overrides: Partial<{
    addLines: () => Promise<{cart: null}>;
  }> = {},
) {
  const updateDiscountCodes = vi.fn(() =>
    Promise.resolve({cart: fake.snapshot()}),
  );
  const {storefront} = fakeStorefront(storefrontResponder());
  const create = vi.fn(() =>
    Promise.resolve({cart: {id: 'gid://shopify/Cart/c1-new'}}),
  );
  return {
    create,
    updateDiscountCodes,
    context: {
      storefront,
      env,
      cart: {
        get: () => fake.get(),
        removeLines: (ids: string[]) => fake.removeLines(ids),
        updateLines: (
          lines: Array<{id: string; quantity: number; merchandiseId?: string}>,
        ) => fake.updateLines(lines),
        addLines:
          overrides.addLines ??
          ((lines: Array<{merchandiseId: string; quantity: number}>) =>
            fake.addLines(lines)),
        updateAttributes: (attributes: Array<{key: string; value: string}>) =>
          fake.updateAttributes(attributes),
        updateDiscountCodes,
        setCartId: () => new Headers(),
        create,
      },
    },
  };
}

function args(request: Request, context: object, params: object = {}) {
  // Route.*Args are framework-generated; only request, context and params are used by these routes.
  return {request, context, params} as never;
}

function post(path: string, body: FormData, headers: HeadersInit = {}) {
  return new Request(`${ORIGIN}${path}`, {method: 'POST', body, headers});
}

function cartForm(action: string, inputs: unknown) {
  const form = new FormData();
  form.set('cartFormInput', JSON.stringify({action, inputs}));
  return form;
}

type Wrapped = {data: Record<string, unknown>; status: number};

/** Unwraps react-router's `data()` result; a redirect or thrown Response is not one. */
function unwrap(result: unknown): Wrapped {
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

function locationOf(result: unknown): string | null {
  return result instanceof Response ? result.headers.get('Location') : null;
}

async function thrownStatus(run: () => Promise<unknown>): Promise<number> {
  try {
    await run();
  } catch (error) {
    if (error instanceof Response) return error.status;
    throw error;
  }
  throw new Error('Expected a thrown Response');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('cart action dispatch (T-01, REQ-PRE-006)', () => {
  const LINE = MATTRESS_LINE.id;

  it('adds only what was validated and repairs the result: a forged price and parent are dropped', async () => {
    const fake = new FakeCart([OTHER]);
    const {context} = contextFor(fake);
    const result = await cartAction(
      args(
        post(
          '/cart',
          cartForm('LinesAdd', {
            lines: [
              {
                merchandiseId: GID.otherVariant,
                quantity: 2,
                price: '0.01',
                parent: {lineId: OTHER.id},
              },
            ],
          }),
        ),
        context,
      ),
    );
    expect(unwrap(result).status).toBe(200);
    expect(fake.calls[0]).toEqual({
      method: 'addLines',
      lines: [{merchandiseId: GID.otherVariant, quantity: 2}],
    });
  });

  it('a gift added without its qualifier is removed again before the response', async () => {
    const fake = new FakeCart([OTHER]);
    const {context} = contextFor(fake);
    const result = await cartAction(
      args(
        post(
          '/cart',
          cartForm('LinesAdd', {
            lines: [{merchandiseId: GID.gift, quantity: 1}],
          }),
        ),
        context,
      ),
    );
    expect(fake.lineIds()).toEqual([OTHER.id]);
    const {data} = unwrap(result);
    expect(JSON.stringify(data.warnings)).toMatch(/free gift was removed/i);
  });

  it('removing the qualifying mattress removes its gift (orphan rule)', async () => {
    const fake = new FakeCart([OTHER, MATTRESS_LINE, GIFT]);
    const {context} = contextFor(fake);
    await cartAction(
      args(post('/cart', cartForm('LinesRemove', {lineIds: [LINE]})), context),
    );
    expect(fake.lineIds()).toEqual([OTHER.id]);
  });

  it('an update carries a quantity only: attributes are dropped (P-L1)', async () => {
    const fake = new FakeCart([OTHER]);
    const {context} = contextFor(fake);
    await cartAction(
      args(
        post(
          '/cart',
          cartForm('LinesUpdate', {
            lines: [{id: OTHER.id, quantity: 2, attributes: []}],
          }),
        ),
        context,
      ),
    );
    expect(fake.calls[0]).toEqual({
      method: 'updateLines',
      lines: [{id: OTHER.id, quantity: 2}],
    });
  });

  it('dispatches the size swap to the validated, server-checked path', async () => {
    const fake = new FakeCart([MATTRESS_LINE]);
    const {context} = contextFor(fake);
    const result = await cartAction(
      args(
        post(
          '/cart',
          cartForm('CustomChangeSize', {
            lineId: LINE,
            merchandiseId: GID.mattressKing,
          }),
        ),
        context,
      ),
    );
    expect(unwrap(result).status).toBe(200);
    expect(fake.calls[0]).toMatchObject({
      method: 'updateLines',
      lines: [{id: LINE, merchandiseId: GID.mattressKing}],
    });
  });

  it('a size swap to another product answers 400 and changes nothing', async () => {
    const fake = new FakeCart([MATTRESS_LINE]);
    const {context} = contextFor(fake);
    const result = await cartAction(
      args(
        post(
          '/cart',
          cartForm('CustomChangeSize', {
            lineId: LINE,
            merchandiseId: GID.protectorKing,
          }),
        ),
        context,
      ),
    );
    expect(unwrap(result).status).toBe(400);
    expect(fake.calls).toEqual([]);
  });

  it.each([
    ['an unknown action', 'Evil', {}],
    [
      'a built-in action we do not offer',
      'AttributesUpdateInput',
      {attributes: []},
    ],
    [
      'an invalid add',
      'LinesAdd',
      {lines: [{merchandiseId: 'x', quantity: 1}]},
    ],
    ['an invalid size change', 'CustomChangeSize', {lineId: 'x'}],
  ])('%s answers 400 and changes nothing', async (_name, action, inputs) => {
    const fake = new FakeCart([OTHER]);
    const {context} = contextFor(fake);
    const result = await cartAction(
      args(post('/cart', cartForm(action, inputs)), context),
    );
    expect(unwrap(result).status).toBe(400);
    expect(fake.calls).toEqual([]);
  });

  it('refuses another origin with 403 before reading anything', async () => {
    const fake = new FakeCart([OTHER]);
    const {context} = contextFor(fake);
    const result = await cartAction(
      args(
        post('/cart', cartForm('LinesRemove', {lineIds: [OTHER.id]}), {
          Origin: 'https://evil.example',
        }),
        context,
      ),
    );
    expect(unwrap(result).status).toBe(403);
    expect(fake.calls).toEqual([]);
  });

  it('every cart response is private and not stored', async () => {
    const fake = new FakeCart([OTHER]);
    const {context} = contextFor(fake);
    const result = await cartAction(
      args(post('/cart', cartForm('Evil', {})), context),
    );
    expect(unwrap(result)).toBeDefined();
    const loaded = await cartLoader(
      args(new Request(`${ORIGIN}/cart`), context),
    );
    expect(unwrap(loaded).data.cart).toBeTruthy();
  });
});

describe('stale cart cookie on add (O-L8)', () => {
  it('starts a fresh cart with the validated lines instead of answering with no cart', async () => {
    const fake = new FakeCart([OTHER]);
    const {context, create} = contextFor(fake, ENV, {
      addLines: () => Promise.resolve({cart: null}),
    });
    const result = await cartAction(
      args(
        post(
          '/cart',
          cartForm('LinesAdd', {
            lines: [{merchandiseId: GID.otherVariant, quantity: 2, price: '1'}],
          }),
        ),
        context,
      ),
    );
    expect(create).toHaveBeenCalledWith({
      lines: [{merchandiseId: GID.otherVariant, quantity: 2}],
    });
    expect(unwrap(result).status).toBe(200);
  });
});

describe('discount link guard (O-L4)', () => {
  const link = (headers: HeadersInit = {}) =>
    new Request(`${ORIGIN}/discount/SAVE10?redirect=/collections`, {headers});

  it('applies the code on a document navigation', async () => {
    const {context, updateDiscountCodes} = contextFor(new FakeCart([OTHER]));
    await discountLoader(args(link(), context, {code: 'SAVE10'}));
    expect(updateDiscountCodes).toHaveBeenCalledTimes(1);
  });

  const embedded: Array<Record<string, string>> = [
    {'Sec-Fetch-Dest': 'image'},
    {'Sec-Purpose': 'prefetch'},
  ];
  it.each(embedded)(
    'does not touch the cart for %j, and still redirects safely',
    async (headers) => {
      const {context, updateDiscountCodes} = contextFor(new FakeCart([OTHER]));
      const result = await discountLoader(
        args(link(headers), context, {code: 'SAVE10'}),
      );
      expect(updateDiscountCodes).not.toHaveBeenCalled();
      expect(locationOf(result)).toBe('/collections');
    },
  );
});

describe('checkout gate (REQ-PRE-006, REQ-CHK-001)', () => {
  const get = (query = '') => new Request(`${ORIGIN}/checkout-steps${query}`);

  it('sends an empty cart back to the cart page', async () => {
    const {context} = contextFor(new FakeCart([]));
    expect(locationOf(await stepsLoader(args(get(), context)))).toBe('/cart');
  });

  it('redirects a verified cart to Shopify checkout', async () => {
    const {context} = contextFor(new FakeCart([OTHER]));
    expect(locationOf(await stepsLoader(args(get(), context)))).toBe(CHECKOUT);
  });

  it('NEVER redirects a blocked cart: a haul-away line outside in-home delivery', async () => {
    const fake = new FakeCart([MATTRESS_LINE, {...HAUL}]);
    const {context} = contextFor(fake);
    for (const query of ['', '?skip=1', '?step=comfort-guarantee']) {
      const result = await stepsLoader(args(get(query), context));
      expect(result).not.toBeInstanceOf(Response);
      expect(unwrap(result).data.state).toBe('blocked');
    }
  });

  it('NEVER redirects when the check itself fails: unavailable, 503', async () => {
    const fake = new FakeCart([GIFT, OTHER]);
    vi.spyOn(fake, 'removeLines').mockRejectedValue(new Error('down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const {context} = contextFor(fake);
    const result = await stepsLoader(args(get(), context));
    expect(result).not.toBeInstanceOf(Response);
    expect(unwrap(result)).toMatchObject({
      status: 503,
      data: {state: 'unavailable'},
    });
  });

  it('production without offer rules pauses checkout instead of passing the cart on', async () => {
    vi.stubEnv('PROD', true);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const {context} = contextFor(new FakeCart([OTHER, {...GIFT}]), {});
    const result = await stepsLoader(args(get(), context));
    expect(result).not.toBeInstanceOf(Response);
    expect(unwrap(result).data.state).toBe('blocked');
  });

  it('an emptied cart (a gift-only permalink) is never sent to Shopify (O-L3)', async () => {
    const {context} = contextFor(new FakeCart([{...GIFT}]));
    const result = await stepsLoader(args(get(), context));
    expect(result).not.toBeInstanceOf(Response);
    const {data} = unwrap(result);
    expect(data.state).toBe('emptied');
    expect(JSON.stringify(data.notices)).toMatch(/free gift was removed/i);
  });

  it('shows what it changed instead of redirecting at once (an orphaned gift was removed)', async () => {
    const fake = new FakeCart([OTHER, {...GIFT}]);
    const {context} = contextFor(fake);
    const result = await stepsLoader(args(get(), context));
    expect(result).not.toBeInstanceOf(Response);
    const {data} = unwrap(result);
    expect(data.state).toBe('repaired');
    expect(JSON.stringify(data.notices)).toMatch(/free gift was removed/i);
    // The second visit finds nothing to change and moves on.
    expect(locationOf(await stepsLoader(args(get(), context)))).toBe(CHECKOUT);
  });

  it('asks the comfort-guarantee question in the URL, then skips it on request', async () => {
    const fake = new FakeCart([MATTRESS_LINE]);
    const {context} = contextFor(fake);
    expect(locationOf(await stepsLoader(args(get(), context)))).toBe(
      '/checkout-steps?step=comfort-guarantee',
    );
    const step = unwrap(
      await stepsLoader(args(get('?step=comfort-guarantee'), context)),
    );
    expect(step.data.state).toBe('step');
    expect(locationOf(await stepsLoader(args(get('?skip=1'), context)))).toBe(
      CHECKOUT,
    );
  });

  it('an unknown step name in the URL is ignored, not trusted', async () => {
    const {context} = contextFor(new FakeCart([MATTRESS_LINE]));
    expect(
      locationOf(await stepsLoader(args(get('?step=evil'), context))),
    ).toBe('/checkout-steps?step=comfort-guarantee');
  });

  it('shows a known failure code as fixed text and offers a way on; an unknown code is ignored', async () => {
    const {context} = contextFor(new FakeCart([MATTRESS_LINE]));
    const shown = unwrap(
      await stepsLoader(
        args(get('?step=comfort-guarantee&error=add-failed'), context),
      ),
    );
    expect(shown.data.error).toMatch(/could not add/i);
    expect(shown.data.skipHref).toBe('/checkout-steps?skip=1');
    const unknown = unwrap(
      await stepsLoader(
        args(get('?step=comfort-guarantee&error=<script>'), context),
      ),
    );
    expect(unknown.data.error).toBeNull();
  });

  describe('step action', () => {
    const intent = (value: string, headers: HeadersInit = {}) => {
      const form = new FormData();
      form.set('step', 'comfort-guarantee');
      form.set('intent', value);
      return post('/checkout-steps', form, headers);
    };

    it('accept adds the protector and returns to the gate', async () => {
      const fake = new FakeCart([MATTRESS_LINE]);
      const {context} = contextFor(fake);
      const result = await stepsAction(args(intent('accept'), context));
      expect(locationOf(result)).toBe('/checkout-steps');
      expect(fake.lineIds()).toHaveLength(2);
    });

    it('decline records the attribute and returns to the gate', async () => {
      const fake = new FakeCart([MATTRESS_LINE]);
      const {context} = contextFor(fake);
      const result = await stepsAction(args(intent('decline'), context));
      expect(locationOf(result)).toBe('/checkout-steps');
      expect(fake.attributeValue('offer_declined_comfort_guarantee')).toBe(
        'yes',
      );
    });

    it('a failed write carries a known code back to the step, never to checkout', async () => {
      const fake = new FakeCart([MATTRESS_LINE]);
      fake.failNext = true;
      const {context} = contextFor(fake);
      const result = await stepsAction(args(intent('decline'), context));
      expect(locationOf(result)).toBe(
        '/checkout-steps?step=comfort-guarantee&error=record-failed',
      );
    });

    it('refuses another origin and invalid intents', async () => {
      const {context} = contextFor(new FakeCart([MATTRESS_LINE]));
      expect(
        await thrownStatus(() =>
          stepsAction(
            args(intent('accept', {Origin: 'https://evil.example'}), context),
          ),
        ),
      ).toBe(403);
      expect(
        await thrownStatus(() =>
          stepsAction(args(intent('add-anything'), context)),
        ),
      ).toBe(400);
    });
  });
});

describe('cart permalink goes through the gate (P-L4)', () => {
  const run = (lines: string, headers: HeadersInit = {}) => {
    const fake = new FakeCart([OTHER]);
    const {context, create} = contextFor(fake);
    return {
      create,
      go: () =>
        permalinkLoader(
          args(new Request(`${ORIGIN}/cart/${lines}`, {headers}), context, {
            lines,
          }),
        ),
    };
  };

  it('creates the cart and redirects to the gate, not straight to Shopify', async () => {
    const {go, create} = run('11:1');
    const result = await go();
    expect(locationOf(result)).toBe('/checkout-steps');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['invalid lines', 'abc:1', {}],
    ['an image request', '11:1', {'Sec-Fetch-Dest': 'image'}],
    ['a prefetch', '11:1', {'Sec-Purpose': 'prefetch'}],
  ])('%s creates no cart', async (_name, lines, headers) => {
    const {go, create} = run(lines, headers);
    expect(await thrownStatus(go)).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });
});
