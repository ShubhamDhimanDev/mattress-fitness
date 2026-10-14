// P5B-05 / REQ-PRE-004 / T-06 (review m1): the detective drops its `coverage_price_unjudged` note only when the Extend
// sync really compared the order's protection price with Extend's quote and sent it. A sync that failed, was blocked by an
// open breaker, or could not reach Extend verified nothing, so the order must not read quiet. Real code, local MOCK
// Extend (ADR-0009: mock-green is not evidence of Extend's behaviour), scripted Shopify Admin.

import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import type {ExtendMock} from '../../../../scripts/mocks/extend-mock.mjs';
import {
  RULES,
  ZONE,
  adminDetectiveLineNode,
  adminDetectiveOrderNode,
} from '~/lib/detective/test-fixtures';
import type {DetectiveConfig} from '~/lib/detective/types';
import {adminConfigFromEnv} from '~/lib/extend/admin-client';
import type {ExtendLogEvent} from '~/lib/extend/log';
import {
  GOOD_PLAN_ID,
  adminCoverageNode,
  adminMattressNode,
  adminOrderNode,
} from '~/lib/extend/test-fixtures';
import type {FetchLike} from '~/lib/extend/types';
import {
  processOrderAction,
  type ProcessDeps,
} from '~/lib/extend/webhook-processor';
import {configFor, putsTo, realFetch, startTestMock} from './support';

let mock: ExtendMock;
beforeEach(async () => {
  mock = await startTestMock();
});
afterEach(async () => {
  await mock.close();
});

const ADMIN = adminConfigFromEnv({
  PUBLIC_STORE_DOMAIN: 'test-shop.myshopify.com',
  SHOPIFY_ADMIN_API_ACCESS_TOKEN: 'fixture-admin-token-not-real',
});
const READY: DetectiveConfig = {status: 'ready', rules: RULES, zone: ZONE};

const action = {
  type: 'sync_order' as const,
  orderId: '7001',
  topic: 'orders/paid' as const,
  intent: 'report' as const,
};

/** The same paid order as the detective reads it: a mattress and its 79.99 protection line. */
const detectiveOrder = () =>
  adminDetectiveOrderNode([
    adminDetectiveLineNode({id: 'gid://shopify/LineItem/1001'}),
    adminDetectiveLineNode({
      id: 'gid://shopify/LineItem/1002',
      title: 'Extend Protection Plan',
      variantTitle: 'Extend-Protection-Plan-79.99',
      sku: 'Extend-Protection-Plan-79.99',
      customAttributes: [
        {key: '_extend_plan_id', value: GOOD_PLAN_ID},
        {key: '_extend_covered_product_id', value: '501'},
      ],
      product: {id: 'gid://shopify/Product/9001', metafield: null},
      variant: {
        id: 'gid://shopify/ProductVariant/9100000006',
        selectedOptions: [],
      },
    }),
  ]);

function operationOf(body: string | undefined): string | null {
  const parsed: unknown = JSON.parse(body ?? '{}');
  const name: unknown =
    typeof parsed === 'object' && parsed !== null
      ? Reflect.get(parsed, 'operationName')
      : null;
  return typeof name === 'string' ? name : null;
}

function processorFor(options: {syncReadStatus?: number} = {}) {
  const logs: ExtendLogEvent[] = [];
  const fetchFn: FetchLike = (url, init) => {
    if (!url.startsWith('https://test-shop.myshopify.com/')) {
      return realFetch(url, init);
    }
    const operation = operationOf(init.body);
    if (operation === 'ExtendOrderById') {
      return Promise.resolve(
        options.syncReadStatus
          ? new Response('denied', {status: options.syncReadStatus})
          : new Response(JSON.stringify({data: {order: adminOrderNode()}})),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify({data: {order: detectiveOrder()}})),
    );
  };
  const deps: ProcessDeps = {
    config: configFor(mock),
    admin: ADMIN,
    fetch: fetchFn,
    sleep: () => Promise.resolve(),
    now: () => Date.now(),
    log: (event) => logs.push(event),
    random: () => 0,
    detective: READY,
  };
  const detective = () =>
    logs
      .filter((e) => e.event.startsWith('detective.'))
      .map((e) => `${e.event}:${e.reason}`);
  return {deps, detective};
}

describe('P5B-05 coverage price: the note is dropped only when the sync verified it', () => {
  it('sync done and sent with a verified quote: the detective does not repeat the note', async () => {
    const h = processorFor();
    expect(await processOrderAction(action, h.deps)).toEqual({status: 'done'});
    expect(putsTo(mock)).toHaveLength(1);
    expect(h.detective()).toEqual(['detective.checked:clean']);
  });

  it('Extend down on the order PUT: the sync failed, nothing was verified, the note stays', async () => {
    mock.setFault({path: '/orders', status: 503});
    const h = processorFor();
    expect(await processOrderAction(action, h.deps)).toEqual({
      status: 'failed',
    });
    expect(h.detective()).toEqual([
      'detective.checked:unjudgeable',
      'detective.unjudged:coverage_price_unjudged',
    ]);
  });

  it('Extend down on the quote lookup: the note stays', async () => {
    mock.setFault({path: '/offers', status: 500});
    const h = processorFor();
    expect(await processOrderAction(action, h.deps)).toEqual({
      status: 'failed',
    });
    expect(h.detective()).toContain(
      'detective.unjudged:coverage_price_unjudged',
    );
  });

  it('the sync could not read the order: the note stays', async () => {
    const h = processorFor({syncReadStatus: 401});
    expect(await processOrderAction(action, h.deps)).toEqual({
      status: 'failed',
    });
    expect(h.detective()).toContain(
      'detective.unjudged:coverage_price_unjudged',
    );
  });

  it('a sync that skipped because every coverage line was flagged verified nothing: the note stays', async () => {
    // The Extend-side read has a protection line pointing at a product that is not on the order, so it is flagged and
    // never sent; the price of that line was never compared.
    const h = processorFor();
    const original = h.deps.fetch;
    h.deps.fetch = (url, init) =>
      operationOf(init.body) === 'ExtendOrderById'
        ? Promise.resolve(
            new Response(
              JSON.stringify({
                data: {
                  order: adminOrderNode([
                    adminMattressNode(),
                    adminCoverageNode({
                      customAttributes: [
                        {key: '_extend_plan_id', value: GOOD_PLAN_ID},
                        {key: '_extend_covered_product_id', value: '999'},
                      ],
                    }),
                  ]),
                },
              }),
            ),
          )
        : original(url, init);
    await processOrderAction(action, h.deps);
    expect(putsTo(mock)).toHaveLength(0);
    expect(h.detective()).toContain(
      'detective.unjudged:coverage_price_unjudged',
    );
  });
});
