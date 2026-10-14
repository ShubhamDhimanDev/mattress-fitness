import {describe, expect, it} from 'vitest';
import type {ExtendLogEvent} from '~/lib/extend/log';
import {createOrderCoalescer} from '~/lib/extend/order-coalescer';
import {
  WEBHOOK_SECRET,
  signBody,
  webhookRequest,
  type WebhookRequestOptions,
} from '~/lib/extend/test-fixtures';
import {
  WEBHOOK_MAX_AGE_MS,
  handleShopifyWebhook,
  readCappedBody,
  type ProcessOutcome,
  type WebhookHandlerDeps,
} from '~/lib/extend/webhook-handler';
import {
  createMemoryReplayStore,
  type WebhookAction,
} from '~/lib/extend/webhook';

// REQ-EXT-003 / T-03 / security review L-1: HMAC on the raw body, 401 without detail, fast 200, background sync,
// replay and flood control per order, freshness window above Shopify's 4 hours of retries.

const NOW = Date.parse('2026-10-13T12:00:00Z');
const hoursAgo = (hours: number) =>
  new Date(NOW - hours * 3_600_000).toISOString();

type Harness = {
  deps: WebhookHandlerDeps;
  actions: WebhookAction[];
  tasks: Promise<unknown>[];
  logs: ExtendLogEvent[];
  clock: {t: number};
  drain: () => Promise<void>;
  replay: ReturnType<typeof createMemoryReplayStore>;
};

function harness(
  processor: (action: WebhookAction) => Promise<ProcessOutcome> = () =>
    Promise.resolve({status: 'done'}),
  overrides: Partial<WebhookHandlerDeps> = {},
): Harness {
  const clock = {t: NOW};
  const actions: WebhookAction[] = [];
  const tasks: Promise<unknown>[] = [];
  const logs: ExtendLogEvent[] = [];
  const replay = createMemoryReplayStore({now: () => clock.t});
  const deps: WebhookHandlerDeps = {
    secret: WEBHOOK_SECRET,
    replay,
    coalescer: createOrderCoalescer<ProcessOutcome>({
      now: () => clock.t,
      sleep: (ms) => {
        clock.t += ms;
        return Promise.resolve();
      },
    }),
    process: (action) => {
      actions.push(action);
      return processor(action);
    },
    schedule: (task) => {
      tasks.push(task);
    },
    now: () => clock.t,
    log: (event) => logs.push(event),
    ...overrides,
  };
  return {
    deps,
    actions,
    tasks,
    logs,
    clock,
    replay,
    drain: async () => {
      await Promise.all(tasks);
    },
  };
}

const send = (h: Harness, options: WebhookRequestOptions = {}) =>
  webhookRequest({triggeredAt: new Date(NOW).toISOString(), ...options}).then(
    (request) => handleShopifyWebhook(request, h.deps),
  );

describe('REQ-EXT-003 webhook receiver: authentication (T-03)', () => {
  it('accepts a correctly signed webhook, answers 200 with no body and syncs the order once', async () => {
    const h = harness();
    const response = await send(h);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    await h.drain();
    expect(h.actions).toEqual([
      {
        type: 'sync_order',
        orderId: '7001',
        topic: 'orders/paid',
        intent: 'report',
      },
    ]);
  });

  it.each([
    ['a missing signature', {signature: null}],
    ['an empty signature', {signature: ''}],
    ['a wrong signature', {signature: 'AAAA'}],
    ['a truncated signature', {signature: 'x'.repeat(10)}],
    ['the wrong secret', {secret: 'another-secret'}],
  ])('rejects %s with 401, no body and no work', async (_name, options) => {
    const h = harness();
    const response = await send(h, options);
    expect(response.status).toBe(401);
    expect(await response.text()).toBe('');
    await h.drain();
    expect(h.actions).toEqual([]);
    expect(h.tasks).toEqual([]);
  });

  it('rejects a tampered body even when the signature is valid for the original body', async () => {
    const h = harness();
    const original = JSON.stringify({id: 7001});
    const signature = await signBody(original, WEBHOOK_SECRET);
    const response = await send(h, {
      body: JSON.stringify({id: 9999}),
      signature,
    });
    expect(response.status).toBe(401);
    expect(h.actions).toEqual([]);
  });

  it('verifies the exact bytes: re-serialised JSON with different spacing is a different message', async () => {
    const h = harness();
    const signature = await signBody('{"id":7001}', WEBHOOK_SECRET);
    const response = await send(h, {body: '{ "id": 7001 }', signature});
    expect(response.status).toBe(401);
  });

  it('answers the same 401 whatever else is wrong, so nothing leaks before authentication', async () => {
    const h = harness();
    const responses = await Promise.all([
      send(h, {signature: null, topic: 'not/a/topic'}),
      send(h, {signature: null, webhookId: '!'}),
      send(h, {signature: null, triggeredAt: null}),
      send(h, {signature: null, body: 'not json'}),
    ]);
    expect(responses.map((r) => r.status)).toEqual([401, 401, 401, 401]);
  });

  it('fails closed with 503 when the secret is not configured, logging only the variable name', async () => {
    const h = harness(undefined, {secret: null});
    const response = await send(h);
    expect(response.status).toBe(503);
    expect(h.actions).toEqual([]);
    expect(JSON.stringify(h.logs)).toContain('SHOPIFY_APP_CLIENT_SECRET');
    expect(JSON.stringify(h.logs)).not.toContain(WEBHOOK_SECRET);
  });

  it('refuses a secret that is an empty string', async () => {
    const h = harness(undefined, {secret: ''});
    expect((await send(h)).status).toBe(503);
  });

  it('answers 405 to anything but POST', async () => {
    const h = harness();
    const response = await handleShopifyWebhook(
      await webhookRequest({method: 'GET'}),
      h.deps,
    );
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST');
  });
});

describe('REQ-EXT-003 webhook receiver: size (review L-1)', () => {
  it('refuses a declared Content-Length over the cap before reading the body', async () => {
    const h = harness();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(4));
        controller.close();
      },
    });
    const request = new Request('https://shop.example.test/webhooks/shopify', {
      method: 'POST',
      headers: {'Content-Length': String(6 * 1024 * 1024)},
      body,
      duplex: 'half',
    } as RequestInit);
    const response = await handleShopifyWebhook(request, h.deps);
    expect(response.status).toBe(413);
    // Nothing was pulled from the body: the length alone was enough to refuse it.
    expect(request.bodyUsed).toBe(false);
  });

  it('refuses a non-numeric Content-Length', async () => {
    const h = harness();
    const response = await send(h, {headers: {'Content-Length': 'abc'}});
    expect([400, 401]).toContain(response.status);
    expect(h.actions).toEqual([]);
  });

  it('cuts off a streamed body at the cap even when no length was declared', async () => {
    const request = new Request('https://shop.example.test/x', {
      method: 'POST',
      body: 'x'.repeat(50),
    });
    expect(await readCappedBody(request, 10)).toEqual({status: 'too_large'});
    const ok = await readCappedBody(
      new Request('https://shop.example.test/x', {method: 'POST', body: 'abc'}),
      10,
    );
    expect(ok.status).toBe('ok');
  });
});

describe('REQ-EXT-003 webhook receiver: freshness window (review L-1)', () => {
  it("uses a window above Shopify's 4 hours of retries", () => {
    expect(WEBHOOK_MAX_AGE_MS).toBeGreaterThan(4 * 3_600_000);
  });

  it("accepts a delivery retried near the end of Shopify's 4 hour retry period", async () => {
    const h = harness();
    expect((await send(h, {triggeredAt: hoursAgo(4.2)})).status).toBe(200);
    await h.drain();
    expect(h.actions).toHaveLength(1);
  });

  it('acknowledges but ignores a body older than the window (a replay of an old capture)', async () => {
    const h = harness();
    const response = await send(h, {triggeredAt: hoursAgo(7)});
    expect(response.status).toBe(200);
    await h.drain();
    expect(h.actions).toEqual([]);
    expect(h.logs.map((e) => e.event)).toContain('webhook.ignored');
  });

  it('rejects a missing, malformed or future timestamp after the signature is proven', async () => {
    const h = harness();
    expect((await send(h, {triggeredAt: null})).status).toBe(400);
    expect((await send(h, {triggeredAt: 'yesterday'})).status).toBe(400);
    expect((await send(h, {triggeredAt: hoursAgo(-2)})).status).toBe(400);
    expect(h.actions).toEqual([]);
  });
});

describe('REQ-EXT-003 webhook receiver: routing', () => {
  it('routes refund and fulfilment topics to their orders', async () => {
    const h = harness();
    await send(h, {
      topic: 'refunds/create',
      body: JSON.stringify({id: 55, order_id: 7002}),
      webhookId: 'wh-refund-0001',
    });
    await send(h, {
      topic: 'fulfillments/create',
      body: JSON.stringify({id: 66, order_id: 7003}),
      webhookId: 'wh-fulfil-0001',
    });
    await h.drain();
    expect(h.actions.map((a) => [a.orderId, a.intent])).toEqual([
      ['7002', 'refund'],
      ['7003', 'fulfil'],
    ]);
  });

  it('acknowledges a topic it does not handle, without work', async () => {
    const h = harness();
    expect((await send(h, {topic: 'products/update'})).status).toBe(200);
    expect(h.actions).toEqual([]);
  });

  it.each([
    ['no webhook id', {webhookId: ''}],
    ['an id with a space and punctuation', {webhookId: 'abc def;12345'}],
    ['a short id', {webhookId: 'abc'}],
  ])('rejects %s with 400', async (_name, options) => {
    const h = harness();
    expect((await send(h, options)).status).toBe(400);
  });

  it.each([
    ['not JSON', 'not json'],
    ['no order id', JSON.stringify({something: 1})],
    ['a hostile order id', JSON.stringify({id: '7001; DROP TABLE'})],
    ['an array', '[]'],
  ])('rejects a signed body that is %s with 400', async (_name, body) => {
    const h = harness();
    expect((await send(h, {body})).status).toBe(400);
    expect(h.actions).toEqual([]);
  });
});

describe('REQ-EXT-003 webhook receiver: background sync, replay and flood control', () => {
  it('answers 200 before the sync has finished', async () => {
    let finish: (outcome: ProcessOutcome) => void = () => {};
    const h = harness(
      () =>
        new Promise<ProcessOutcome>((resolve) => {
          finish = resolve;
        }),
    );
    const response = await send(h);
    expect(response.status).toBe(200);
    expect(h.actions).toHaveLength(1);
    expect(await h.replay.seen('wh-00000001-aaaa')).toBe(false);
    finish({status: 'done'});
    await h.drain();
    expect(await h.replay.seen('wh-00000001-aaaa')).toBe(true);
  });

  it('marks a webhook id seen only after a successful sync, so a failed delivery can be repeated', async () => {
    let outcome: ProcessOutcome = {status: 'failed'};
    const h = harness(() => Promise.resolve(outcome));
    await send(h);
    await h.drain();
    expect(await h.replay.seen('wh-00000001-aaaa')).toBe(false);
    expect(h.logs.map((e) => e.event)).toContain('webhook.background_failed');

    h.clock.t += 20_000;
    outcome = {status: 'done'};
    await send(h);
    await h.drain();
    expect(h.actions).toHaveLength(2);
    expect(await h.replay.seen('wh-00000001-aaaa')).toBe(true);
  });

  it('acknowledges a repeated webhook id without syncing again', async () => {
    const h = harness();
    await send(h);
    await h.drain();
    const again = await send(h);
    expect(again.status).toBe(200);
    await h.drain();
    expect(h.actions).toHaveLength(1);
  });

  it('a sync that crashes is contained: the 200 was already sent and the id is not marked', async () => {
    const h = harness(() => Promise.reject(new Error('boom')));
    expect((await send(h)).status).toBe(200);
    await h.drain();
    expect(await h.replay.seen('wh-00000001-aaaa')).toBe(false);
    expect(JSON.stringify(h.logs)).not.toContain('boom');
  });

  it('a flood of fresh webhook ids for ONE order (a replayed signed body) costs at most two syncs', async () => {
    let finish: (outcome: ProcessOutcome) => void = () => {};
    const h = harness(
      () =>
        new Promise<ProcessOutcome>((resolve) => {
          finish = resolve;
        }),
    );
    const body = JSON.stringify({id: 7001});
    for (let i = 0; i < 25; i += 1) {
      const response = await send(h, {
        body,
        webhookId: `wh-flood-${String(i).padStart(4, '0')}`,
      });
      expect(response.status).toBe(200);
    }
    expect(h.actions).toHaveLength(1);
    expect(h.logs.filter((e) => e.event === 'webhook.coalesced')).toHaveLength(
      24,
    );
    finish({status: 'done'});
    await new Promise((resolve) => setImmediate(resolve));
    finish({status: 'done'});
    await h.drain();
    expect(h.actions).toHaveLength(2);
  });

  it('different orders are independent', async () => {
    const h = harness();
    await send(h, {body: JSON.stringify({id: 1}), webhookId: 'wh-order-0001'});
    await send(h, {body: JSON.stringify({id: 2}), webhookId: 'wh-order-0002'});
    await h.drain();
    expect(h.actions.map((a) => a.orderId).sort()).toEqual(['1', '2']);
  });

  it('logs ids and reasons only: no body, no header values, no secret', async () => {
    const h = harness();
    await send(h, {
      body: JSON.stringify({id: 7001, email: 'jane@example.test'}),
    });
    await h.drain();
    const text = JSON.stringify(h.logs);
    expect(text).not.toContain('jane@example.test');
    expect(text).not.toContain(WEBHOOK_SECRET);
    expect(text).toContain('7001');
  });
});
