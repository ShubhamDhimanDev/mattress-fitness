import {describe, expect, it} from 'vitest';
import {parseExtendConfig} from '~/lib/extend/config';
import type {VariantFact} from '~/lib/extend/coverage-facts';
import type {ExtendLogEvent} from '~/lib/extend/log';
import {
  answerOffers,
  createDistinctVariantLimiter,
  type OffersEndpointDeps,
} from '~/lib/extend/offers-endpoint';
import {createOrderCoalescer} from '~/lib/extend/order-coalescer';
import {buildPricePointIndex} from '~/lib/extend/price-points';
import {WEBHOOK_SECRET, webhookRequest} from '~/lib/extend/test-fixtures';
import {createMemoryReplayStore} from '~/lib/extend/webhook';
import {
  handleShopifyWebhook,
  type ProcessOutcome,
} from '~/lib/extend/webhook-handler';

// Review of d068db6: item C (REQ-EXT-001, T-13: the stopgap budget counts only variants Shopify knows) and item D
// (T-03, E-L2: the shop-domain comparison applies to myshopify.com names only and a mismatch is logged at error level).

const KNOWN = 'gid://shopify/ProductVariant/1';
const OTHER_KNOWN = 'gid://shopify/ProductVariant/2';
const THIRD_KNOWN = 'gid://shopify/ProductVariant/3';
const fakeId = (n: number) => `gid://shopify/ProductVariant/9${n}00000`;

function endpoint(
  limiter: ReturnType<typeof createDistinctVariantLimiter>,
): OffersEndpointDeps {
  const known = new Set([KNOWN, OTHER_KNOWN, THIRD_KNOWN]);
  const index = buildPricePointIndex([
    {variantId: 'v1', name: 'Extend-Protection-Plan-79.99', priceCents: 7999},
  ]);
  return {
    config: parseExtendConfig(
      {
        PUBLIC_EXTEND_ENABLED: 'true',
        EXTEND_API_HOST: 'https://api-demo.helloextend.com',
        EXTEND_STORE_ID: 'store-1',
        EXTEND_ACCESS_TOKEN: 'fixture-token-not-real',
      },
      {production: false},
    ),
    allow: limiter.allow,
    loadCatalog: () =>
      Promise.resolve({
        status: 'ok',
        catalog: {coverageVariantIds: new Set(), index, complete: true},
      }),
    loadFacts: (ids) =>
      Promise.resolve({
        status: 'ok',
        facts: new Map<string, VariantFact>(
          ids
            .filter((id) => known.has(id))
            .map((id) => [
              id,
              {
                variantId: id,
                productId: 'gid://shopify/Product/5',
                category: 'mattress',
                unitPriceCents: 129_900,
                available: true,
              },
            ]),
        ),
      }),
    quote: (items) =>
      Promise.resolve({
        status: 'ok',
        plansByKey: new Map(
          items.map((item) => [
            item.key,
            [
              {
                planId: 'P-79',
                title: 'Plan',
                priceCents: 7999,
                termMonths: 36,
                termsUrl: 'https://extend.example/terms',
                imageUrl: null,
                recommended: true,
              },
            ],
          ]),
        ),
      }),
  };
}

describe('item C: the distinct-variant budget counts only variants Shopify knows', () => {
  it('an attacker looping fabricated ids burns no budget; a legitimate known variant still gets offers', async () => {
    const limiter = createDistinctVariantLimiter({
      now: () => 0,
      perWindow: 2,
    });
    const deps = endpoint(limiter);
    for (let n = 0; n < 50; n += 1) {
      const answer = await answerOffers(
        [{variantId: fakeId(n), quantity: 1}],
        deps,
      );
      // Shopify does not know it: nothing to offer, nothing charged.
      expect(answer.status).toBe('ok');
    }
    const legit = await answerOffers([{variantId: KNOWN, quantity: 1}], deps);
    expect(legit).toMatchObject({
      status: 'ok',
      items: [{variantId: KNOWN, plans: [{planId: 'P-79'}]}],
    });
  });

  it('repeats inside one request count once, and a variant already in the window keeps its offers after the budget is spent', async () => {
    const limiter = createDistinctVariantLimiter({
      now: () => 0,
      perWindow: 2,
    });
    const deps = endpoint(limiter);
    const twice = await answerOffers(
      [
        {variantId: KNOWN, quantity: 1},
        {variantId: KNOWN, quantity: 1},
        {variantId: OTHER_KNOWN, quantity: 1},
      ],
      deps,
    );
    expect(twice.status).toBe('ok');
    // The budget (2 distinct known variants) is now spent: a third known variant is refused...
    expect(
      await answerOffers([{variantId: THIRD_KNOWN, quantity: 1}], deps),
    ).toEqual({status: 'unavailable'});
    // ...but the two already inside the window are not.
    expect(
      (await answerOffers([{variantId: KNOWN, quantity: 1}], deps)).status,
    ).toBe('ok');
  });
});

describe('item D: webhook shop-domain comparison', () => {
  function handler(expectedShopDomain: string | null) {
    const processed: string[] = [];
    const tasks: Promise<unknown>[] = [];
    const logs: ExtendLogEvent[] = [];
    const clock = {t: Date.now()};
    return {
      processed,
      tasks,
      logs,
      deps: {
        secret: WEBHOOK_SECRET,
        expectedShopDomain,
        replay: createMemoryReplayStore({now: () => clock.t}),
        coalescer: createOrderCoalescer<ProcessOutcome>({
          now: () => clock.t,
          sleep: () => Promise.resolve(),
        }),
        process: (action: {orderId: string}) => {
          processed.push(action.orderId);
          return Promise.resolve<ProcessOutcome>({status: 'done'});
        },
        schedule: (task: Promise<unknown>) => {
          tasks.push(task);
        },
        now: () => clock.t,
        log: (event: ExtendLogEvent) => logs.push(event),
      },
    };
  }

  it('does not compare when PUBLIC_STORE_DOMAIN is a custom domain: a genuine myshopify.com event is processed', async () => {
    const h = handler('www.example-shop.com');
    const response = await handleShopifyWebhook(
      await webhookRequest({
        headers: {'X-Shopify-Shop-Domain': 'test-shop.myshopify.com'},
      }),
      h.deps,
    );
    expect(response.status).toBe(200);
    await Promise.all(h.tasks);
    expect(h.processed).toEqual(['7001']);
  });

  it('a mismatch between two myshopify.com names is ignored with 200 and logged at ERROR level', async () => {
    const h = handler('test-shop.myshopify.com');
    const response = await handleShopifyWebhook(
      await webhookRequest({
        headers: {'X-Shopify-Shop-Domain': 'other-shop.myshopify.com'},
      }),
      h.deps,
    );
    expect(response.status).toBe(200);
    await Promise.all(h.tasks);
    expect(h.processed).toEqual([]);
    expect(h.logs).toContainEqual(
      expect.objectContaining({
        level: 'error',
        event: 'webhook.ignored',
        reason: 'shop_domain_mismatch',
      }),
    );
  });
});
