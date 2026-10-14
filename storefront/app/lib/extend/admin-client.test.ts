import {describe, expect, it} from 'vitest';
import {
  adminConfigFromEnv,
  readOrderForSync,
  type AdminConfigResult,
} from '~/lib/extend/admin-client';
import {adminOrderNode} from '~/lib/extend/test-fixtures';
import type {FetchInit, FetchLike} from '~/lib/extend/types';

// REQ-EXT-003 / P5A-08 / T-03 / T-13: the order read is allow-listed, read-only, bounded and typed.

const TOKEN = 'fixture-admin-token-not-real';
const READY = adminConfigFromEnv({
  PUBLIC_STORE_DOMAIN: 'test-shop.myshopify.com',
  SHOPIFY_ADMIN_API_ACCESS_TOKEN: TOKEN,
});

function ready(): Extract<AdminConfigResult, {status: 'ready'}> {
  if (READY.status !== 'ready') throw new Error('fixture config must be ready');
  return READY;
}

/** A response recipe, so every call gets a fresh Response (a cloned body would never finish cancelling). */
type Recipe = {body: string; status: number};
const jsonResponse = (body: unknown, status = 200): Recipe => ({
  body: JSON.stringify(body),
  status,
});
const textResponse = (body: string, status = 200): Recipe => ({body, status});

type Call = {url: string; init: FetchInit};

function scripted(...steps: Array<Recipe | Error>) {
  const calls: Call[] = [];
  const sleeps: number[] = [];
  const fetchFn: FetchLike = (url, init) => {
    calls.push({url, init});
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    return step instanceof Error
      ? Promise.reject(step)
      : Promise.resolve(
          new Response(step?.body ?? '', {status: step?.status ?? 500}),
        );
  };
  return {
    calls,
    sleeps,
    deps: {
      admin: READY,
      fetch: fetchFn,
      sleep: (ms: number) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    },
  };
}

const ORDER_ANSWER = {data: {order: adminOrderNode()}};

describe('adminConfigFromEnv (T-04, outbound allow-list)', () => {
  it('accepts a myshopify.com domain, with or without scheme and slash', () => {
    for (const domain of [
      'test-shop.myshopify.com',
      'https://Test-Shop.myshopify.com/',
    ]) {
      const config = adminConfigFromEnv({
        PUBLIC_STORE_DOMAIN: domain,
        SHOPIFY_ADMIN_API_ACCESS_TOKEN: TOKEN,
      });
      expect(config).toMatchObject({
        status: 'ready',
        store: 'test-shop.myshopify.com',
      });
    }
  });

  it.each([
    ['mock.shop', 'mock.shop'],
    ['a custom domain', 'www.example.com'],
    ['a foreign host', 'evil.example/test-shop.myshopify.com'],
    ['credentials in the host', 'user:pw@test-shop.myshopify.com'],
    ['http', 'http://test-shop.myshopify.com'],
    ['a lookalike', 'test-shop.myshopify.com.evil.example'],
  ])('refuses %s', (_name, domain) => {
    expect(
      adminConfigFromEnv({
        PUBLIC_STORE_DOMAIN: domain,
        SHOPIFY_ADMIN_API_ACCESS_TOKEN: TOKEN,
      }).status,
    ).toBe('not_configured');
  });

  it('names missing variables and never echoes a value', () => {
    const missing = adminConfigFromEnv({PUBLIC_STORE_DOMAIN: 'mock.shop'});
    expect(missing).toMatchObject({status: 'not_configured'});
    expect(JSON.stringify(missing)).not.toContain('mock.shop');
    expect(JSON.stringify(missing)).toContain('SHOPIFY_ADMIN_API_ACCESS_TOKEN');
  });

  it('refuses a token that could inject a header', () => {
    expect(
      adminConfigFromEnv({
        PUBLIC_STORE_DOMAIN: 'test-shop.myshopify.com',
        SHOPIFY_ADMIN_API_ACCESS_TOKEN: 'abc\r\nX-Evil: 1',
      }).status,
    ).toBe('not_configured');
  });

  it('keeps the token out of anything that gets serialised or logged', () => {
    expect(JSON.stringify(READY)).not.toContain(TOKEN);
    expect(String(Object.values(READY))).not.toContain(TOKEN);
  });
});

describe('readOrderForSync', () => {
  it('posts one read-only query to the shop host with the token header and no redirects', async () => {
    const harness = scripted(jsonResponse(ORDER_ANSWER));
    const result = await readOrderForSync(harness.deps, '7001');
    expect(result.status).toBe('ok');
    expect(harness.calls).toHaveLength(1);
    const [{url, init}] = harness.calls;
    expect(url).toBe(
      'https://test-shop.myshopify.com/admin/api/2026-10/graphql.json',
    );
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    expect(init.headers['X-Shopify-Access-Token']).toBe(TOKEN);
    const sent = JSON.parse(init.body ?? '{}');
    expect(sent).toMatchObject({variables: {id: 'gid://shopify/Order/7001'}});
    expect(sent).toMatchObject({
      query: expect.not.stringMatching(/\bmutation\b/),
    });
  });

  it('accepts a GID as the order id and rebuilds the id itself', async () => {
    const harness = scripted(jsonResponse(ORDER_ANSWER));
    await readOrderForSync(harness.deps, 'gid://shopify/Order/7001');
    expect(JSON.parse(harness.calls[0]?.init.body ?? '{}')).toMatchObject({
      variables: {id: 'gid://shopify/Order/7001'},
    });
  });

  it.each(['', 'abc', '7001; drop', 'gid://shopify/Order/../1', '-1'])(
    'refuses the order id %j without any call',
    async (id) => {
      const harness = scripted(jsonResponse(ORDER_ANSWER));
      const result = await readOrderForSync(harness.deps, id);
      expect(result).toMatchObject({
        status: 'error',
        reason: 'invalid_order_id',
      });
      expect(harness.calls).toHaveLength(0);
    },
  );

  it('is not configured without a call', async () => {
    const harness = scripted(jsonResponse(ORDER_ANSWER));
    const result = await readOrderForSync(
      {...harness.deps, admin: adminConfigFromEnv({})},
      '7001',
    );
    expect(result).toMatchObject({status: 'error', reason: 'not_configured'});
    expect(harness.calls).toHaveLength(0);
  });

  it('does not retry bad credentials', async () => {
    const harness = scripted(textResponse('no', 401));
    const result = await readOrderForSync(harness.deps, '7001');
    expect(result).toEqual({status: 'error', reason: 'auth', retriable: false});
    expect(harness.calls).toHaveLength(1);
  });

  it('retries a 429 with backoff and then succeeds', async () => {
    const harness = scripted(
      textResponse('slow down', 429),
      jsonResponse(ORDER_ANSWER),
    );
    const result = await readOrderForSync(harness.deps, '7001');
    expect(result.status).toBe('ok');
    expect(harness.calls).toHaveLength(2);
    expect(harness.sleeps).toEqual([500]);
  });

  it('gives up after a bounded number of attempts on a 5xx and says it can be retried later', async () => {
    const harness = scripted(textResponse('down', 503));
    const result = await readOrderForSync(harness.deps, '7001');
    expect(result).toEqual({status: 'error', reason: 'http', retriable: true});
    expect(harness.calls).toHaveLength(3);
    expect(harness.sleeps).toEqual([500, 1000]);
  });

  it('retries a network error', async () => {
    const harness = scripted(
      new TypeError('fetch failed'),
      jsonResponse(ORDER_ANSWER),
    );
    expect((await readOrderForSync(harness.deps, '7001')).status).toBe('ok');
    expect(harness.calls).toHaveLength(2);
  });

  it('times out a request that never answers', async () => {
    const hang: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      });
    const result = await readOrderForSync(
      {
        admin: READY,
        fetch: hang,
        sleep: () => Promise.resolve(),
        timeoutMs: 20,
        maxAttempts: 1,
      },
      '7001',
    );
    expect(result).toEqual({
      status: 'error',
      reason: 'timeout',
      retriable: true,
    });
  });

  it('treats GraphQL errors as final, THROTTLED as retriable, and a missing order as not found', async () => {
    const graphql = await readOrderForSync(
      scripted(jsonResponse({errors: [{message: 'Access denied'}]})).deps,
      '7001',
    );
    expect(graphql).toMatchObject({reason: 'graphql', retriable: false});

    const throttled = scripted(
      jsonResponse({errors: [{extensions: {code: 'THROTTLED'}}]}),
      jsonResponse(ORDER_ANSWER),
    );
    expect((await readOrderForSync(throttled.deps, '7001')).status).toBe('ok');
    expect(throttled.calls).toHaveLength(2);

    const gone = await readOrderForSync(
      scripted(jsonResponse({data: {order: null}})).deps,
      '7001',
    );
    expect(gone).toMatchObject({reason: 'not_found', retriable: false});
  });

  it('treats an unreadable, oversized or truncated answer as final', async () => {
    expect(
      await readOrderForSync(scripted(textResponse('<html>')).deps, '7001'),
    ).toMatchObject({reason: 'malformed', retriable: false});
    expect(
      await readOrderForSync(
        scripted(textResponse(`"${'x'.repeat(2_100_000)}"`)).deps,
        '7001',
      ),
    ).toMatchObject({reason: 'malformed'});
    const big = adminOrderNode();
    big.lineItems.pageInfo.hasNextPage = true;
    expect(
      await readOrderForSync(
        scripted(jsonResponse({data: {order: big}})).deps,
        '7001',
      ),
    ).toMatchObject({reason: 'truncated', retriable: false});
  });

  it('never returns or throws text that holds the token', async () => {
    const harness = scripted(jsonResponse({errors: [{message: TOKEN}]}));
    const result = await readOrderForSync(harness.deps, '7001');
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });
});
