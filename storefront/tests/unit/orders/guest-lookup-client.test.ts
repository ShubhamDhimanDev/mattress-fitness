import {describe, expect, it} from 'vitest';
import {adminConfigFromEnv} from '~/lib/extend/admin-client';
import type {FetchInit, FetchLike} from '~/lib/extend/types';
import {
  buildGuestOrderLookupRequest,
  type GuestOrderLookupRequest,
} from '~/lib/orders/guest-lookup';
import {
  createAdminGuestOrderClient,
  type GuestOrderLookupFailure,
} from '~/lib/orders/guest-lookup-client';

// REQ-ACC-003 / P6-08 / T-09: the Admin API client, tested against a fake fetch (no real calls). UNVERIFIED against
// a real store (V-20).

const TOKEN = 'fixture-admin-token-not-real';
const ready = adminConfigFromEnv({
  PUBLIC_STORE_DOMAIN: 'test-shop.myshopify.com',
  SHOPIFY_ADMIN_API_ACCESS_TOKEN: TOKEN,
});
if (ready.status !== 'ready') throw new Error('fixture config must be ready');
const admin = ready;

function lookupRequest(): GuestOrderLookupRequest {
  const built = buildGuestOrderLookupRequest('#1001');
  if (built.status !== 'ok') throw new Error('fixture request must build');
  return built.request;
}

const NODE = {
  name: '#1001',
  email: 'shopper@example.com',
  createdAt: '2026-10-10T10:00:00Z',
  cancelledAt: null,
  displayFulfillmentStatus: 'UNFULFILLED',
  lineItems: {nodes: [{title: 'Mattress', quantity: 1}]},
  fulfillments: [],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'Content-Type': 'application/json'},
  });
}

type Seen = {url: string; init: FetchInit};

function fakeFetch(respond: (seen: Seen) => Promise<Response> | Response): {
  fetch: FetchLike;
  seen: Seen[];
} {
  const seen: Seen[] = [];
  return {
    seen,
    fetch: (url, init) => {
      seen.push({url, init});
      return Promise.resolve(respond({url, init}));
    },
  };
}

describe('the guest order Admin client (REQ-ACC-003, P6-08)', () => {
  it('posts the constant query with the validated variable to the shop host only', async () => {
    const {fetch, seen} = fakeFetch(() =>
      jsonResponse({data: {orders: {nodes: [NODE]}}}),
    );
    const result = await createAdminGuestOrderClient({admin, fetch}).lookup(
      lookupRequest(),
    );
    expect(result.status).toBe('ok');
    expect(result.status === 'ok' && result.candidates).toHaveLength(1);

    expect(seen).toHaveLength(1);
    const [call] = seen;
    expect(call?.url).toBe(
      'https://test-shop.myshopify.com/admin/api/2026-10/graphql.json',
    );
    expect(call?.init.method).toBe('POST');
    expect(call?.init.redirect).toBe('error');
    expect(call?.init.headers['X-Shopify-Access-Token']).toBe(TOKEN);
    const body: unknown = JSON.parse(call?.init.body ?? '{}');
    expect(body).toMatchObject({
      operationName: 'GuestOrderLookup',
      variables: {query: 'name:1001'},
    });
    // The shopper's value is only ever in `variables`.
    expect(call?.init.body?.split('"variables"')[0]).not.toContain('1001');
  });

  it('never puts the token in a result', async () => {
    const {fetch} = fakeFetch(() => jsonResponse({}, 401));
    const result = await createAdminGuestOrderClient({admin, fetch}).lookup(
      lookupRequest(),
    );
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it.each<[string, () => Response, GuestOrderLookupFailure]>([
    ['401', () => jsonResponse({}, 401), 'auth'],
    ['403', () => jsonResponse({}, 403), 'auth'],
    ['429', () => jsonResponse({}, 429), 'throttled'],
    ['500', () => jsonResponse({}, 500), 'http'],
    ['302', () => new Response(null, {status: 302}), 'http'],
    [
      'not JSON',
      () => new Response('<html>oops</html>', {status: 200}),
      'malformed',
    ],
    [
      'GraphQL errors',
      () => jsonResponse({errors: [{message: 'x'}]}),
      'graphql',
    ],
    ['no orders field', () => jsonResponse({data: {}}), 'graphql'],
    [
      'an oversized body',
      () =>
        new Response('x', {
          status: 200,
          headers: {'Content-Length': '9999999'},
        }),
      'malformed',
    ],
  ])('maps %s to a typed failure', async (_name, respond, reason) => {
    const {fetch} = fakeFetch(respond);
    expect(
      await createAdminGuestOrderClient({admin, fetch}).lookup(lookupRequest()),
    ).toEqual({status: 'error', reason});
  });

  it('maps a network error and never rejects', async () => {
    const result = await createAdminGuestOrderClient({
      admin,
      fetch: () => Promise.reject(new Error('connect ECONNREFUSED')),
    }).lookup(lookupRequest());
    expect(result).toEqual({status: 'error', reason: 'network'});
    expect(JSON.stringify(result)).not.toContain('ECONNREFUSED');
  });

  it('times out a call that never answers', async () => {
    const result = await createAdminGuestOrderClient({
      admin,
      timeoutMs: 20,
      fetch: (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal.addEventListener('abort', () =>
            reject(new Error('aborted')),
          );
        }),
    }).lookup(lookupRequest());
    expect(result).toEqual({status: 'error', reason: 'timeout'});
  });

  it('makes exactly one attempt, even on a transient failure', async () => {
    const {fetch, seen} = fakeFetch(() => jsonResponse({}, 503));
    await createAdminGuestOrderClient({admin, fetch}).lookup(lookupRequest());
    expect(seen).toHaveLength(1);
  });

  it('does not build a client for an unconfigured or invalid store', () => {
    expect(
      adminConfigFromEnv({SHOPIFY_ADMIN_API_ACCESS_TOKEN: TOKEN}).status,
    ).toBe('not_configured');
    expect(
      adminConfigFromEnv({
        PUBLIC_STORE_DOMAIN: 'evil.example.com',
        SHOPIFY_ADMIN_API_ACCESS_TOKEN: TOKEN,
      }).status,
    ).toBe('not_configured');
    expect(
      adminConfigFromEnv({PUBLIC_STORE_DOMAIN: 'test-shop.myshopify.com'})
        .status,
    ).toBe('not_configured');
  });
});
