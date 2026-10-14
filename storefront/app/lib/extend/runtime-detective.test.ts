import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  adminDetectiveHaulNode,
  adminDetectiveLineNode,
  adminDetectiveOrderNode,
} from '~/lib/detective/test-fixtures';
import {resetExtendSharedForTests, webhookDepsFor} from '~/lib/extend/runtime';

// P5B-05: the real wiring. webhookDepsFor must hand the detective the same OFFER_CONFIG_JSON the cart gate reads,
// so a deployment that has the webhook route also has the check, whatever EXTEND_ORDER_SYNC is.

const ADMIN_TOKEN = 'fixture-admin-token-not-real';
const OFFER_CONFIG = JSON.stringify({
  rules: {
    haulAway: {variantId: 'gid://shopify/ProductVariant/621', maxPieces: 3},
  },
  zone: {name: 'Metro', postalCodes: '606*', feeCents: 14900},
});

const BASE_ENV = {
  PUBLIC_STORE_DOMAIN: 'test-shop.myshopify.com',
  SHOPIFY_ADMIN_API_ACCESS_TOKEN: ADMIN_TOKEN,
  SHOPIFY_APP_CLIENT_SECRET: 'fixture-secret-not-real',
  EXTEND_ORDER_SYNC: 'off',
};

const action = {
  type: 'sync_order',
  orderId: '7001',
  topic: 'orders/paid',
  intent: 'report',
} as const;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetExtendSharedForTests();
});

function stubShopify(zip: string) {
  const bodies: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init: {body?: string}) => {
      bodies.push(init.body ?? '');
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
              order: adminDetectiveOrderNode(
                [adminDetectiveLineNode(), adminDetectiveHaulNode(2, 1)],
                {shippingAddress: {countryCodeV2: 'US', zip}},
              ),
            },
          }),
        ),
      );
    }),
  );
  return bodies;
}

describe('P5B-05 webhook route wiring', () => {
  it('with Extend sync off, the processor still reads the order and logs the violation from OFFER_CONFIG_JSON', async () => {
    const bodies = stubShopify('90210');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const deps = webhookDepsFor({
      env: {...BASE_ENV, OFFER_CONFIG_JSON: OFFER_CONFIG},
      production: false,
    });
    expect(await deps.process(action)).toEqual({status: 'done'});
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain('DetectiveOrderById');
    const logged = warn.mock.calls.map((call) => String(call[0])).join('\n');
    expect(logged).toContain('"event":"detective.violation"');
    expect(logged).toContain('haul-away-outside-zone');
    expect(logged).not.toContain('90210');
    expect(logged).not.toContain(ADMIN_TOKEN);
  });

  it('an in-zone haul-away order with the cart attribute is clean', async () => {
    stubShopify('60645');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const deps = webhookDepsFor({
      env: {...BASE_ENV, OFFER_CONFIG_JSON: OFFER_CONFIG},
      production: false,
    });
    await deps.process(action);
    const logged = warn.mock.calls.map((call) => String(call[0])).join('\n');
    expect(logged).toContain('"reason":"clean"');
    expect(logged).not.toContain('detective.violation');
  });

  it('without OFFER_CONFIG_JSON it makes no Admin call and says the order was not judged', async () => {
    const bodies = stubShopify('60645');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const deps = webhookDepsFor({env: BASE_ENV, production: false});
    await deps.process(action);
    expect(bodies).toHaveLength(0);
    expect(warn.mock.calls.map((call) => String(call[0])).join('\n')).toContain(
      'rules_unavailable:no_config',
    );
  });
});
