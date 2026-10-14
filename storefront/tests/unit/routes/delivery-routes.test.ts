import {afterEach, describe, expect, it, vi} from 'vitest';
import {fakeStorefront} from '../catalog/fake-storefront';
import {
  action as deliveryAction,
  loader as deliveryLoader,
} from '~/routes/delivery';
import {loader as cartLoader} from '~/routes/cart';
import {
  action as stepsAction,
  loader as stepsLoader,
} from '~/routes/checkout-steps';
import {saveDeliveryZipHeader} from '~/lib/delivery-runtime/zip-cookie';
import {
  ENV as OFFER_ENV,
  FakeCart,
  GID,
  storefrontResponder,
} from '~/lib/offers-runtime/test-fixtures';

// Route wiring for P3B-11 (ZIP cookie and action), P5B-03 (promise data) and P5B-04 (delivery and haul-away
// steps): REQ-NAV-003, REQ-DEL-001, REQ-DEL-002, REQ-PRE-003, REQ-PRE-005, REQ-PRE-006, T-01, T-05.
// The real route functions run against an in-memory cart. The route argument types are framework-generated;
// the helper below builds them from plain parts (a documented test-only narrowing, as in cart-routes.test.ts).

const ORIGIN = 'http://localhost:3000';
const ENV = {...OFFER_ENV, SESSION_SECRET: 'unit-test-secret-not-real'};
const CHECKOUT = 'https://shop.example/checkouts/c/c1-test';
const IN_ZONE = '60645';
const OUT_OF_ZONE = '90210';

const OTHER = {
  id: 'gid://shopify/CartLine/o',
  variantId: GID.otherVariant,
  productId: GID.other,
};
const HAUL = {
  id: 'gid://shopify/CartLine/haul',
  variantId: GID.haulVariant,
  productId: GID.haul,
};
const IN_HOME = [{key: 'delivery_choice', value: 'in-home'}];

afterEach(() => vi.restoreAllMocks());

function contextFor(fake: FakeCart, env: object = ENV) {
  const {storefront} = fakeStorefront(storefrontResponder());
  const context = {
    storefront,
    env,
    cart: {
      get: () => fake.get(),
      removeLines: (ids: string[]) => fake.removeLines(ids),
      updateLines: (
        lines: Array<{id: string; quantity: number; merchandiseId?: string}>,
      ) => fake.updateLines(lines),
      addLines: (lines: Array<{merchandiseId: string; quantity: number}>) =>
        fake.addLines(lines),
      updateAttributes: (attributes: Array<{key: string; value: string}>) =>
        fake.updateAttributes(attributes),
      setCartId: () => new Headers(),
    },
  };
  return {context};
}

function args(request: Request, context: object) {
  return {request, context, params: {}} as never;
}

/** A request carrying the signed ZIP cookie the server would have set. */
async function withZip(
  zip: string | null,
  path: string,
  init: RequestInit = {},
): Promise<Request> {
  const headers = new Headers(init.headers);
  if (zip !== null) {
    const setCookie = await saveDeliveryZipHeader(
      zip,
      new Request(`${ORIGIN}/`),
      ENV,
    );
    headers.set('Cookie', (setCookie ?? '').split(';')[0] ?? '');
  }
  return new Request(`${ORIGIN}${path}`, {...init, headers});
}

function postForm(fields: Record<string, string>, headers: HeadersInit = {}) {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  return {method: 'POST', body, headers};
}

type Wrapped = {
  data: Record<string, unknown>;
  status: number;
  headers: Headers;
};

/** Unwraps react-router's `data()` result; a redirect or thrown Response is not one. */
function unwrap(result: unknown): Wrapped {
  if (
    typeof result === 'object' &&
    result !== null &&
    'data' in result &&
    'init' in result
  ) {
    const {data, init} = result;
    const record =
      typeof init === 'object' && init !== null ? init : ({} as object);
    const status = 'status' in record ? Number(record.status) : 200;
    const headers = new Headers(
      'headers' in record ? (record.headers as HeadersInit) : undefined,
    );
    if (typeof data === 'object' && data !== null) {
      return {data: Object.fromEntries(Object.entries(data)), status, headers};
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

function cookieOf(result: unknown): string {
  const headers =
    result instanceof Response ? result.headers : unwrap(result).headers;
  return headers.get('Set-Cookie') ?? '';
}

describe('GET /delivery (P5B-03, REQ-DEL-002)', () => {
  it('answers privately and uncached, with no ZIP before one is saved', async () => {
    const {context} = contextFor(new FakeCart([]));
    const result = unwrap(
      await deliveryLoader(args(await withZip(null, '/delivery'), context)),
    );
    expect(result.data).toEqual({delivery: {status: 'no-zip'}, error: null});
    expect(result.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('says yes with the approved wording for a saved ZIP inside the zone, and no outside it', async () => {
    const {context} = contextFor(new FakeCart([]));
    const inside = unwrap(
      await deliveryLoader(args(await withZip(IN_ZONE, '/delivery'), context)),
    );
    expect(inside.data.delivery).toEqual({
      status: 'in-zone',
      zip: IN_ZONE,
      promise: 'White-glove.',
    });
    const outside = unwrap(
      await deliveryLoader(
        args(await withZip(OUT_OF_ZONE, '/delivery'), context),
      ),
    );
    expect(outside.data.delivery).toEqual({
      status: 'outside-zone',
      zip: OUT_OF_ZONE,
    });
    expect(JSON.stringify(outside.data)).not.toMatch(/White-glove/);
  });

  it('claims nothing when no delivery zone is configured', async () => {
    const {context} = contextFor(new FakeCart([]), {
      SESSION_SECRET: ENV.SESSION_SECRET,
    });
    const result = unwrap(
      await deliveryLoader(args(await withZip(IN_ZONE, '/delivery'), context)),
    );
    expect(result.data.delivery).toEqual({status: 'unavailable'});
  });

  it('does not believe an unsigned or forged cookie', async () => {
    const {context} = contextFor(new FakeCart([]));
    const forged = new Request(`${ORIGIN}/delivery`, {
      headers: {Cookie: 'delivery_zip=60645'},
    });
    expect(
      unwrap(await deliveryLoader(args(forged, context))).data.delivery,
    ).toEqual({status: 'no-zip'});
  });
});

describe('POST /delivery (P3B-11, REQ-NAV-003)', () => {
  const save = (
    zip: string,
    extra: Record<string, string> = {},
    headers: HeadersInit = {},
  ) =>
    new Request(
      `${ORIGIN}/delivery`,
      postForm({intent: 'save', zip, ...extra}, headers),
    );

  it('saves a valid ZIP in a signed HttpOnly cookie and reads it back', async () => {
    const {context} = contextFor(new FakeCart([]));
    const result = await deliveryAction(args(save(IN_ZONE), context));
    const body = unwrap(result);
    expect(body.status).toBe(200);
    expect(body.data.delivery).toMatchObject({status: 'in-zone', zip: IN_ZONE});
    expect(body.headers.get('Cache-Control')).toBe('private, no-store');
    expect(cookieOf(result)).toMatch(/delivery_zip=/);
    expect(cookieOf(result)).toMatch(/HttpOnly/i);

    const next = new Request(`${ORIGIN}/delivery`, {
      headers: {Cookie: cookieOf(result).split(';')[0] ?? ''},
    });
    expect(
      unwrap(await deliveryLoader(args(next, context))).data.delivery,
    ).toMatchObject({status: 'in-zone', zip: IN_ZONE});
  });

  it('accepts ZIP+4 and stores the 5-digit code', async () => {
    const {context} = contextFor(new FakeCart([]));
    const result = unwrap(
      await deliveryAction(args(save('60645-1234'), context)),
    );
    expect(result.data.delivery).toMatchObject({zip: IN_ZONE});
  });

  it('saves an outside-zone ZIP too: the answer is "no", not an error', async () => {
    const {context} = contextFor(new FakeCart([]));
    const result = await deliveryAction(args(save(OUT_OF_ZONE), context));
    expect(unwrap(result).data.delivery).toEqual({
      status: 'outside-zone',
      zip: OUT_OF_ZONE,
    });
    expect(cookieOf(result)).toMatch(/delivery_zip=/);
  });

  it.each([
    '',
    '1234',
    '123456',
    'abcde',
    '12 345',
    '<script>alert(1)</script>',
    '60645\r\nSet-Cookie: evil=1',
    '9'.repeat(5000),
  ])('rejects %j with a fixed message, 400 and no cookie', async (zip) => {
    const {context} = contextFor(new FakeCart([]));
    const result = await deliveryAction(args(save(zip), context));
    const body = unwrap(result);
    expect(body.status).toBe(400);
    expect(body.data.error).toBe('invalid-zip');
    expect(cookieOf(result)).toBe('');
    // Nothing from the request is echoed back (T-07).
    expect(JSON.stringify(body.data)).not.toContain('script');
  });

  it('rejects a missing ZIP field and an unknown intent', async () => {
    const {context} = contextFor(new FakeCart([]));
    const noZip = new Request(`${ORIGIN}/delivery`, postForm({intent: 'save'}));
    expect(unwrap(await deliveryAction(args(noZip, context))).status).toBe(400);
    const odd = new Request(
      `${ORIGIN}/delivery`,
      postForm({intent: 'delete-everything', zip: IN_ZONE}),
    );
    const result = await deliveryAction(args(odd, context));
    expect(unwrap(result).status).toBe(400);
    expect(cookieOf(result)).toBe('');
  });

  it('refuses another origin and sets no cookie', async () => {
    const {context} = contextFor(new FakeCart([]));
    const result = await deliveryAction(
      args(save(IN_ZONE, {}, {Origin: 'https://evil.example'}), context),
    );
    expect(unwrap(result).status).toBe(403);
    expect(cookieOf(result)).toBe('');
  });

  it('a form posted without JavaScript is answered in place: no redirect, no ZIP in any URL', async () => {
    const {context} = contextFor(new FakeCart([]));
    const ok = await deliveryAction(args(save(IN_ZONE), context));
    expect(ok).not.toBeInstanceOf(Response);
    expect(locationOf(ok)).toBeNull();
    expect(cookieOf(ok)).toMatch(/delivery_zip=/);
    // A stray redirectTo field (an old form, a crafted post) is ignored: there is nothing to follow.
    const stray = await deliveryAction(
      args(save(IN_ZONE, {redirectTo: 'https://evil.example'}), context),
    );
    expect(locationOf(stray)).toBeNull();
    expect(unwrap(stray).data.error).toBeNull();
  });

  it('clears the saved ZIP', async () => {
    const {context} = contextFor(new FakeCart([]));
    const request = await withZip(
      IN_ZONE,
      '/delivery',
      postForm({intent: 'clear'}),
    );
    const result = await deliveryAction(args(request, context));
    expect(unwrap(result).data.delivery).toEqual({status: 'no-zip'});
    expect(cookieOf(result)).toMatch(/Max-Age=0/i);
  });

  it('fails visibly, not silently, when it cannot sign the cookie', async () => {
    const {context} = contextFor(new FakeCart([]), {
      OFFER_CONFIG_JSON: ENV.OFFER_CONFIG_JSON,
    });
    const result = await deliveryAction(args(save(IN_ZONE), context));
    expect(unwrap(result)).toMatchObject({
      status: 503,
      data: {error: 'save-failed'},
    });
    expect(cookieOf(result)).toBe('');
  });

  it('never logs the ZIP (T-05)', async () => {
    const spies = (['log', 'info', 'warn', 'error'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    );
    const {context} = contextFor(new FakeCart([]));
    await deliveryAction(args(save(IN_ZONE), context));
    await deliveryAction(args(save('bad zip 12345'), context));
    for (const spy of spies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(IN_ZONE);
    }
  });
});

describe('cart gate reads the saved ZIP (P3B-11, REQ-PRE-003, REQ-PRE-006)', () => {
  const get = async (zip: string | null, query = '') =>
    withZip(zip, `/checkout-steps${query}`);

  it('haul-away no longer fails closed for zip-missing once a ZIP inside the zone is saved', async () => {
    const fake = new FakeCart([OTHER, {...HAUL}], {attributes: IN_HOME});
    const {context} = contextFor(fake);
    expect(
      locationOf(await stepsLoader(args(await get(IN_ZONE), context))),
    ).toBe(CHECKOUT);
  });

  it('is still blocked with no saved ZIP, or a ZIP outside the zone (fail closed)', async () => {
    for (const zip of [null, OUT_OF_ZONE]) {
      const fake = new FakeCart([OTHER, {...HAUL}], {attributes: IN_HOME});
      const {context} = contextFor(fake);
      const result = await stepsLoader(args(await get(zip), context));
      expect(result).not.toBeInstanceOf(Response);
      expect(unwrap(result).data.state).toBe('blocked');
    }
  });

  it('is blocked when in-home was never chosen, even with a ZIP inside the zone', async () => {
    const fake = new FakeCart([OTHER, {...HAUL}]);
    const {context} = contextFor(fake);
    const result = await stepsLoader(args(await get(IN_ZONE), context));
    expect(unwrap(result).data.state).toBe('blocked');
  });

  it('the cart page judges it the same way', async () => {
    const fake = new FakeCart([OTHER, {...HAUL}], {attributes: IN_HOME});
    const {context} = contextFor(fake);
    const withZipSaved = unwrap(
      await cartLoader(args(await withZip(IN_ZONE, '/cart'), context)),
    );
    expect(withZipSaved.data.offers).toMatchObject({blocked: []});
    const without = unwrap(
      await cartLoader(args(await withZip(null, '/cart'), context)),
    );
    expect(JSON.stringify(without.data.offers)).toMatch(
      /haul-away-not-eligible/,
    );
  });
});

describe('delivery and haul-away steps through the gate (P5B-04)', () => {
  const stepsGet = async (zip: string | null, query = '') =>
    withZip(zip, `/checkout-steps${query}`);
  const stepsPost = async (
    zip: string | null,
    fields: Record<string, string>,
    headers: HeadersInit = {},
  ) => withZip(zip, '/checkout-steps', postForm(fields, headers));

  it('asks the delivery question first for a ZIP inside the zone, and the shopper can skip it', async () => {
    const fake = new FakeCart([OTHER]);
    const {context} = contextFor(fake);
    expect(
      locationOf(await stepsLoader(args(await stepsGet(IN_ZONE), context))),
    ).toBe('/checkout-steps?step=delivery-choice');
    const step = unwrap(
      await stepsLoader(
        args(await stepsGet(IN_ZONE, '?step=delivery-choice'), context),
      ),
    );
    expect(step.data).toMatchObject({
      state: 'step',
      step: 'delivery-choice',
      skipHref: '/checkout-steps?skip=1',
      delivery: {status: 'pending'},
    });
    expect(
      locationOf(
        await stepsLoader(args(await stepsGet(IN_ZONE, '?skip=1'), context)),
      ),
    ).toBe(CHECKOUT);
  });

  it('does not ask with no ZIP or a ZIP outside the zone: straight to checkout', async () => {
    for (const zip of [null, OUT_OF_ZONE]) {
      const {context} = contextFor(new FakeCart([OTHER]));
      expect(
        locationOf(await stepsLoader(args(await stepsGet(zip), context))),
      ).toBe(CHECKOUT);
    }
  });

  it('in-home then haul-away: asks, adds the capped pieces, and then goes to checkout', async () => {
    const fake = new FakeCart([OTHER]);
    const {context} = contextFor(fake);

    const chose = await stepsAction(
      args(
        await stepsPost(IN_ZONE, {
          step: 'delivery-choice',
          intent: 'choose',
          choice: 'in-home',
        }),
        context,
      ),
    );
    expect(locationOf(chose)).toBe('/checkout-steps');
    expect(fake.attributeValue('delivery_choice')).toBe('in-home');

    expect(
      locationOf(await stepsLoader(args(await stepsGet(IN_ZONE), context))),
    ).toBe('/checkout-steps?step=haul-away');
    const step = unwrap(
      await stepsLoader(
        args(await stepsGet(IN_ZONE, '?step=haul-away'), context),
      ),
    );
    expect(step.data).toMatchObject({
      state: 'step',
      step: 'haul-away',
      haulAway: {maxPieces: 2, currentQuantity: 0},
    });

    const accepted = await stepsAction(
      args(
        await stepsPost(IN_ZONE, {
          step: 'haul-away',
          intent: 'accept',
          pieces: '99',
          // Forged fields are ignored: the variant and the cap come from the server's rules.
          merchandiseId: 'gid://shopify/ProductVariant/9999',
          quantity: '50',
        }),
        context,
      ),
    );
    expect(locationOf(accepted)).toBe('/checkout-steps');
    const haulLine = fake
      .snapshot()
      .lines.nodes.find((node) => node.merchandise.id === GID.haulVariant);
    expect(haulLine?.quantity).toBe(2);
    expect(
      fake
        .snapshot()
        .lines.nodes.some((node) => node.merchandise.id.endsWith('9999')),
    ).toBe(false);

    expect(
      locationOf(await stepsLoader(args(await stepsGet(IN_ZONE), context))),
    ).toBe(CHECKOUT);
  });

  it('pickup ends the questions: no haul-away step, then checkout', async () => {
    const fake = new FakeCart([OTHER]);
    const {context} = contextFor(fake);
    await stepsAction(
      args(
        await stepsPost(IN_ZONE, {
          step: 'delivery-choice',
          intent: 'choose',
          choice: 'pickup',
        }),
        context,
      ),
    );
    expect(fake.attributeValue('delivery_choice')).toBe('pickup');
    expect(
      locationOf(await stepsLoader(args(await stepsGet(IN_ZONE), context))),
    ).toBe(CHECKOUT);
  });

  it('declining haul-away is recorded and the shopper goes on to checkout', async () => {
    const fake = new FakeCart([OTHER], {attributes: IN_HOME});
    const {context} = contextFor(fake);
    const result = await stepsAction(
      args(
        await stepsPost(IN_ZONE, {step: 'haul-away', intent: 'decline'}),
        context,
      ),
    );
    expect(locationOf(result)).toBe('/checkout-steps');
    expect(fake.attributeValue('offer_declined_haul_away')).toBe('yes');
    expect(
      locationOf(await stepsLoader(args(await stepsGet(IN_ZONE), context))),
    ).toBe(CHECKOUT);
  });

  it('a forged in-home answer outside the zone carries a known code back, records nothing, and never blocks the way on', async () => {
    const fake = new FakeCart([OTHER]);
    const {context} = contextFor(fake);
    const result = await stepsAction(
      args(
        await stepsPost(OUT_OF_ZONE, {
          step: 'delivery-choice',
          intent: 'choose',
          choice: 'in-home',
        }),
        context,
      ),
    );
    expect(locationOf(result)).toBe(
      '/checkout-steps?step=delivery-choice&error=delivery-choice-unavailable',
    );
    expect(fake.attributeValue('delivery_choice')).toBeUndefined();
    // And the gate still lets them continue.
    expect(
      locationOf(await stepsLoader(args(await stepsGet(OUT_OF_ZONE), context))),
    ).toBe(CHECKOUT);
  });

  it('a pieces value that is not a number is refused with a known code and nothing is added', async () => {
    const fake = new FakeCart([OTHER], {attributes: IN_HOME});
    const {context} = contextFor(fake);
    const result = await stepsAction(
      args(
        await stepsPost(IN_ZONE, {
          step: 'haul-away',
          intent: 'accept',
          pieces: '1e3',
        }),
        context,
      ),
    );
    expect(locationOf(result)).toBe(
      '/checkout-steps?step=haul-away&error=quantity-invalid',
    );
    expect(fake.lineIds()).toEqual([OTHER.id]);
  });

  it('shows a known step failure as fixed text and never echoes the code verbatim from the URL', async () => {
    const fake = new FakeCart([OTHER], {attributes: IN_HOME});
    const {context} = contextFor(fake);
    const shown = unwrap(
      await stepsLoader(
        args(
          await stepsGet(IN_ZONE, '?step=haul-away&error=quantity-invalid'),
          context,
        ),
      ),
    );
    expect(shown.data.error).toMatch(/how many pieces/i);
    const unknown = unwrap(
      await stepsLoader(
        args(
          await stepsGet(IN_ZONE, '?step=haul-away&error=<script>'),
          context,
        ),
      ),
    );
    expect(unknown.data.error).toBeNull();
  });

  it('refuses another origin and unknown step or intent combinations', async () => {
    const {context} = contextFor(new FakeCart([OTHER]));
    expect(
      await thrownStatus(async () =>
        stepsAction(
          args(
            await stepsPost(
              IN_ZONE,
              {step: 'haul-away', intent: 'decline'},
              {Origin: 'https://evil.example'},
            ),
            context,
          ),
        ),
      ),
    ).toBe(403);
    const unknownCombinations: Array<Record<string, string>> = [
      {step: 'haul-away', intent: 'choose'},
      {step: 'delivery-choice', intent: 'choose', choice: 'ship-it'},
      {step: 'nope', intent: 'accept'},
    ];
    for (const fields of unknownCombinations) {
      expect(
        await thrownStatus(async () =>
          stepsAction(args(await stepsPost(IN_ZONE, fields), context)),
        ),
      ).toBe(400);
    }
  });
});
