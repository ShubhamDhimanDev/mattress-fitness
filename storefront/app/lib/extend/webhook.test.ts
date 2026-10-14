import {createHmac} from 'node:crypto';
import {describe, expect, it} from 'vitest';
import type {ExtendLogEvent} from '~/lib/extend/log';
import {
  SHOPIFY_WEBHOOK_TOPICS,
  createMemoryReplayStore,
  receiveShopifyWebhook,
  routeShopifyTopic,
  verifyShopifyWebhook,
  type WebhookReplayStore,
} from '~/lib/extend/webhook';

const SECRET = 'shpss_fixture_secret_0001';
const WEBHOOK_ID = '11111111-2222-3333-4444-555555555555';
const NOW = Date.parse('2026-10-05T12:00:00Z');

/** Known-answer vectors are computed with node:crypto, which is independent of the Web Crypto code under test. */
function sign(body: string | Buffer, secret = SECRET): string {
  return createHmac('sha256', secret).update(body).digest('base64');
}

describe('Shopify webhook HMAC (REQ-EXT-003, T-03)', () => {
  it('matches RFC 4231 test case 2 (independent known answer)', async () => {
    const hex =
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843';
    const header = Buffer.from(hex, 'hex').toString('base64');
    expect(
      await verifyShopifyWebhook(
        'what do ya want for nothing?',
        header,
        'Jefe',
      ),
    ).toBe(true);
    expect(
      await verifyShopifyWebhook(
        'what do ya want for nothing!',
        header,
        'Jefe',
      ),
    ).toBe(false);
  });

  it.each([
    ['a JSON body', '{"id":820982911946154500,"email":"jane@example.test"}'],
    ['an empty body', ''],
    ['non-ASCII text', '{"note":"café ☃ \u{1F6CF}"}'],
    ['whitespace-significant JSON', '{ "id" : 1 ,\n "x" : [ 1, 2 ] }\n'],
  ])('verifies a correct signature over %s', async (_label, body) => {
    expect(await verifyShopifyWebhook(body, sign(body), SECRET)).toBe(true);
  });

  it('verifies the same raw bytes whether they arrive as a string, ArrayBuffer or Uint8Array', async () => {
    const body = '{"id":1,"v":"é"}';
    const header = sign(body);
    const bytes = new TextEncoder().encode(body);
    expect(await verifyShopifyWebhook(bytes, header, SECRET)).toBe(true);
    expect(await verifyShopifyWebhook(bytes.buffer, header, SECRET)).toBe(true);
  });

  it('verifies the raw bytes, not re-serialised JSON', async () => {
    const raw = '{"id":1,  "b":2}';
    const reserialised = JSON.stringify(JSON.parse(raw));
    expect(await verifyShopifyWebhook(raw, sign(raw), SECRET)).toBe(true);
    expect(await verifyShopifyWebhook(reserialised, sign(raw), SECRET)).toBe(
      false,
    );
  });

  const body = '{"id":7001,"total_price":"1379.00"}';
  const good = sign(body);

  it.each([
    ['a changed character', body.replace('7001', '7002')],
    ['an appended space', `${body} `],
    ['a prepended newline', `\n${body}`],
    ['a truncated body', body.slice(0, -1)],
    ['an injected field', body.replace('}', ',"refunded":true}')],
  ])('rejects a tampered body: %s', async (_label, tampered) => {
    expect(await verifyShopifyWebhook(tampered, good, SECRET)).toBe(false);
  });

  it('rejects a wrong secret and a secret with a changed case', async () => {
    expect(await verifyShopifyWebhook(body, good, 'another-secret')).toBe(
      false,
    );
    expect(await verifyShopifyWebhook(body, good, SECRET.toUpperCase())).toBe(
      false,
    );
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty', ''],
    ['truncated by one character', good.slice(0, -1)],
    ['truncated to half', good.slice(0, 22)],
    ['padding stripped', good.replace(/=+$/, '')],
    ['extended with extra characters', `${good}AAAA`],
    ['surrounded by spaces', ` ${good} `],
    [
      'hex instead of base64',
      createHmac('sha256', SECRET).update(body).digest('hex'),
    ],
    ['lower-cased', good.toLowerCase()],
    ['all A', 'A'.repeat(44)],
    ['a very long value', 'A'.repeat(10_000)],
  ])('rejects a bad header: %s', async (_label, header) => {
    expect(await verifyShopifyWebhook(body, header, SECRET)).toBe(false);
  });

  it('rejects the base64url spelling of a digest that contains + or / (the header is standard base64)', async () => {
    let candidate = '';
    for (let i = 0; i < 2000 && candidate === ''; i += 1) {
      const text = `{"n":${i}}`;
      if (/[+/]/.test(sign(text))) candidate = text;
    }
    expect(candidate).not.toBe('');
    const urlSafe = sign(candidate).replaceAll('+', '-').replaceAll('/', '_');
    expect(await verifyShopifyWebhook(candidate, sign(candidate), SECRET)).toBe(
      true,
    );
    expect(await verifyShopifyWebhook(candidate, urlSafe, SECRET)).toBe(false);
  });

  it('fails closed on an empty secret even when the digest matches an empty-key HMAC', async () => {
    expect(await verifyShopifyWebhook(body, sign(body, ''), '')).toBe(false);
  });

  it('never throws on odd inputs', async () => {
    await expect(
      verifyShopifyWebhook(new Uint8Array(0), 'x', SECRET),
    ).resolves.toBe(false);
    await expect(verifyShopifyWebhook(body, '\u0000', SECRET)).resolves.toBe(
      false,
    );
  });
});

describe('replay store (T-03)', () => {
  it('remembers a processed id until the TTL passes', () => {
    const clock = {t: 0};
    const store = createMemoryReplayStore({now: () => clock.t, ttlMs: 1000});
    expect(store.seen('a')).toBe(false);
    void store.markSeen('a');
    expect(store.seen('a')).toBe(true);
    clock.t = 1000;
    expect(store.seen('a')).toBe(true);
    clock.t = 1001;
    expect(store.seen('a')).toBe(false);
  });

  it('is bounded: the oldest ids are evicted first', () => {
    const store = createMemoryReplayStore({now: () => 0, maxEntries: 2});
    for (const id of ['a', 'b', 'c']) void store.markSeen(id);
    expect([store.seen('a'), store.seen('b'), store.seen('c')]).toEqual([
      false,
      true,
      true,
    ]);
  });
});

describe('topic router (REQ-EXT-003)', () => {
  it.each([
    ['orders/paid', {id: 7001}, 'report'],
    ['orders/updated', {id: '7001'}, 'update'],
    ['orders/cancelled', {id: 7001}, 'cancel'],
    ['refunds/create', {id: 55, order_id: 7001}, 'refund'],
    ['fulfillments/create', {id: 66, order_id: 7001}, 'fulfil'],
    ['ORDERS/PAID', {id: 7001}, 'report'],
    ['orders/paid', {id: 'gid://shopify/Order/7001'}, 'report'],
  ])('%s -> sync order 7001 (%s)', (topic, payload, intent) => {
    expect(routeShopifyTopic(topic, payload)).toEqual({
      status: 'ok',
      action: {
        type: 'sync_order',
        orderId: '7001',
        topic: topic.toLowerCase(),
        intent,
      },
    });
  });

  it('covers exactly the documented topics', () => {
    expect([...SHOPIFY_WEBHOOK_TOPICS]).toEqual([
      'orders/paid',
      'orders/updated',
      'orders/cancelled',
      'refunds/create',
      'fulfillments/create',
    ]);
  });

  it.each([
    ['orders/create'],
    ['products/update'],
    ['customers/redact'],
    ['app/uninstalled'],
    [''],
    ['orders/paid/extra'],
    ['__proto__'],
  ])('does not route the unsupported topic %j', (topic) => {
    expect(routeShopifyTopic(topic, {id: 1})).toEqual({
      status: 'error',
      reason: 'unsupported_topic',
    });
  });

  it.each([
    ['orders/paid', null],
    ['orders/paid', []],
    ['orders/paid', 'text'],
    ['orders/paid', {}],
    ['orders/paid', {id: -1}],
    ['orders/paid', {id: 1.5}],
    ['orders/paid', {id: '1; DROP'}],
    ['orders/paid', {id: {nested: 1}}],
    ['orders/paid', {id: 5, order_id: '1; DROP'}], // order_id wins by shape, and it is invalid
    ['refunds/create', {id: 7001}], // wrong field for this topic
    ['fulfillments/create', {order_id: null}],
  ])('rejects a malformed payload for %s: %j', (topic, payload) => {
    expect(routeShopifyTopic(topic, payload)).toEqual({
      status: 'error',
      reason: 'malformed_payload',
    });
  });
});

describe('receiveShopifyWebhook (REQ-EXT-003, T-03)', () => {
  function request(
    overrides: {
      body?: string;
      headers?: Record<string, string | undefined>;
      secret?: string;
      replay?: WebhookReplayStore;
      maxAgeMs?: number;
      log?: (event: ExtendLogEvent) => void;
    } = {},
  ) {
    const body =
      overrides.body ?? '{"id":7001,"email":"jane.testwell@example.test"}';
    const headers = new Headers();
    const defaults: Record<string, string | undefined> = {
      'x-shopify-hmac-sha256': sign(body),
      'x-shopify-topic': 'orders/paid',
      'x-shopify-webhook-id': WEBHOOK_ID,
      'x-shopify-triggered-at': new Date(NOW - 1000).toISOString(),
      ...overrides.headers,
    };
    for (const [key, value] of Object.entries(defaults)) {
      if (value !== undefined) headers.set(key, value);
    }
    return {
      rawBody: body,
      headers,
      secret: overrides.secret ?? SECRET,
      replay: overrides.replay ?? createMemoryReplayStore({now: () => NOW}),
      now: () => NOW,
      ...(overrides.maxAgeMs === undefined
        ? {}
        : {maxAgeMs: overrides.maxAgeMs}),
      ...(overrides.log === undefined ? {} : {log: overrides.log}),
    };
  }

  it('accepts a correctly signed, supported, fresh webhook', async () => {
    expect(await receiveShopifyWebhook(request())).toEqual({
      status: 'accepted',
      webhookId: WEBHOOK_ID,
      action: {
        type: 'sync_order',
        orderId: '7001',
        topic: 'orders/paid',
        intent: 'report',
      },
    });
  });

  it('rejects a tampered body with 401 before looking at anything else', async () => {
    const base = request();
    const result = await receiveShopifyWebhook({
      ...base,
      rawBody: base.rawBody.replace('7001', '7002'),
    });
    expect(result).toEqual({
      status: 'rejected',
      reason: 'bad_signature',
      httpStatus: 401,
    });
  });

  it.each([
    ['wrong secret', {secret: 'not-the-secret'}],
    [
      'missing signature header',
      {headers: {'x-shopify-hmac-sha256': undefined}},
    ],
    [
      'truncated signature header',
      {headers: {'x-shopify-hmac-sha256': sign('x').slice(0, 20)}},
    ],
    [
      'signature for another body',
      {headers: {'x-shopify-hmac-sha256': sign('{"id":1}')}},
    ],
  ])('rejects: %s', async (_label, overrides) => {
    expect(await receiveShopifyWebhook(request(overrides))).toEqual({
      status: 'rejected',
      reason: 'bad_signature',
      httpStatus: 401,
    });
  });

  it('answers a bad signature with 401 even when the body is also malformed (no information leak)', async () => {
    const result = await receiveShopifyWebhook(
      request({body: 'not json', headers: {'x-shopify-hmac-sha256': 'AAAA'}}),
    );
    expect(result).toMatchObject({status: 'rejected', reason: 'bad_signature'});
  });

  it('rejects an oversized body with 413 without computing a signature', async () => {
    const result = await receiveShopifyWebhook({
      ...request(),
      rawBody: 'x'.repeat(5 * 1024 * 1024 + 1),
    });
    expect(result).toEqual({
      status: 'rejected',
      reason: 'payload_too_large',
      httpStatus: 413,
    });
  });

  it('ignores (acknowledges with 200) a validly signed webhook for an unsupported topic', async () => {
    const result = await receiveShopifyWebhook(
      request({headers: {'x-shopify-topic': 'customers/redact'}}),
    );
    expect(result).toEqual({
      status: 'ignored',
      reason: 'unsupported_topic',
      httpStatus: 200,
    });
  });

  it.each([
    ['missing', undefined],
    ['too short', 'abc'],
    ['with illegal characters', 'id with spaces and <tags>'],
    ['too long', 'a'.repeat(101)],
  ])('rejects a webhook id that is %s', async (_label, id) => {
    const result = await receiveShopifyWebhook(
      request({headers: {'x-shopify-webhook-id': id}}),
    );
    expect(result).toEqual({
      status: 'rejected',
      reason: 'missing_webhook_id',
      httpStatus: 400,
    });
  });

  it('ignores a replay of a webhook id that was already processed', async () => {
    const replay = createMemoryReplayStore({now: () => NOW});
    const first = await receiveShopifyWebhook(request({replay}));
    expect(first.status).toBe('accepted');
    await replay.markSeen(WEBHOOK_ID); // the route does this after the sync succeeded
    expect(await receiveShopifyWebhook(request({replay}))).toEqual({
      status: 'ignored',
      reason: 'replayed',
      httpStatus: 200,
    });
  });

  it("accepts Shopify's retry of a delivery whose processing failed (id not marked seen)", async () => {
    const replay = createMemoryReplayStore({now: () => NOW});
    expect((await receiveShopifyWebhook(request({replay}))).status).toBe(
      'accepted',
    );
    // processing failed, markSeen never called; Shopify retries with the same id
    expect((await receiveShopifyWebhook(request({replay}))).status).toBe(
      'accepted',
    );
  });

  it('a replayed id with a forged body is still rejected on signature first', async () => {
    const replay = createMemoryReplayStore({now: () => NOW});
    await replay.markSeen(WEBHOOK_ID);
    const base = request({replay});
    const result = await receiveShopifyWebhook({
      ...base,
      rawBody: '{"id":9999}',
    });
    expect(result).toMatchObject({status: 'rejected', reason: 'bad_signature'});
  });

  describe('optional timestamp window on X-Shopify-Triggered-At', () => {
    const day = 24 * 60 * 60 * 1000;

    it('accepts inside the window and ignores older events', async () => {
      const fresh = request({
        maxAgeMs: 3 * day,
        headers: {'x-shopify-triggered-at': new Date(NOW - day).toISOString()},
      });
      expect((await receiveShopifyWebhook(fresh)).status).toBe('accepted');
      const stale = request({
        maxAgeMs: 3 * day,
        headers: {
          'x-shopify-triggered-at': new Date(NOW - 4 * day).toISOString(),
        },
      });
      expect(await receiveShopifyWebhook(stale)).toEqual({
        status: 'ignored',
        reason: 'stale',
        httpStatus: 200,
      });
    });

    it.each([
      ['garbage', 'yesterday-ish'],
      ['far in the future', new Date(NOW + 60 * 60 * 1000).toISOString()],
    ])(
      'rejects a %s timestamp when a window is configured',
      async (_label, value) => {
        const result = await receiveShopifyWebhook(
          request({maxAgeMs: day, headers: {'x-shopify-triggered-at': value}}),
        );
        expect(result).toEqual({
          status: 'rejected',
          reason: 'invalid_timestamp',
          httpStatus: 400,
        });
      },
    );

    it('treats a missing timestamp as absent: the signature is still verified and the event is processed', async () => {
      const result = await receiveShopifyWebhook(
        request({
          maxAgeMs: day,
          headers: {'x-shopify-triggered-at': undefined},
        }),
      );
      expect(result.status).toBe('accepted');
    });

    it('tolerates small clock skew', async () => {
      const result = await receiveShopifyWebhook(
        request({
          maxAgeMs: day,
          headers: {
            'x-shopify-triggered-at': new Date(NOW + 60_000).toISOString(),
          },
        }),
      );
      expect(result.status).toBe('accepted');
    });

    it.each([
      ['milliseconds', '2026-10-05T11:59:59.000Z'],
      [
        'microseconds (2026-01 reference example)',
        '2026-10-05T11:59:59.000000Z',
      ],
      ['nanoseconds (order webhooks page)', '2026-10-05T11:59:59.000000000Z'],
    ])(
      'parses a triggered-at timestamp with %s precision',
      async (_label, stamp) => {
        const result = await receiveShopifyWebhook(
          request({maxAgeMs: day, headers: {'x-shopify-triggered-at': stamp}}),
        );
        expect(result.status).toBe('accepted');
      },
    );

    it('does not look at the timestamp when no window is configured', async () => {
      const result = await receiveShopifyWebhook(
        request({headers: {'x-shopify-triggered-at': 'garbage'}}),
      );
      expect(result.status).toBe('accepted');
    });
  });

  it.each([
    ['not JSON', 'not json'],
    ['invalid UTF-8', ''],
    ['a JSON array', '[1,2]'],
    ['JSON without the order id', '{"x":1}'],
    ['an id that is not a number', '{"id":"abc"}'],
  ])('rejects a signed but malformed payload: %s', async (label, text) => {
    const bytes =
      label === 'invalid UTF-8'
        ? Buffer.from([0x7b, 0xff, 0xfe, 0x7d])
        : Buffer.from(text);
    const headers = new Headers({
      'x-shopify-hmac-sha256': sign(bytes),
      'x-shopify-topic': 'orders/paid',
      'x-shopify-webhook-id': WEBHOOK_ID,
    });
    const result = await receiveShopifyWebhook({
      rawBody: bytes,
      headers,
      secret: SECRET,
      replay: createMemoryReplayStore({now: () => NOW}),
      now: () => NOW,
    });
    expect(result).toEqual({
      status: 'rejected',
      reason: 'malformed_payload',
      httpStatus: 400,
    });
  });

  it('reads headers case-insensitively (HTTP/2 lowercases them)', async () => {
    const body = '{"id":7001}';
    const headers = new Headers({
      'X-Shopify-Hmac-Sha256': sign(body),
      'X-SHOPIFY-TOPIC': 'Orders/Paid',
      'x-shopify-webhook-id': WEBHOOK_ID,
    });
    const result = await receiveShopifyWebhook({
      rawBody: body,
      headers,
      secret: SECRET,
      replay: createMemoryReplayStore({now: () => NOW}),
      now: () => NOW,
    });
    expect(result).toMatchObject({
      status: 'accepted',
      action: {topic: 'orders/paid'},
    });
  });

  it('routes each documented topic through the full receiver', async () => {
    const cases: Array<[string, string]> = [
      ['orders/paid', '{"id":7001}'],
      ['orders/updated', '{"id":7001}'],
      ['orders/cancelled', '{"id":7001}'],
      ['refunds/create', '{"id":5,"order_id":7001}'],
      ['fulfillments/create', '{"id":6,"order_id":7001}'],
    ];
    for (const [topic, body] of cases) {
      const result = await receiveShopifyWebhook(
        request({body, headers: {'x-shopify-topic': topic}}),
      );
      expect(result).toMatchObject({
        status: 'accepted',
        action: {orderId: '7001', topic},
      });
    }
  });

  it('logs reasons only: never the body, signature, secret or personal data (T-05)', async () => {
    const logged: ExtendLogEvent[] = [];
    const base = request({log: (event) => logged.push(event)});
    await receiveShopifyWebhook({
      ...base,
      rawBody: base.rawBody.replace('7001', '7002'),
    });
    await receiveShopifyWebhook(
      request({
        headers: {'x-shopify-topic': 'products/update'},
        log: (event) => logged.push(event),
      }),
    );
    expect(logged).toEqual([
      {level: 'warn', event: 'webhook.rejected', reason: 'bad_signature'},
      {level: 'info', event: 'webhook.ignored', reason: 'unsupported_topic'},
    ]);
    const text = JSON.stringify(logged);
    expect(text).not.toContain('jane.testwell');
    expect(text).not.toContain(SECRET);
  });
});
