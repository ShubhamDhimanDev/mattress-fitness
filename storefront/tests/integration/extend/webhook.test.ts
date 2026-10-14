// Webhook to Extend, end to end through the real code and the local MOCK (P5A-08, REQ-EXT-003, T-03, T-06,
// ADR-0009 decisions 3 and 7). The Shopify Admin API is a scripted fake; Extend is the mock over real HTTP.
// Mock-green is NOT evidence of Extend's behaviour (ADR-0009); the demo-host run is P5A-12.

import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import type {ExtendMock} from '../../../../scripts/mocks/extend-mock.mjs';
import {adminConfigFromEnv} from '~/lib/extend/admin-client';
import {createOrderCoalescer} from '~/lib/extend/order-coalescer';
import type {ExtendLogEvent} from '~/lib/extend/log';
import {
  GOOD_PLAN_ID,
  WEBHOOK_SECRET,
  adminCoverageNode,
  adminMattressNode,
  adminOrderNode,
  webhookRequest,
} from '~/lib/extend/test-fixtures';
import type {FetchLike} from '~/lib/extend/types';
import {
  handleShopifyWebhook,
  type ProcessOutcome,
  type WebhookHandlerDeps,
} from '~/lib/extend/webhook-handler';
import {createMemoryReplayStore} from '~/lib/extend/webhook';
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

type AdminScript = {
  order: unknown;
  status?: number;
  calls: number;
};

/** Shopify Admin traffic goes to the script, everything else (the Extend mock) over real HTTP. */
function routedFetch(admin: AdminScript): FetchLike {
  return (url, init) => {
    if (url.startsWith('https://test-shop.myshopify.com/')) {
      admin.calls += 1;
      return Promise.resolve(
        admin.status && admin.status !== 200
          ? new Response('denied', {status: admin.status})
          : new Response(JSON.stringify({data: {order: admin.order}})),
      );
    }
    return realFetch(url, init);
  };
}

function processorFor(
  admin: AdminScript,
  envOverrides: Record<string, unknown> = {},
) {
  const logs: ExtendLogEvent[] = [];
  const deps: ProcessDeps = {
    config: configFor(mock, envOverrides),
    admin: ADMIN,
    fetch: routedFetch(admin),
    sleep: () => Promise.resolve(),
    now: () => Date.now(),
    log: (event) => logs.push(event),
    random: () => 0,
  };
  return {deps, logs};
}

const action = {
  type: 'sync_order' as const,
  orderId: '7001',
  topic: 'orders/paid' as const,
  intent: 'report' as const,
};

const paidOrder = () => adminOrderNode();
const fulfilledOrder = () =>
  adminOrderNode([
    adminMattressNode({unfulfilledQuantity: 0}),
    adminCoverageNode({unfulfilledQuantity: 0}),
  ]);

describe('REQ-EXT-003 order sync from a webhook (mock)', () => {
  it('reports a paid order with coverage to Extend: no contract until the item is fulfilled', async () => {
    const admin: AdminScript = {order: paidOrder(), calls: 0};
    const {deps} = processorFor(admin);
    expect(await processOrderAction(action, deps)).toEqual({status: 'done'});
    expect(admin.calls).toBe(1);
    expect(putsTo(mock)).toHaveLength(1);
    const [stored] = mock.state.storedOrders();
    expect(stored?.snapshot.transactionId).toBe('7001');
    expect(
      stored?.snapshot.lineItems.map((l) => l.lineItemTransactionId),
    ).toEqual(['1001', '1002-contract']);
    expect(mock.state.contracts('7001')).toEqual([]);
  });

  it('issues the contract when the covered item is fulfilled, and a replay changes nothing', async () => {
    const admin: AdminScript = {order: paidOrder(), calls: 0};
    const {deps} = processorFor(admin);
    await processOrderAction(action, deps);

    admin.order = fulfilledOrder();
    await processOrderAction(
      {...action, topic: 'fulfillments/create', intent: 'fulfil'},
      deps,
    );
    const contracts = mock.state.contracts('7001');
    expect(contracts).toHaveLength(1);
    expect(contracts[0]).toMatchObject({
      planId: GOOD_PLAN_ID,
      status: 'active',
    });

    const before = mock.state.events.length;
    await processOrderAction(action, deps);
    await processOrderAction(action, deps);
    expect(mock.state.events.length).toBe(before);
    expect(mock.state.contracts('7001')).toHaveLength(1);
  });

  it('a full refund and a cancellation both report the order as refunded', async () => {
    const admin: AdminScript = {order: fulfilledOrder(), calls: 0};
    const {deps} = processorFor(admin);
    await processOrderAction(action, deps);
    admin.order = adminOrderNode(
      [
        adminMattressNode({unfulfilledQuantity: 0}),
        adminCoverageNode({unfulfilledQuantity: 0}),
      ],
      {displayFinancialStatus: 'REFUNDED'},
    );
    await processOrderAction(
      {...action, topic: 'refunds/create', intent: 'refund'},
      deps,
    );
    expect(mock.state.storedOrders()[0]?.snapshot.status).toBe('refunded');
    expect(mock.state.contracts('7001')[0]?.status).toBe('refunded');

    mock.state.orders.clear();
    admin.order = adminOrderNode(undefined, {
      cancelledAt: '2026-10-02T09:00:00Z',
    });
    await processOrderAction(
      {...action, topic: 'orders/cancelled', intent: 'cancel'},
      deps,
    );
    expect(mock.state.storedOrders()[0]?.snapshot.status).toBe('refunded');
  });
});

describe('ADR-0009 decision 7 cross-check through the webhook path (T-06)', () => {
  it('flags a coverage line whose paid price differs from the quoted plan price and sends nothing', async () => {
    const admin: AdminScript = {
      order: adminOrderNode([
        adminMattressNode(),
        adminCoverageNode({
          originalUnitPriceSet: {
            shopMoney: {amount: '59.99', currencyCode: 'USD'},
          },
          discountedUnitPriceSet: {
            shopMoney: {amount: '59.99', currencyCode: 'USD'},
          },
        }),
      ]),
      calls: 0,
    };
    const {deps, logs} = processorFor(admin);
    expect(await processOrderAction(action, deps)).toEqual({status: 'done'});
    expect(putsTo(mock)).toHaveLength(0);
    const flagged = logs.find(
      (event) => event.event === 'sync.coverage_flagged',
    );
    expect(flagged).toMatchObject({
      orderId: '7001',
      lineIds: ['1002'],
      reason: 'price_mismatch',
    });
  });

  it('flags a cheap coverage line bought alone and a plan id that Extend does not offer', async () => {
    const alone: AdminScript = {
      order: adminOrderNode([adminCoverageNode()]),
      calls: 0,
    };
    const a = processorFor(alone);
    await processOrderAction(action, a.deps);
    expect(
      a.logs.find((e) => e.event === 'sync.coverage_flagged')?.reason,
    ).toBe('covered_product_missing');

    const forged: AdminScript = {
      order: adminOrderNode([
        adminMattressNode(),
        adminCoverageNode({
          customAttributes: [
            {key: '_extend_plan_id', value: 'FORGED-PLAN'},
            {key: '_extend_covered_product_id', value: '501'},
          ],
        }),
      ]),
      calls: 0,
    };
    const f = processorFor(forged);
    await processOrderAction(action, f.deps);
    expect(
      f.logs.find((e) => e.event === 'sync.coverage_flagged')?.reason,
    ).toBe('unknown_plan');
    expect(putsTo(mock)).toHaveLength(0);
  });

  it('syncs the good line and flags only the bad one on a mixed order', async () => {
    const admin: AdminScript = {
      order: adminOrderNode([
        adminMattressNode(),
        adminCoverageNode(),
        adminCoverageNode({
          id: 'gid://shopify/LineItem/1003',
          customAttributes: [
            {key: '_extend_plan_id', value: GOOD_PLAN_ID},
            {key: '_extend_covered_product_id', value: '777'},
          ],
        }),
      ]),
      calls: 0,
    };
    const {deps, logs} = processorFor(admin);
    await processOrderAction(action, deps);
    expect(putsTo(mock)).toHaveLength(1);
    expect(
      mock.state
        .storedOrders()[0]
        ?.snapshot.lineItems.map((l) => l.lineItemTransactionId),
    ).toEqual(['1001', '1002-contract']);
    expect(
      logs.find((e) => e.event === 'sync.coverage_flagged')?.lineIds,
    ).toEqual(['1003']);
  });
});

describe('EXTEND_ORDER_SYNC guard (ADR-0009 decision 3)', () => {
  it.each(['extend-app', 'off'])(
    'mode %s reads nothing from Shopify and sends nothing to Extend',
    async (mode) => {
      const admin: AdminScript = {order: paidOrder(), calls: 0};
      const {deps, logs} = processorFor(admin, {EXTEND_ORDER_SYNC: mode});
      expect(await processOrderAction(action, deps)).toEqual({status: 'done'});
      expect(admin.calls).toBe(0);
      expect(mock.state.requests).toHaveLength(0);
      expect(logs.map((e) => e.event)).toEqual(['sync.skipped']);
    },
  );

  it('an unrecognised mode disables Extend instead of guessing', async () => {
    const admin: AdminScript = {order: paidOrder(), calls: 0};
    const {deps, logs} = processorFor(admin, {EXTEND_ORDER_SYNC: 'sometimes'});
    expect(await processOrderAction(action, deps)).toEqual({status: 'done'});
    expect(admin.calls).toBe(0);
    expect(logs[0]?.reason).toContain('invalid_order_sync');
  });

  it('order sync keeps running when the UI flag is off, so existing coverage still reaches Extend', async () => {
    const admin: AdminScript = {order: paidOrder(), calls: 0};
    const logs: ExtendLogEvent[] = [];
    const deps: ProcessDeps = {
      ...processorFor(admin).deps,
      // The runtime parses the sync config with requireFlag false; the flag value is irrelevant to it.
      config: configFor(mock),
      log: (event) => logs.push(event),
    };
    await processOrderAction(action, deps);
    expect(putsTo(mock)).toHaveLength(1);
  });
});

describe('failure paths: partial failure and provider down', () => {
  it('Shopify Admin refusing the token fails the sync without touching Extend', async () => {
    const admin: AdminScript = {order: paidOrder(), calls: 0, status: 401};
    const {deps, logs} = processorFor(admin);
    expect(await processOrderAction(action, deps)).toEqual({status: 'failed'});
    expect(mock.state.requests).toHaveLength(0);
    expect(logs).toContainEqual(
      expect.objectContaining({
        event: 'webhook.order_read_failed',
        reason: 'auth',
        orderId: '7001',
      }),
    );
  });

  it('Extend down: the sync reports failure (so the id is not marked) and retries are bounded', async () => {
    mock.setFault({path: '/orders', status: 503});
    const admin: AdminScript = {order: paidOrder(), calls: 0};
    const {deps, logs} = processorFor(admin);
    expect(await processOrderAction(action, deps)).toEqual({status: 'failed'});
    expect(putsTo(mock).length).toBeLessThanOrEqual(3);
    expect(logs.some((e) => e.event === 'sync.gave_up')).toBe(true);

    mock.clearFault();
    expect(await processOrderAction(action, deps)).toEqual({status: 'done'});
    expect(mock.state.storedOrders()).toHaveLength(1);
  });

  it('Extend slow on the quote lookup fails as retriable and sends nothing', async () => {
    mock.setFault({path: '/offers', status: 500});
    const admin: AdminScript = {order: paidOrder(), calls: 0};
    const {deps} = processorFor(admin);
    expect(await processOrderAction(action, deps)).toEqual({status: 'failed'});
    expect(putsTo(mock)).toHaveLength(0);
  });

  it('an order with no coverage is read and skipped: nothing is sent', async () => {
    const admin: AdminScript = {
      order: adminOrderNode([adminMattressNode()]),
      calls: 0,
    };
    const {deps} = processorFor(admin);
    expect(await processOrderAction(action, deps)).toEqual({status: 'done'});
    expect(putsTo(mock)).toHaveLength(0);
  });
});

describe('the whole route path: signed webhook to contract', () => {
  it('a signed orders/paid webhook answers 200 at once, then the order is read and reported', async () => {
    const admin: AdminScript = {order: paidOrder(), calls: 0};
    const {deps} = processorFor(admin);
    const tasks: Promise<unknown>[] = [];
    const replay = createMemoryReplayStore({now: () => Date.now()});
    const handlerDeps: WebhookHandlerDeps = {
      secret: WEBHOOK_SECRET,
      replay,
      coalescer: createOrderCoalescer<ProcessOutcome>({
        now: () => Date.now(),
        sleep: () => Promise.resolve(),
      }),
      process: (a) => processOrderAction(a, deps),
      schedule: (task: Promise<unknown>) => {
        tasks.push(task);
      },
      now: () => Date.now(),
    };

    const response = await handleShopifyWebhook(
      await webhookRequest({
        body: JSON.stringify({id: 7001, email: 'ignored@example.test'}),
      }),
      handlerDeps,
    );
    expect(response.status).toBe(200);
    await Promise.all(tasks);

    expect(putsTo(mock)).toHaveLength(1);
    // The webhook body is only a trigger: the order content came from the Admin read.
    expect(JSON.stringify(mock.state.storedOrders())).not.toContain(
      'ignored@example.test',
    );
    expect(await replay.seen('wh-00000001-aaaa')).toBe(true);

    // A tampered or unsigned replay never reaches the sync.
    const bad = await handleShopifyWebhook(
      await webhookRequest({signature: 'AAAA', webhookId: 'wh-00000002-bbbb'}),
      handlerDeps,
    );
    expect(bad.status).toBe(401);
    await Promise.all(tasks);
    expect(admin.calls).toBe(1);
  });
});
