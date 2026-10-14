import {describe, expect, it} from 'vitest';
import {adminConfigFromEnv, readOrderForSync} from '~/lib/extend/admin-client';
import {readCappedBody} from '~/lib/extend/capped-body';
import {parseExtendConfig} from '~/lib/extend/config';
import {
  createDistinctVariantLimiter,
  isSameSiteFetch,
} from '~/lib/extend/offers-endpoint';
import {createOrderCoalescer} from '~/lib/extend/order-coalescer';
import {
  WEBHOOK_SECRET,
  adminOrderNode,
  webhookRequest,
} from '~/lib/extend/test-fixtures';
import type {FetchLike} from '~/lib/extend/types';
import {routeShopifyTopic, createMemoryReplayStore} from '~/lib/extend/webhook';
import {
  handleShopifyWebhook,
  type ProcessOutcome,
} from '~/lib/extend/webhook-handler';

// Review follow-ups: E-M2 (fetch metadata, distinct-variant cap), E-L2 (order id by payload shape, shop domain),
// E-L7 (explicit production flag), capped bodies, and a hostile GraphQL error shape.

describe('E-L7 parseExtendConfig needs an explicit production flag', () => {
  const env = {
    PUBLIC_EXTEND_ENABLED: 'true',
    EXTEND_API_HOST: 'http://127.0.0.1:4010',
    EXTEND_STORE_ID: 'store-1',
    EXTEND_ACCESS_TOKEN: 'fixture-token-not-real',
  };

  it('allows the loopback mock only when production is explicitly false', () => {
    expect(parseExtendConfig(env, {production: false}).status).toBe('enabled');
    expect(parseExtendConfig(env, {production: true})).toMatchObject({
      status: 'disabled',
      reason: 'invalid_host',
    });
  });

  it('fails closed when untyped code forgets the flag', () => {
    // Test-only narrowing: simulates untyped code that omits the required flag.
    expect(parseExtendConfig(env, {requireFlag: true} as never)).toMatchObject({
      status: 'disabled',
      reason: 'invalid_host',
    });
  });
});

describe('E-M2 offers route guards', () => {
  it('accepts same-origin, same-site and navigation fetches, refuses cross-site, allows no header', () => {
    const header = (value: string | null) => ({get: () => value});
    expect(isSameSiteFetch(header(null))).toBe(true);
    for (const ok of ['same-origin', 'same-site', 'none']) {
      expect(isSameSiteFetch(header(ok))).toBe(true);
    }
    expect(isSameSiteFetch(header('cross-site'))).toBe(false);
    expect(isSameSiteFetch(header('anything-else'))).toBe(false);
  });

  it('caps DISTINCT variants per window; repeats of known variants are free; the window expires', () => {
    const clock = {t: 0};
    const limiter = createDistinctVariantLimiter({
      now: () => clock.t,
      perWindow: 3,
      windowMs: 1000,
    });
    expect(limiter.allow(['a', 'b', 'c'])).toBe(true);
    expect(limiter.allow(['a', 'b'])).toBe(true);
    expect(limiter.allow(['d'])).toBe(false);
    clock.t += 1001;
    expect(limiter.allow(['d', 'e'])).toBe(true);
  });
});

describe('E-L2 webhook order id and shop domain', () => {
  it('reads the order id from the body shape: order_id wins whatever the Topic header says', () => {
    const refund = {id: 55, order_id: 7002};
    for (const topic of [
      'refunds/create',
      'orders/paid',
      'fulfillments/create',
    ]) {
      expect(routeShopifyTopic(topic, refund)).toMatchObject({
        status: 'ok',
        action: {orderId: '7002'},
      });
    }
  });

  it('does not read a refund-shaped id as an order id, and refuses an order topic body without an id', () => {
    expect(routeShopifyTopic('refunds/create', {id: 55})).toMatchObject({
      status: 'error',
      reason: 'malformed_payload',
    });
    expect(routeShopifyTopic('orders/paid', {})).toMatchObject({
      status: 'error',
    });
    expect(routeShopifyTopic('orders/paid', {id: 7001})).toMatchObject({
      status: 'ok',
      action: {orderId: '7001'},
    });
  });

  function handler(expectedShopDomain: string | null) {
    const processed: string[] = [];
    const tasks: Promise<unknown>[] = [];
    const clock = {t: Date.now()};
    return {
      processed,
      tasks,
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
      },
    };
  }

  it('ignores (200, no work) an event whose shop domain is another store', async () => {
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
  });

  it('processes a matching domain (case and scheme insensitive) and a missing header', async () => {
    const h = handler('https://Test-Shop.myshopify.com/');
    await handleShopifyWebhook(
      await webhookRequest({
        webhookId: 'wh-shop-0001',
        headers: {'X-Shopify-Shop-Domain': 'test-shop.myshopify.com'},
      }),
      h.deps,
    );
    await handleShopifyWebhook(
      await webhookRequest({
        webhookId: 'wh-shop-0002',
        body: JSON.stringify({id: 7003}),
      }),
      h.deps,
    );
    await Promise.all(h.tasks);
    expect(h.processed.sort()).toEqual(['7001', '7003']);
  });

  it('does not compare when this deployment does not know its own domain', async () => {
    const h = handler(null);
    await handleShopifyWebhook(
      await webhookRequest({
        headers: {'X-Shopify-Shop-Domain': 'x.myshopify.com'},
      }),
      h.deps,
    );
    await Promise.all(h.tasks);
    expect(h.processed).toEqual(['7001']);
  });

  it('still needs a valid signature: a matching domain does not replace it', async () => {
    const h = handler('test-shop.myshopify.com');
    const response = await handleShopifyWebhook(
      await webhookRequest({
        signature: 'AAAA',
        headers: {'X-Shopify-Shop-Domain': 'test-shop.myshopify.com'},
      }),
      h.deps,
    );
    expect(response.status).toBe(401);
  });
});

describe('capped body and hostile GraphQL shapes', () => {
  it('reads a Response body under the cap and refuses one over it, declared or streamed', async () => {
    expect((await readCappedBody(new Response('abc'), 10)).status).toBe('ok');
    expect(await readCappedBody(new Response('x'.repeat(50)), 10)).toEqual({
      status: 'too_large',
    });
    expect(
      await readCappedBody(
        new Response('x', {headers: {'Content-Length': '99999'}}),
        10,
      ),
    ).toEqual({status: 'too_large'});
    expect(
      await readCappedBody(
        new Response('x', {headers: {'Content-Length': 'abc'}}),
        10,
      ),
    ).toEqual({status: 'unreadable'});
  });

  const admin = adminConfigFromEnv({
    PUBLIC_STORE_DOMAIN: 'test-shop.myshopify.com',
    SHOPIFY_ADMIN_API_ACCESS_TOKEN: 'fixture-admin-token-not-real',
  });
  const answer =
    (body: unknown): FetchLike =>
    () =>
      Promise.resolve(new Response(JSON.stringify(body)));

  it.each([
    ['extensions is a string', {errors: [{extensions: 'THROTTLED'}]}],
    ['extensions is null', {errors: [{extensions: null}]}],
    ['the error is a string', {errors: ['boom']}],
    ['extensions is a number', {errors: [{extensions: 7}]}],
  ])(
    'a GraphQL error whose %s is a final GraphQL failure, not a crash',
    async (_name, body) => {
      const result = await readOrderForSync(
        {admin, fetch: answer(body), sleep: () => Promise.resolve()},
        '7001',
      );
      expect(result).toEqual({
        status: 'error',
        reason: 'graphql',
        retriable: false,
      });
    },
  );

  it('refuses an answer whose declared length is over the cap without reading it', async () => {
    const big: FetchLike = () =>
      Promise.resolve(
        new Response(JSON.stringify({data: {order: adminOrderNode()}}), {
          headers: {'Content-Length': '5000000'},
        }),
      );
    const result = await readOrderForSync(
      {admin, fetch: big, sleep: () => Promise.resolve()},
      '7001',
    );
    expect(result).toMatchObject({status: 'error', reason: 'malformed'});
  });
});
