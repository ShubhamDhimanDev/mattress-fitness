import {afterEach, describe, expect, it, vi} from 'vitest';
import type {FetchLike} from '~/lib/extend/types';
import {
  loadOfferConfig,
  offerRulesOf,
  resetOfferConfigCacheForTests,
} from '~/lib/offers-runtime/shopify-rules';

// ADR-0013, REQ-PROMO-001, REQ-PRE-002, REQ-PRE-006, T-03, T-05: the loader that reads the offer rules from Shopify. A
// fake Admin API answers by operation name; nothing here has run against a store (V-03, V-05).

const TOKEN = 'fixture-admin-token-not-real';
const MATTRESS = 'gid://shopify/Product/1';
const PILLOW = 'gid://shopify/Product/30';
const SERVICE = 'gid://shopify/Product/50';
const COLLECTION = 'gid://shopify/Collection/7';
const MINUTE = 60_000;

let stores = 0;
function envFor(token: string | null = TOKEN) {
  stores += 1;
  return {
    PUBLIC_STORE_DOMAIN: `loader-${stores}.myshopify.com`,
    ...(token === null ? {} : {SHOPIFY_ADMIN_API_ACCESS_TOKEN: token}),
  };
}

const variant = (id: number, size: string | null) => ({
  id: `gid://shopify/ProductVariant/${id}`,
  title: size ?? 'Default Title',
  selectedOptions: size === null ? [] : [{name: 'Size', value: size}],
});

const GIFT_DISCOUNT = {
  id: 'gid://shopify/DiscountAutomaticNode/1',
  discount: {
    __typename: 'DiscountAutomaticBxgy',
    title: 'Free pillow',
    status: 'ACTIVE',
    usesPerOrderLimit: null,
    customerBuys: {
      value: {__typename: 'DiscountQuantity', quantity: '1'},
      items: {
        __typename: 'DiscountProducts',
        products: {nodes: [{id: MATTRESS}]},
        productVariants: {nodes: []},
      },
    },
    customerGets: {
      value: {
        __typename: 'DiscountOnQuantity',
        quantity: {quantity: '1'},
        effect: {__typename: 'DiscountPercentage', percentage: 1},
      },
      items: {
        __typename: 'DiscountProducts',
        products: {
          nodes: [
            {
              id: PILLOW,
              title: 'Gift pillow',
              variants: {nodes: [variant(301, 'Queen'), variant(302, 'King')]},
            },
          ],
        },
        productVariants: {nodes: []},
      },
    },
  },
};

const rule = (id: number, fields: Record<string, string>) => ({
  id: `gid://shopify/Metaobject/${id}`,
  fields: Object.entries(fields).map(([key, value]) => ({key, value})),
});

const RULE_NODES = [
  rule(1, {
    name: 'Haul-away',
    type: 'haul_away',
    products: JSON.stringify([SERVICE]),
    max_quantity: '2',
  }),
  rule(2, {
    name: 'Comfort',
    type: 'comfort_protector',
    trigger_collection: COLLECTION,
    products: JSON.stringify([PILLOW]),
  }),
];
const ZONE_NODE = {
  fields: [
    {key: 'name', value: 'Metro'},
    {key: 'postal_codes', value: '606*, 60007'},
    {key: 'fee', value: '{"amount":"149.0","currency_code":"USD"}'},
    {key: 'free_over', value: '{"amount":"999.0","currency_code":"USD"}'},
  ],
};

const PRODUCT_NODES = new Map<string, object>([
  [
    SERVICE,
    {id: SERVICE, title: 'Service', variants: {nodes: [variant(501, null)]}},
  ],
  [
    PILLOW,
    {
      id: PILLOW,
      title: 'Pillow',
      variants: {nodes: [variant(301, 'Queen'), variant(302, 'King')]},
    },
  ],
]);

type Seen = {operation: string; headers: Record<string, string>; url: string};

function operationOf(query: string): string {
  const match = /query (\w+)/.exec(query);
  return match?.[1] ?? 'unknown';
}

/** A fake Admin API. `mode` can make every call fail; `seen` records what was asked. */
function fakeShopify(options: {free?: readonly object[]} = {}) {
  const seen: Seen[] = [];
  let mode: 'ok' | 'http500' | 'graphql' | 'network' = 'ok';
  const fetchFn: FetchLike = (url, init) => {
    const body: unknown = JSON.parse(init.body ?? '{}');
    const query = String(
      typeof body === 'object' && body !== null
        ? Reflect.get(body, 'query')
        : '',
    );
    const variables: unknown =
      typeof body === 'object' && body !== null
        ? Reflect.get(body, 'variables')
        : {};
    const operation = operationOf(query);
    seen.push({operation, headers: init.headers, url});
    if (mode === 'network') return Promise.reject(new Error('offline'));
    if (mode === 'http500') {
      return Promise.resolve(new Response('{}', {status: 500}));
    }
    if (mode === 'graphql') {
      return Promise.resolve(
        new Response(JSON.stringify({errors: [{message: 'Access denied'}]})),
      );
    }
    const ids: unknown =
      typeof variables === 'object' && variables !== null
        ? Reflect.get(variables, 'ids')
        : [];
    const idList = Array.isArray(ids) ? ids.map(String) : [];
    const data: Record<string, unknown> = {
      OfferGiftDiscounts: {discountNodes: {nodes: [GIFT_DISCOUNT]}},
      OfferFreeProducts: {discountNodes: {nodes: options.free ?? []}},
      OfferRuleEntries: {
        rules: {nodes: RULE_NODES},
        zones: {nodes: [ZONE_NODE]},
      },
      OfferRuleProducts: {
        nodes: idList.flatMap((id) => PRODUCT_NODES.get(id) ?? []),
      },
      OfferRuleCollections: {
        nodes: idList.map((id) => ({
          id,
          products: {nodes: [{id: MATTRESS}]},
        })),
      },
    };
    return Promise.resolve(
      new Response(JSON.stringify({data: data[operation]})),
    );
  };
  return {
    fetchFn,
    seen,
    count: (operation: string) =>
      seen.filter((entry) => entry.operation === operation).length,
    setMode: (next: typeof mode) => {
      mode = next;
    },
  };
}

afterEach(() => {
  resetOfferConfigCacheForTests();
  vi.restoreAllMocks();
});

describe('loadOfferConfig: reading Shopify (ADR-0013)', () => {
  it('builds gifts from the discount and the other rules and the zone from the metaobjects', async () => {
    const shopify = fakeShopify();
    const env = envFor();
    const load = await loadOfferConfig(env, {fetch: shopify.fetchFn});
    expect(load.status).toBe('ok');
    expect(load.warnings).toEqual([]);
    const {rules, zone} = load.config;
    expect(rules.gifts).toEqual([
      expect.objectContaining({
        name: 'Free pillow',
        qualifyingProductIds: [MATTRESS],
        giftVariantIdsBySize: {
          Queen: 'gid://shopify/ProductVariant/301',
          King: 'gid://shopify/ProductVariant/302',
        },
        maxQuantity: 1,
      }),
    ]);
    expect(rules.haulAway).toEqual({
      variantId: 'gid://shopify/ProductVariant/501',
      maxPieces: 2,
    });
    // The collection trigger was expanded through a second query.
    expect(rules.comfortGuarantee?.qualifyingProductIds).toEqual([MATTRESS]);
    expect(rules.freeDelivery).toEqual({thresholdCents: 99900});
    expect(zone?.name).toBe('Metro');
    expect(zone?.feeCents).toBe(14900);
    expect(shopify.count('OfferRuleCollections')).toBe(1);
    expect(shopify.count('OfferRuleProducts')).toBe(1);
  });

  it('sends the read-only token only to the shop host over the Admin API, and keeps it out of the result', async () => {
    const shopify = fakeShopify();
    const env = envFor();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const load = await loadOfferConfig(env, {fetch: shopify.fetchFn});
    for (const entry of shopify.seen) {
      expect(entry.url).toBe(
        `https://${env.PUBLIC_STORE_DOMAIN}/admin/api/2026-10/graphql.json`,
      );
      expect(entry.headers['X-Shopify-Access-Token']).toBe(TOKEN);
    }
    expect(JSON.stringify(load)).not.toContain(TOKEN);
    expect(JSON.stringify([log.mock.calls, warn.mock.calls])).not.toContain(
      TOKEN,
    );
  });

  it('only runs queries (it never changes anything in the store)', async () => {
    const shopify = fakeShopify();
    await loadOfferConfig(envFor(), {fetch: shopify.fetchFn});
    expect(shopify.seen.length).toBeGreaterThan(0);
    for (const entry of shopify.seen) {
      expect(entry.operation).toMatch(/^Offer/);
    }
  });

  it('offerRulesOf answers with just the rules', async () => {
    const shopify = fakeShopify();
    const env = envFor();
    await loadOfferConfig(env, {fetch: shopify.fetchFn});
    // Served from the cache: no second round of calls.
    const rules = await offerRulesOf(env);
    expect(rules.gifts).toHaveLength(1);
  });
});

describe('loadOfferConfig: caching', () => {
  it('serves the cache for a minute and then asks Shopify again', async () => {
    const shopify = fakeShopify();
    const env = envFor();
    let now = 1_000_000;
    const deps = {fetch: shopify.fetchFn, now: () => now};
    await loadOfferConfig(env, deps);
    expect(shopify.count('OfferGiftDiscounts')).toBe(1);
    now += MINUTE - 1;
    await loadOfferConfig(env, deps);
    expect(shopify.count('OfferGiftDiscounts')).toBe(1);
    now += 2;
    await loadOfferConfig(env, deps);
    expect(shopify.count('OfferGiftDiscounts')).toBe(2);
  });

  it('requests that arrive during a refresh share it', async () => {
    const shopify = fakeShopify();
    const env = envFor();
    const [a, b, c] = await Promise.all([
      loadOfferConfig(env, {fetch: shopify.fetchFn}),
      loadOfferConfig(env, {fetch: shopify.fetchFn}),
      loadOfferConfig(env, {fetch: shopify.fetchFn}),
    ]);
    expect(shopify.count('OfferGiftDiscounts')).toBe(1);
    expect(shopify.count('OfferRuleEntries')).toBe(1);
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it('does not share the cache between stores', async () => {
    const shopify = fakeShopify();
    await loadOfferConfig(envFor(), {fetch: shopify.fetchFn});
    await loadOfferConfig(envFor(), {fetch: shopify.fetchFn});
    expect(shopify.count('OfferGiftDiscounts')).toBe(2);
  });
});

describe('loadOfferConfig: a product at 100% off is a gift (REQ-PROMO-001)', () => {
  it('fetches the free product variants and offers it with any purchase', async () => {
    const shopify = fakeShopify({
      free: [
        {
          id: 'gid://shopify/DiscountAutomaticNode/9',
          discount: {
            __typename: 'DiscountAutomaticBasic',
            title: 'Free service pillow',
            status: 'ACTIVE',
            minimumRequirement: null,
            customerGets: {
              value: {__typename: 'DiscountPercentage', percentage: 1},
              items: {
                __typename: 'DiscountProducts',
                products: {nodes: [{id: PILLOW, title: 'Pillow'}]},
              },
            },
          },
        },
      ],
    });
    const load = await loadOfferConfig(envFor(), {fetch: shopify.fetchFn});
    expect(load.status).toBe('ok');
    expect(load.config.rules.gifts).toContainEqual(
      expect.objectContaining({
        name: 'Free service pillow',
        anyPurchase: true,
        maxQuantity: 1,
        giftVariantIdsBySize: {
          Queen: 'gid://shopify/ProductVariant/301',
          King: 'gid://shopify/ProductVariant/302',
        },
      }),
    );
    expect(shopify.count('OfferFreeProducts')).toBe(1);
  });
});

describe('loadOfferConfig: failures fail open (REQ-PRE-006)', () => {
  it('keeps the last good rules while Shopify is unreachable, and retries after ten seconds', async () => {
    const shopify = fakeShopify();
    const env = envFor();
    let now = 5_000_000;
    const deps = {fetch: shopify.fetchFn, now: () => now};
    const good = await loadOfferConfig(env, deps);
    shopify.setMode('http500');
    now += MINUTE + 1;
    const stale = await loadOfferConfig(env, deps);
    expect(stale.status).toBe('ok');
    expect(stale.config).toEqual(good.config);
    expect(stale.warnings.some((note) => note.startsWith('stale:'))).toBe(true);
    const callsAfterFailure = shopify.seen.length;
    now += 9_000;
    await loadOfferConfig(env, deps);
    expect(shopify.seen.length).toBe(callsAfterFailure);
    now += 2_000;
    shopify.setMode('ok');
    const recovered = await loadOfferConfig(env, deps);
    expect(recovered.warnings).toEqual([]);
    expect(shopify.seen.length).toBeGreaterThan(callsAfterFailure);
  });

  it.each([
    ['http500', 'discounts_http_500'],
    ['graphql', 'discounts_graphql'],
    ['network', 'discounts_network'],
  ] as const)(
    'with nothing good loaded before, a %s answer is "invalid" with no rules and a reason code',
    async (mode, reason) => {
      const shopify = fakeShopify();
      shopify.setMode(mode);
      const load = await loadOfferConfig(envFor(), {fetch: shopify.fetchFn});
      expect(load.status).toBe('invalid');
      expect(load.config.rules.gifts).toEqual([]);
      expect(load.config.zone).toBeNull();
      expect(load.warnings).toEqual([reason]);
    },
  );

  it('does not hammer Shopify after a failure: the next ten seconds reuse the failed answer', async () => {
    const shopify = fakeShopify();
    shopify.setMode('http500');
    const env = envFor();
    let now = 9_000_000;
    const deps = {fetch: shopify.fetchFn, now: () => now};
    await loadOfferConfig(env, deps);
    const calls = shopify.seen.length;
    now += 5_000;
    await loadOfferConfig(env, deps);
    expect(shopify.seen.length).toBe(calls);
  });

  it('is "none" with no Admin token or no store domain, and makes no call', async () => {
    const shopify = fakeShopify();
    const noToken = await loadOfferConfig(envFor(null), {
      fetch: shopify.fetchFn,
    });
    const noStore = await loadOfferConfig({}, {fetch: shopify.fetchFn});
    expect(noToken.status).toBe('none');
    expect(noStore.status).toBe('none');
    expect(noToken.config.rules.gifts).toEqual([]);
    expect(shopify.seen).toEqual([]);
  });

  it('refuses a store domain that is not a myshopify.com host (the token is never sent elsewhere)', async () => {
    const shopify = fakeShopify();
    const load = await loadOfferConfig(
      {
        PUBLIC_STORE_DOMAIN: 'evil.example.com',
        SHOPIFY_ADMIN_API_ACCESS_TOKEN: TOKEN,
      },
      {fetch: shopify.fetchFn},
    );
    expect(load.status).toBe('none');
    expect(shopify.seen).toEqual([]);
  });
});
