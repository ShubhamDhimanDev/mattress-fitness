import {describe, expect, it} from 'vitest';
import {
  adminDetectiveLineNode,
  adminDetectiveOrderNode,
} from '~/lib/detective/test-fixtures';
import {
  adminConfigFromEnv,
  readOrderForDetective,
  readOrderForSync,
} from '~/lib/extend/admin-client';
import {adminOrderNode} from '~/lib/extend/test-fixtures';
import type {FetchInit, FetchLike} from '~/lib/extend/types';

// P5B-05 / T-13: the detective order read is allow-listed, read-only, bounded and typed, like the Extend read.

const TOKEN = 'fixture-admin-token-not-real';
const READY = adminConfigFromEnv({
  PUBLIC_STORE_DOMAIN: 'test-shop.myshopify.com',
  SHOPIFY_ADMIN_API_ACCESS_TOKEN: TOKEN,
});

type Call = {url: string; init: FetchInit};

function scripted(...steps: Array<{body: string; status: number} | Error>) {
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

const answer = (body: unknown, status = 200) => ({
  body: JSON.stringify(body),
  status,
});
const ORDER = {data: {order: adminDetectiveOrderNode()}};

describe('P5B-05 readOrderForDetective', () => {
  it('posts the detective document to the shop host, read-only, with the token header and no redirects', async () => {
    const h = scripted(answer(ORDER));
    const result = await readOrderForDetective(h.deps, '7001');
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.order.order.customer.shippingAddress?.postalCode).toBe(
      '60645',
    );
    expect(result.order.facts.attributes).toEqual({delivery_choice: 'in-home'});
    const [{url, init}] = h.calls;
    expect(url).toBe(
      'https://test-shop.myshopify.com/admin/api/2026-10/graphql.json',
    );
    expect(init.redirect).toBe('error');
    expect(init.headers['X-Shopify-Access-Token']).toBe(TOKEN);
    const sent = JSON.parse(init.body ?? '{}');
    expect(sent).toMatchObject({
      operationName: 'DetectiveOrderById',
      variables: {id: 'gid://shopify/Order/7001'},
      query: expect.stringContaining('fragment DetectiveOrderFields'),
    });
    expect(sent).toMatchObject({
      query: expect.not.stringMatching(/\bmutation\b/),
    });
  });

  it('keeps the Extend read as it was: same operation, same document, Extend result shape', async () => {
    const h = scripted(answer({data: {order: adminOrderNode()}}));
    const result = await readOrderForSync(h.deps, '7001');
    expect(result.status).toBe('ok');
    if (result.status === 'ok')
      expect(result.order.id).toBe('gid://shopify/Order/7001');
    const sent = JSON.parse(h.calls[0]?.init.body ?? '{}');
    expect(sent).toMatchObject({
      operationName: 'ExtendOrderById',
      query: expect.stringContaining('fragment ExtendOrder on Order'),
    });
  });

  it('refuses an id that is not a Shopify id and a missing configuration without any call', async () => {
    const h = scripted(answer(ORDER));
    expect(await readOrderForDetective(h.deps, 'not an id')).toMatchObject({
      status: 'error',
      reason: 'invalid_order_id',
    });
    expect(
      await readOrderForDetective(
        {
          ...h.deps,
          admin: adminConfigFromEnv({PUBLIC_STORE_DOMAIN: 'mock.shop'}),
        },
        '7001',
      ),
    ).toMatchObject({status: 'error', reason: 'not_configured'});
    expect(h.calls).toHaveLength(0);
  });

  it.each([
    ['an unknown order', answer({data: {order: null}}), 'not_found'],
    ['a refused token', {body: '', status: 401}, 'auth'],
    ['a GraphQL error', answer({errors: [{message: 'bad'}]}), 'graphql'],
    [
      'a throttled answer',
      answer({errors: [{extensions: {code: 'THROTTLED'}}]}),
      'throttled',
    ],
    ['not JSON', {body: 'x', status: 200}, 'malformed'],
    [
      'an order missing its shipping field type',
      answer({
        data: {order: adminDetectiveOrderNode([], {shippingAddress: 7})},
      }),
      'malformed',
    ],
    [
      'an order with more lines than one page',
      answer({
        data: {
          order: adminDetectiveOrderNode([adminDetectiveLineNode()], {
            lineItems: {
              pageInfo: {hasNextPage: true},
              nodes: [adminDetectiveLineNode()],
            },
          }),
        },
      }),
      'truncated',
    ],
  ])('%s -> %s', async (_name, step, reason) => {
    const h = scripted(step);
    const result = await readOrderForDetective(
      {...h.deps, maxAttempts: 1},
      '7001',
    );
    expect(result).toMatchObject({status: 'error', reason});
  });

  it('retries only transient failures, within the attempts it was given', async () => {
    const h = scripted({body: '', status: 503}, answer(ORDER));
    expect(
      (await readOrderForDetective({...h.deps, maxAttempts: 2}, '7001')).status,
    ).toBe('ok');
    expect(h.calls).toHaveLength(2);
    expect(h.sleeps).toEqual([500]);

    const down = scripted(new TypeError('fetch failed'));
    expect(
      await readOrderForDetective({...down.deps, maxAttempts: 2}, '7001'),
    ).toMatchObject({
      status: 'error',
      reason: 'network',
      retriable: true,
    });
    expect(down.calls).toHaveLength(2);

    const auth = scripted({body: '', status: 403});
    await readOrderForDetective({...auth.deps, maxAttempts: 5}, '7001');
    expect(auth.calls).toHaveLength(1);
  });
});
