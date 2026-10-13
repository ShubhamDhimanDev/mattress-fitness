import {describe, expect, it} from 'vitest';
import {
  validateAddLines,
  validateSizeChange,
  validateUpdateLines,
} from '~/lib/cart/actions';
import {
  CHECKOUT_STEPS_PATH,
  decideCheckout,
  getCheckoutHref,
} from '~/lib/cart/checkout';
import {
  isSameOriginRequest,
  mayCreateCartFromLink,
  noStoreHeaders,
} from '~/lib/cart/http';
import {
  isOffersView,
  pickOffersView,
  readOffersView,
} from '~/lib/offers-runtime/client';
import {parseOfferConfig, readOfferConfig} from '~/lib/offers-runtime/config';
import {withAttribute} from '~/lib/offers-runtime/step-attributes';
import {CONFIG, ENV, GID} from '~/lib/offers-runtime/test-fixtures';
import type {BlockReason} from '~/lib/offers-runtime/messages';
import type {CartOffersView} from '~/lib/offers-runtime/view';

// REQ-CHK-001 / REQ-PRE-006: no checkout URL for an uncorrected violation; T-01 input; P-L1, P-L3, P-L4.

const CART = {checkoutUrl: 'https://shop.example/c/abc'};
const BLOCK: BlockReason = {
  code: 'haul-away-not-eligible',
  message: 'No.',
  lineIds: ['l1'],
};

function view(overrides: Partial<CartOffersView> = {}): CartOffersView {
  return {
    updatedAt: 'v1',
    freeDelivery: {enabled: false},
    nextStep: null,
    comfortGuarantee: null,
    gifts: [],
    addOns: [],
    lineSizes: {},
    blocked: [],
    notices: [],
    ...overrides,
  };
}

describe('getCheckoutHref and decideCheckout (REQ-PRE-006)', () => {
  it('returns the https checkout URL when nothing blocks', () => {
    expect(getCheckoutHref(CART)).toBe(CART.checkoutUrl);
    expect(getCheckoutHref(CART, {blocked: []})).toBe(CART.checkoutUrl);
  });

  it('returns no URL when revalidation found an uncorrected violation', () => {
    expect(getCheckoutHref(CART, {blocked: [BLOCK]})).toBeNull();
  });

  it.each([
    ['ready', view(), 'ready'],
    ['a pending step', view({nextStep: 'comfort-guarantee'}), 'step'],
    ['a violation', view({blocked: [BLOCK]}), 'blocked'],
    [
      'a violation and a pending step',
      view({blocked: [BLOCK], nextStep: 'comfort-guarantee'}),
      'blocked',
    ],
  ])('%s', (_name, input, status) => {
    expect(decideCheckout(CART, input).status).toBe(status);
  });

  it('never hands off an unverified cart or a missing/insecure URL', () => {
    expect(decideCheckout(CART, null).status).toBe('unavailable');
    expect(
      decideCheckout({checkoutUrl: 'http://shop.example/c'}, view()).status,
    ).toBe('unavailable');
    expect(decideCheckout(null, view()).status).toBe('unavailable');
  });

  it('the cart links to the server gate, not to Shopify', () => {
    expect(CHECKOUT_STEPS_PATH).toBe('/checkout-steps');
  });
});

describe('cart input (T-01, P-L1)', () => {
  const LINE = 'gid://shopify/CartLine/abc-123?cart=c1-def456';

  it('drops attributes on update so hidden properties cannot be erased', () => {
    expect(
      validateUpdateLines([{id: LINE, quantity: 2, attributes: []}]),
    ).toEqual({status: 'ok', value: [{id: LINE, quantity: 2}]});
    expect(
      validateUpdateLines([
        {
          id: LINE,
          quantity: 2,
          attributes: [{key: '_extend_covered', value: 'x'}],
        },
      ]),
    ).toEqual({status: 'ok', value: [{id: LINE, quantity: 2}]});
  });

  it('a shopper cannot write an underscore (server-only) property when adding a line', () => {
    const result = validateAddLines([
      {
        merchandiseId: GID.otherVariant,
        quantity: 1,
        attributes: [{key: '_role', value: 'gift'}],
      },
    ]);
    expect(result.status).toBe('invalid');
  });

  it('a size change names a line and a variant only', () => {
    expect(
      validateSizeChange({
        lineId: LINE,
        merchandiseId: GID.mattressKing,
        quantity: 99,
        price: '0.01',
      }),
    ).toEqual({
      status: 'ok',
      value: {lineId: LINE, merchandiseId: GID.mattressKing},
    });
    for (const bad of [
      null,
      {},
      {lineId: LINE},
      {lineId: LINE, merchandiseId: 'gid://shopify/Product/1'},
      {lineId: 'x', merchandiseId: GID.mattressKing},
    ]) {
      expect(validateSizeChange(bad).status).toBe('invalid');
    }
  });
});

describe('http guards (P-L3, P-L4, CSRF)', () => {
  it('cart responses are private and not stored, and keep the cookie header', () => {
    const base = new Headers({'Set-Cookie': 'cart=abc; HttpOnly'});
    const headers = noStoreHeaders(base);
    expect(headers.get('Cache-Control')).toBe('private, no-store');
    expect(headers.get('Set-Cookie')).toBe('cart=abc; HttpOnly');
    expect(noStoreHeaders().get('Cache-Control')).toBe('private, no-store');
  });

  it.each([
    [{}, true],
    [{'Sec-Fetch-Dest': 'document'}, true],
    [{'Sec-Fetch-Dest': 'image'}, false],
    [{'Sec-Fetch-Dest': 'iframe'}, false],
    [{'Sec-Purpose': 'prefetch'}, false],
    [{Purpose: 'prefetch'}, false],
  ])('permalink cart creation for %j is %s', (headers, allowed) => {
    expect(mayCreateCartFromLink(new Headers(headers))).toBe(allowed);
  });

  it.each([
    [{}, true],
    [{Origin: 'https://shop.example'}, true],
    [{Origin: 'http://shop.example'}, true],
    [{Origin: 'https://evil.example'}, false],
    [{Origin: 'null'}, false],
    [{Origin: 'not a url'}, false],
  ])('same-origin check for %j is %s', (headers, allowed) => {
    expect(
      isSameOriginRequest({
        url: 'https://shop.example/cart',
        headers: new Headers(headers),
      }),
    ).toBe(allowed);
  });
});

describe('offer attributes (REQ-PRE-005)', () => {
  it('replaces one key, keeps the rest, drops null values, and caps the list', () => {
    const next = {key: 'offer_declined_comfort_guarantee', value: 'yes'};
    expect(
      withAttribute(
        [
          {key: 'delivery_choice', value: 'in-home'},
          {key: 'offer_declined_comfort_guarantee', value: 'no'},
          {key: 'gone', value: null},
        ],
        next,
      ),
    ).toEqual([{key: 'delivery_choice', value: 'in-home'}, next]);
    const many = Array.from({length: 300}, (_, i) => ({
      key: `k${i}`,
      value: 'v',
    }));
    const capped = withAttribute(many, next);
    expect(capped).toHaveLength(250);
    expect(capped.at(-1)).toEqual(next);
    expect(withAttribute(null, next)).toEqual([next]);
  });
});

describe('offer configuration (seam for P4-12)', () => {
  it('parses the fixture config', () => {
    const loaded = parseOfferConfig(CONFIG);
    expect(loaded.status).toBe('ok');
    expect(loaded.warnings).toEqual([]);
    expect(loaded.config.rules.gifts).toHaveLength(1);
    expect(loaded.config.rules.haulAway?.maxPieces).toBe(2);
    expect(loaded.config.zone?.postalCodes).toEqual(['606*', '60007']);
  });

  it('missing, oversized or broken JSON degrades to no offers', () => {
    expect(readOfferConfig({}).status).toBe('none');
    expect(readOfferConfig({OFFER_CONFIG_JSON: '  '}).status).toBe('none');
    expect(readOfferConfig({OFFER_CONFIG_JSON: '{nope'}).status).toBe(
      'invalid',
    );
    expect(
      readOfferConfig({OFFER_CONFIG_JSON: 'x'.repeat(100_001)}).status,
    ).toBe('invalid');
    expect(
      readOfferConfig({OFFER_CONFIG_JSON: '[]'}).config.rules.gifts,
    ).toEqual([]);
    expect(readOfferConfig(ENV).status).toBe('ok');
  });

  it('drops a malformed rule instead of half applying it', () => {
    const loaded = parseOfferConfig({
      rules: {
        gifts: [
          {
            id: 'bad',
            name: 'Bad',
            giftVariantIdsBySize: {Std: 'not-a-gid'},
            maxQuantity: 1,
            qualifyingProductIds: [GID.mattress],
          },
          {
            id: 'zero',
            name: 'Zero',
            giftVariantIdsBySize: {Std: GID.gift},
            maxQuantity: 0,
            qualifyingProductIds: [GID.mattress],
          },
          {
            id: 'noqual',
            name: 'None',
            giftVariantIdsBySize: {Std: GID.gift},
            maxQuantity: 1,
          },
        ],
        haulAway: {variantId: GID.haulVariant, maxPieces: 1000},
        freeDelivery: {thresholdCents: 0},
        comfortGuarantee: {
          qualifyingProductIds: [GID.mattress],
          protectorVariantIdBySize: {Queen: 'nope'},
        },
        matchingAddOns: {
          pillows: [
            {
              mattressProductId: GID.mattress,
              size: null,
              productId: 'x',
              variantId: GID.pillowVariant,
            },
          ],
        },
      },
      zone: {name: 'Z', postalCodes: '*', feeCents: 1},
    });
    expect(loaded.config.rules.gifts).toEqual([]);
    expect(loaded.config.rules.haulAway).toBeNull();
    expect(loaded.config.rules.freeDelivery).toBeNull();
    expect(loaded.config.rules.comfortGuarantee).toBeNull();
    expect(loaded.config.rules.matchingAddOns.pillows).toEqual([]);
    expect(loaded.config.zone).toBeNull();
    expect(loaded.warnings.length).toBeGreaterThan(0);
  });

  it('a size such as "__proto__" cannot reach the prototype', () => {
    const loaded = parseOfferConfig({
      rules: {
        comfortGuarantee: {
          qualifyingProductIds: [GID.mattress],
          protectorVariantIdBySize: JSON.parse(
            `{"__proto__": "${GID.protectorQueen}"}`,
          ),
        },
      },
    });
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
    expect(loaded.status).toBe('ok');
  });
});

describe('offers view on the client (REQ-CART-003, REQ-CART-004)', () => {
  it('reads a view from an action or loader result and ignores anything else', () => {
    const good = view();
    expect(isOffersView(good)).toBe(true);
    expect(readOffersView({cart: null, offers: good})).toEqual(good);
    for (const bad of [
      null,
      undefined,
      'x',
      {offers: null},
      {offers: {}},
      {offers: {...good, gifts: 'x'}},
    ]) {
      expect(readOffersView(bad)).toBeNull();
    }
  });

  it('uses a view only when it describes the cart on screen', () => {
    const a = view({updatedAt: 'v1'});
    const b = view({updatedAt: 'v2'});
    expect(pickOffersView([null, a, b], 'v2')).toBe(b);
    expect(pickOffersView([a], 'v2')).toBeNull();
    expect(pickOffersView([a], null)).toBeNull();
  });
});
