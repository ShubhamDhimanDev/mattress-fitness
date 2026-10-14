import {describe, expect, it} from 'vitest';
import {
  RULES,
  SYNTHETIC_PII,
  ZONE,
  adminDetectiveHaulNode,
  adminDetectiveLineNode,
  adminDetectiveOrderNode,
} from '~/lib/detective/test-fixtures';
import type {DetectiveConfig} from '~/lib/detective/types';
import {adminConfigFromEnv} from '~/lib/extend/admin-client';
import {parseExtendConfig} from '~/lib/extend/config';
import type {ExtendLogEvent} from '~/lib/extend/log';
import {adminMattressNode, adminOrderNode} from '~/lib/extend/test-fixtures';
import type {FetchInit, FetchLike} from '~/lib/extend/types';
import {
  processOrderAction,
  type ProcessDeps,
} from '~/lib/extend/webhook-processor';
import type {WebhookAction, WebhookIntent} from '~/lib/extend/webhook';

// P5B-05 (ADR-0006 decision 3, security review E-M3): every processed order is also judged by the detective check,
// whatever EXTEND_ORDER_SYNC says, and the Extend sync behaves exactly as before (REQ-EXT-003, P5A-08).

const ADMIN_TOKEN = 'fixture-admin-token-not-real';
const EXTEND_TOKEN = 'tok_fixture_processor_0001';
const ADMIN = adminConfigFromEnv({
  PUBLIC_STORE_DOMAIN: 'test-shop.myshopify.com',
  SHOPIFY_ADMIN_API_ACCESS_TOKEN: ADMIN_TOKEN,
});
const READY: DetectiveConfig = {status: 'ready', rules: RULES, zone: ZONE};

function action(intent: WebhookIntent = 'report'): WebhookAction {
  const topic = {
    report: 'orders/paid',
    update: 'orders/updated',
    cancel: 'orders/cancelled',
    refund: 'refunds/create',
    fulfil: 'fulfillments/create',
  } as const;
  return {type: 'sync_order', orderId: '7001', topic: topic[intent], intent};
}

function extendConfig(orderSync?: string) {
  return parseExtendConfig(
    {
      PUBLIC_EXTEND_ENABLED: 'true',
      EXTEND_API_HOST: 'https://api-demo.helloextend.com',
      EXTEND_STORE_ID: 'store-fixture-1',
      EXTEND_ACCESS_TOKEN: EXTEND_TOKEN,
      ...(orderSync === undefined ? {} : {EXTEND_ORDER_SYNC: orderSync}),
    },
    {production: false},
  );
}

type Call = {url: string; operation: string | null; init: FetchInit};

type Options = {
  extend?: ReturnType<typeof extendConfig>;
  detective?: DetectiveConfig | undefined;
  admin?: ProcessDeps['admin'];
  /** The detective order node; a function runs per call. */
  detectiveAnswer?: () => Response;
  extendOrderAnswer?: () => Response;
};

/** The GraphQL operationName of a request body, or null. */
function operationOf(body: string | undefined): string | null {
  const parsed: unknown = JSON.parse(body ?? '{}');
  const name: unknown =
    typeof parsed === 'object' && parsed !== null
      ? Reflect.get(parsed, 'operationName')
      : null;
  return typeof name === 'string' ? name : null;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {status});

function harness(options: Options = {}) {
  const calls: Call[] = [];
  const logs: ExtendLogEvent[] = [];
  const fetchFn: FetchLike = (url, init) => {
    const operation = url.includes('myshopify.com')
      ? operationOf(init.body)
      : null;
    calls.push({url, operation, init});
    if (operation === 'DetectiveOrderById') {
      return Promise.resolve(
        options.detectiveAnswer?.() ??
          json({data: {order: adminDetectiveOrderNode()}}),
      );
    }
    if (operation === 'ExtendOrderById') {
      return Promise.resolve(
        options.extendOrderAnswer?.() ??
          json({data: {order: adminOrderNode([adminMattressNode()])}}),
      );
    }
    return Promise.resolve(json({}));
  };
  const deps: ProcessDeps = {
    config: options.extend ?? extendConfig('self'),
    admin: options.admin ?? ADMIN,
    fetch: fetchFn,
    sleep: () => Promise.resolve(),
    now: () => Date.parse('2026-10-14T00:00:00Z'),
    log: (event) => logs.push(event),
    ...('detective' in options
      ? options.detective === undefined
        ? {}
        : {detective: options.detective}
      : {detective: READY}),
  };
  return {
    deps,
    calls,
    logs,
    detectiveLogs: () => logs.filter((e) => e.event.startsWith('detective.')),
    operations: () => calls.map((call) => call.operation),
  };
}

const haulOrder = (zip: string, quantity = 1, attributes?: unknown) =>
  adminDetectiveOrderNode(
    [adminDetectiveLineNode(), adminDetectiveHaulNode(2, quantity)],
    {
      shippingAddress: {countryCodeV2: 'US', zip},
      ...(attributes === undefined ? {} : {customAttributes: attributes}),
    },
  );

describe('P5B-05 the detective check runs regardless of EXTEND_ORDER_SYNC', () => {
  it.each(['off', 'extend-app'])(
    'with order sync %s it logs the violation by order id and code, and makes no Extend call',
    async (mode) => {
      const h = harness({
        extend: extendConfig(mode),
        detectiveAnswer: () => json({data: {order: haulOrder('90210')}}),
      });
      const outcome = await processOrderAction(action(), h.deps);
      expect(outcome).toEqual({status: 'done'});
      expect(h.operations()).toEqual(['DetectiveOrderById']);
      expect(h.calls.some((c) => c.url.includes('helloextend'))).toBe(false);
      expect(h.detectiveLogs()).toEqual([
        {
          level: 'warn',
          event: 'detective.checked',
          orderId: '7001',
          reason: 'violations',
          count: 1,
        },
        {
          level: 'warn',
          event: 'detective.violation',
          orderId: '7001',
          reason: 'haul-away-outside-zone',
          lineIds: ['2'],
        },
      ]);
      expect(h.logs.some((e) => e.event === 'sync.skipped')).toBe(true);
    },
  );

  it('runs when Extend is not configured at all', async () => {
    const h = harness({
      extend: parseExtendConfig({}, {requireFlag: false, production: false}),
      detectiveAnswer: () => json({data: {order: haulOrder('90210')}}),
    });
    expect(await processOrderAction(action(), h.deps)).toEqual({
      status: 'done',
    });
    expect(h.operations()).toEqual(['DetectiveOrderById']);
    expect(
      h.detectiveLogs().some((e) => e.reason === 'haul-away-outside-zone'),
    ).toBe(true);
  });

  it('a clean order is logged as clean', async () => {
    const h = harness({extend: extendConfig('off')});
    await processOrderAction(action(), h.deps);
    expect(h.detectiveLogs()).toEqual([
      {
        level: 'info',
        event: 'detective.checked',
        orderId: '7001',
        reason: 'clean',
        count: 0,
      },
    ]);
  });

  it('logs every violation and every part it could not judge', async () => {
    const h = harness({
      extend: extendConfig('off'),
      detective: {status: 'ready', rules: RULES, zone: null},
      detectiveAnswer: () => json({data: {order: haulOrder('60645', 9, [])}}),
    });
    await processOrderAction(action(), h.deps);
    expect(h.detectiveLogs().map((e) => `${e.event}:${e.reason}`)).toEqual([
      'detective.checked:violations',
      'detective.violation:haul-away-delivery-not-recorded',
      'detective.violation:haul-away-over-max',
      'detective.unjudged:zone_unavailable',
    ]);
  });
});

describe('P5B-05 the Extend sync behaves exactly as before (REQ-EXT-003)', () => {
  it('in self mode both reads happen, the sync reads its own document, and the result is the sync result', async () => {
    const h = harness();
    expect(await processOrderAction(action(), h.deps)).toEqual({
      status: 'done',
    });
    expect(
      h
        .operations()
        .filter((o) => o !== null)
        .sort(),
    ).toEqual(['DetectiveOrderById', 'ExtendOrderById']);
    const extendRead = h.calls.find((c) => c.operation === 'ExtendOrderById');
    expect(JSON.parse(extendRead?.init.body ?? '{}')).toMatchObject({
      query: expect.stringContaining('fragment ExtendOrder on Order'),
    });
  });

  it('Extend calls and sync log events are identical with and without the detective', async () => {
    const without = harness({detective: undefined});
    const withIt = harness();
    await processOrderAction(action(), without.deps);
    await processOrderAction(action(), withIt.deps);
    const extendCalls = (h: typeof withIt) =>
      h.calls
        .filter((c) => c.operation !== 'DetectiveOrderById')
        .map((c) => [c.url, c.operation, c.init.method]);
    expect(extendCalls(withIt)).toEqual(extendCalls(without));
    const syncLogs = (h: typeof withIt) =>
      h.logs.filter((e) => !e.event.startsWith('detective.'));
    expect(syncLogs(withIt)).toEqual(syncLogs(without));
    expect(without.detectiveLogs()).toEqual([]);
    expect(without.operations()).not.toContain('DetectiveOrderById');
  });

  it('a failing sync read still fails the outcome, and the detective still ran', async () => {
    const h = harness({
      extendOrderAnswer: () => new Response('', {status: 401}),
    });
    expect(await processOrderAction(action(), h.deps)).toEqual({
      status: 'failed',
    });
    expect(h.logs.some((e) => e.event === 'webhook.order_read_failed')).toBe(
      true,
    );
    expect(h.detectiveLogs().length).toBeGreaterThan(0);
  });

  it('a failing detective read does not change a successful sync', async () => {
    const h = harness({detectiveAnswer: () => new Response('', {status: 401})});
    expect(await processOrderAction(action(), h.deps)).toEqual({
      status: 'done',
    });
    expect(h.detectiveLogs()).toEqual([
      {
        level: 'error',
        event: 'detective.read_failed',
        orderId: '7001',
        reason: 'auth',
      },
    ]);
  });

  it('when only the detective ran and its read failed, the outcome is failed so the id is not marked seen', async () => {
    const h = harness({
      extend: extendConfig('off'),
      detectiveAnswer: () => new Response('', {status: 401}),
    });
    expect(await processOrderAction(action(), h.deps)).toEqual({
      status: 'failed',
    });
  });
});

describe('P5B-05 when the check cannot run it says so', () => {
  it('without rules it logs one unjudged line per order and makes no Admin call', async () => {
    const h = harness({
      extend: extendConfig('off'),
      detective: {status: 'unavailable', reason: 'no_config'},
    });
    expect(await processOrderAction(action(), h.deps)).toEqual({
      status: 'done',
    });
    expect(h.calls).toEqual([]);
    expect(h.detectiveLogs()).toEqual([
      {
        level: 'warn',
        event: 'detective.unjudged',
        orderId: '7001',
        reason: 'rules_unavailable:no_config',
      },
    ]);
  });

  it('without an Admin token it names the missing variable, never a value, and makes no call', async () => {
    const h = harness({
      extend: extendConfig('off'),
      admin: adminConfigFromEnv({
        PUBLIC_STORE_DOMAIN: 'test-shop.myshopify.com',
      }),
    });
    await processOrderAction(action(), h.deps);
    expect(h.calls).toEqual([]);
    expect(h.detectiveLogs()).toEqual([
      {
        level: 'warn',
        event: 'detective.skipped',
        orderId: '7001',
        reason: 'admin_not_configured:SHOPIFY_ADMIN_API_ACCESS_TOKEN',
      },
    ]);
  });

  it('an order too large to read completely is recorded as not judged and is not retried', async () => {
    const h = harness({
      extend: extendConfig('off'),
      detectiveAnswer: () =>
        json({
          data: {
            order: adminDetectiveOrderNode([adminDetectiveLineNode()], {
              lineItems: {
                pageInfo: {hasNextPage: true},
                nodes: [adminDetectiveLineNode()],
              },
            }),
          },
        }),
    });
    expect(await processOrderAction(action(), h.deps)).toEqual({
      status: 'done',
    });
    expect(h.operations()).toHaveLength(1);
    expect(h.detectiveLogs().map((e) => `${e.event}:${e.reason}`)).toEqual([
      'detective.checked:unjudgeable',
      'detective.unjudged:order_unreadable',
    ]);
  });

  it('a transient failure is retried a bounded number of times', async () => {
    const h = harness({
      extend: extendConfig('off'),
      detectiveAnswer: () => new Response('', {status: 503}),
    });
    expect(await processOrderAction(action(), h.deps)).toEqual({
      status: 'failed',
    });
    expect(h.operations()).toHaveLength(2);
    expect(h.detectiveLogs()[0]).toMatchObject({
      event: 'detective.read_failed',
      reason: 'http',
    });
  });
});

describe('P5B-05 which webhooks trigger the check', () => {
  it.each([
    ['report', true],
    ['update', true],
    ['cancel', false],
    ['refund', false],
    ['fulfil', false],
  ] as const)('%s -> %s', async (intent, runs) => {
    const h = harness({extend: extendConfig('off')});
    await processOrderAction(action(intent), h.deps);
    expect(h.operations().includes('DetectiveOrderById')).toBe(runs);
  });
});

describe('P5B-05 logs hold ids and codes only (T-05)', () => {
  it('no ZIP, name, email, street or token appears in anything logged', async () => {
    const h = harness({
      extend: extendConfig('off'),
      detectiveAnswer: () =>
        json({
          data: {
            order: adminDetectiveOrderNode(
              [
                adminDetectiveLineNode({
                  title: `${SYNTHETIC_PII.name} mattress`,
                  customAttributes: [
                    {key: 'gift_note', value: SYNTHETIC_PII.email},
                  ],
                }),
                adminDetectiveHaulNode(2, 9),
              ],
              {
                shippingAddress: {countryCodeV2: 'US', zip: '90210'},
                customAttributes: [{key: 'note', value: SYNTHETIC_PII.street}],
              },
            ),
          },
        }),
    });
    await processOrderAction(action(), h.deps);
    const text = JSON.stringify(h.logs);
    expect(text).toContain('haul-away-outside-zone');
    for (const secret of [
      '90210',
      SYNTHETIC_PII.name,
      SYNTHETIC_PII.email,
      SYNTHETIC_PII.street,
      ADMIN_TOKEN,
      EXTEND_TOKEN,
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it('the read sends the token only to the shop host, with no redirects and a read-only query', async () => {
    const h = harness({extend: extendConfig('off')});
    await processOrderAction(action(), h.deps);
    const [call] = h.calls;
    expect(call?.url).toBe(
      'https://test-shop.myshopify.com/admin/api/2026-10/graphql.json',
    );
    expect(call?.init.redirect).toBe('error');
    expect(call?.init.headers['X-Shopify-Access-Token']).toBe(ADMIN_TOKEN);
    expect(call?.init.body).not.toMatch(/\bmutation\b/);
  });
});
