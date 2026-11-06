import {afterEach, describe, expect, it, vi} from 'vitest';
import {adminConfigFromEnv} from '~/lib/extend/admin-client';
import {
  createAdminTokenProvider,
  readClientCredentials,
  resetAdminTokenProvidersForTests,
  sharedAdminTokenProvider,
} from '~/lib/shopify/admin-token';
import {
  createShopifyCustomerSubscriber,
  shopifyCustomerSignupAvailable,
} from '~/lib/signup/shopify-customer';

// The server fetches its own Admin token from the app's client id and secret (client credentials grant) and renews it, so
// the newsletter's customer sync needs no hand-copied token. No network: fetch is injected. Every credential is fictional.

afterEach(() => resetAdminTokenProvidersForTests());

const STORE = 'demo-store.myshopify.com';
const CREDENTIALS = {
  clientId: 'fictional-id',
  clientSecret: 'fictional-secret',
};

/** The GraphQL document a recorded Admin call sent. */
function queryOf(body: string | undefined): string {
  const parsed: unknown = JSON.parse(body ?? '{}');
  const query: unknown =
    typeof parsed === 'object' && parsed !== null
      ? Reflect.get(parsed, 'query')
      : undefined;
  return typeof query === 'string' ? query : '';
}

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {status});
}

describe('createAdminTokenProvider', () => {
  it('asks Shopify for a token with the id and secret, over https to the shop, without following redirects', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        reply({access_token: 'tok_aaaaaaaa', expires_in: 86399}),
      );
    const provider = createAdminTokenProvider({
      store: STORE,
      credentials: CREDENTIALS,
      fetch: fetchFn,
    });
    expect(await provider.get()).toEqual({status: 'ok', token: 'tok_aaaaaaaa'});
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(`https://${STORE}/admin/oauth/access_token`);
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('manual');
    const sent = new URLSearchParams(init.body);
    expect(sent.get('grant_type')).toBe('client_credentials');
    expect(sent.get('client_id')).toBe('fictional-id');
    expect(sent.get('client_secret')).toBe('fictional-secret');
  });

  it('reuses the token until shortly before it expires, then fetches a new one', async () => {
    let now = 1_000_000;
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        reply({access_token: 'tok_first_1', expires_in: 3600}),
      )
      .mockResolvedValueOnce(
        reply({access_token: 'tok_second_2', expires_in: 3600}),
      );
    const provider = createAdminTokenProvider({
      store: STORE,
      credentials: CREDENTIALS,
      fetch: fetchFn,
      now: () => now,
    });
    expect(await provider.get()).toEqual({status: 'ok', token: 'tok_first_1'});
    now += 50 * 60 * 1000; // 50 minutes: still more than 5 minutes left
    expect(await provider.get()).toEqual({status: 'ok', token: 'tok_first_1'});
    expect(fetchFn).toHaveBeenCalledTimes(1);
    now += 6 * 60 * 1000; // 56 minutes: inside the 5-minute renewal margin
    expect(await provider.get()).toEqual({status: 'ok', token: 'tok_second_2'});
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('shares one request between callers that arrive together', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        reply({access_token: 'tok_shared_1', expires_in: 86399}),
      );
    const provider = createAdminTokenProvider({
      store: STORE,
      credentials: CREDENTIALS,
      fetch: fetchFn,
    });
    const results = await Promise.all([
      provider.get(),
      provider.get(),
      provider.get(),
    ]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    for (const result of results) expect(result.status).toBe('ok');
  });

  it('fetches again after invalidate', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        reply({access_token: 'tok_first_1', expires_in: 86399}),
      )
      .mockResolvedValueOnce(
        reply({access_token: 'tok_second_2', expires_in: 86399}),
      );
    const provider = createAdminTokenProvider({
      store: STORE,
      credentials: CREDENTIALS,
      fetch: fetchFn,
    });
    await provider.get();
    provider.invalidate();
    expect(await provider.get()).toEqual({status: 'ok', token: 'tok_second_2'});
  });

  it.each([
    [reply({error: 'application_cannot_be_found'}, 400), 'auth'],
    [reply({}, 401), 'auth'],
    [reply({}, 429), 'rate_limited'],
    [reply({}, 503), 'server'],
    [reply({nothing: 'useful'}), 'unexpected'],
    [reply({access_token: 'has a space'}), 'unexpected'],
    [new Response('not json', {status: 200}), 'network'],
  ])(
    'reports a failure by reason, never the secret (%#)',
    async (response, reason) => {
      const provider = createAdminTokenProvider({
        store: STORE,
        credentials: CREDENTIALS,
        fetch: vi.fn().mockResolvedValue(response),
      });
      const result = await provider.get();
      expect(result.status).toBe('failed');
      if (result.status === 'failed') expect(result.reason).toBe(reason);
      expect(JSON.stringify(result)).not.toContain('fictional-secret');
    },
  );

  it('does not cache a failure: the next call tries again', async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(
        reply({access_token: 'tok_after_1', expires_in: 86399}),
      );
    const provider = createAdminTokenProvider({
      store: STORE,
      credentials: CREDENTIALS,
      fetch: fetchFn,
    });
    expect(await provider.get()).toEqual({status: 'failed', reason: 'network'});
    expect(await provider.get()).toEqual({status: 'ok', token: 'tok_after_1'});
  });
});

describe('readClientCredentials', () => {
  it('needs both values, well formed', () => {
    expect(readClientCredentials({})).toBeNull();
    expect(readClientCredentials({ADMIN_CLIENT_ID: 'a'})).toBeNull();
    expect(readClientCredentials({ADMIN_CLIENT_SECRET: 'b'})).toBeNull();
    expect(
      readClientCredentials({ADMIN_CLIENT_ID: 'a b', ADMIN_CLIENT_SECRET: 'b'}),
    ).toBeNull();
    expect(
      readClientCredentials({ADMIN_CLIENT_ID: 'a', ADMIN_CLIENT_SECRET: 'b'}),
    ).toEqual({clientId: 'a', clientSecret: 'b'});
  });
});

describe('newsletter customer sync with the app credentials (no fixed token)', () => {
  const ENV = {
    PUBLIC_STORE_DOMAIN: STORE,
    ADMIN_CLIENT_ID: CREDENTIALS.clientId,
    ADMIN_CLIENT_SECRET: CREDENTIALS.clientSecret,
  };
  const REQUEST = {
    email: 'shopper@example.com',
    phone: null,
    source: 'Storefront footer signup form (email-v1)',
  };

  it('is on with the id, secret and a myshopify.com domain, and off without them', () => {
    expect(shopifyCustomerSignupAvailable(ENV)).toBe(true);
    expect(shopifyCustomerSignupAvailable({})).toBe(false);
    expect(
      shopifyCustomerSignupAvailable({
        ...ENV,
        PUBLIC_STORE_DOMAIN: 'mock.shop',
      }),
    ).toBe(false);
    expect(
      shopifyCustomerSignupAvailable({
        PUBLIC_STORE_DOMAIN: STORE,
        ADMIN_CLIENT_ID: 'a',
      }),
    ).toBe(false);
    expect(createShopifyCustomerSubscriber({env: {}})).toBeNull();
  });

  it('fetches the token, creates the tagged customer with it, and fetches the token only once for two signups', async () => {
    const calls: {url: string; token: string | null}[] = [];
    const fetchFn = vi.fn(
      async (
        url: string,
        init: {headers: Record<string, string>; body?: string},
      ) => {
        calls.push({
          url,
          token: init.headers['X-Shopify-Access-Token'] ?? null,
        });
        if (url.endsWith('/oauth/access_token')) {
          return reply({access_token: 'tok_customers_1', expires_in: 86399});
        }
        const query = queryOf(init.body);
        if (query.includes('customerByIdentifier')) {
          return reply({data: {customerByIdentifier: null}});
        }
        return reply({
          data: {
            customerCreate: {
              customer: {id: 'gid://shopify/Customer/1'},
              userErrors: [],
            },
          },
        });
      },
    );
    const client = createShopifyCustomerSubscriber({env: ENV, fetch: fetchFn});
    expect(await client?.subscribe(REQUEST)).toEqual({status: 'accepted'});
    expect(await client?.subscribe(REQUEST)).toEqual({status: 'accepted'});
    const tokenCalls = calls.filter((call) =>
      call.url.endsWith('/oauth/access_token'),
    );
    expect(tokenCalls).toHaveLength(1);
    const adminCalls = calls.filter((call) =>
      call.url.includes('/graphql.json'),
    );
    expect(adminCalls).toHaveLength(4);
    for (const call of adminCalls) expect(call.token).toBe('tok_customers_1');
  });

  it('forgets a token Shopify refuses and retries once with a new one', async () => {
    let issued = 0;
    const fetchFn = vi.fn(
      async (
        url: string,
        init: {headers: Record<string, string>; body?: string},
      ) => {
        if (url.endsWith('/oauth/access_token')) {
          issued += 1;
          return reply({
            access_token: `tok_issue_${issued}_x`,
            expires_in: 86399,
          });
        }
        if (init.headers['X-Shopify-Access-Token'] === 'tok_issue_1_x') {
          return reply({}, 401);
        }
        const query = queryOf(init.body);
        return query.includes('customerByIdentifier')
          ? reply({data: {customerByIdentifier: null}})
          : reply({
              data: {
                customerCreate: {
                  customer: {id: 'gid://shopify/Customer/1'},
                  userErrors: [],
                },
              },
            });
      },
    );
    const client = createShopifyCustomerSubscriber({env: ENV, fetch: fetchFn});
    expect(await client?.subscribe(REQUEST)).toEqual({status: 'accepted'});
    expect(issued).toBe(2);
  });

  it('fails as auth when the app credentials are refused, without calling the Admin API', async () => {
    const fetchFn = vi.fn(async () =>
      reply({error: 'application_cannot_be_found'}, 400),
    );
    const client = createShopifyCustomerSubscriber({env: ENV, fetch: fetchFn});
    expect(await client?.subscribe(REQUEST)).toEqual({
      status: 'failed',
      reason: 'auth',
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('shares the provider between requests of the same store and app', () => {
    const a = sharedAdminTokenProvider(STORE, CREDENTIALS);
    const b = sharedAdminTokenProvider(STORE, CREDENTIALS);
    expect(a).toBe(b);
  });
});

describe('adminConfigFromEnv: the credential is taken on request', () => {
  const BASE = {PUBLIC_STORE_DOMAIN: STORE};

  it('uses a fixed token as is, without any token request, and does not offer to renew it', async () => {
    const fetchFn = vi.fn();
    const admin = adminConfigFromEnv(
      {...BASE, SHOPIFY_ADMIN_API_ACCESS_TOKEN: 'fixed_token_value'},
      undefined,
      fetchFn,
    );
    expect(admin.status).toBe('ready');
    if (admin.status !== 'ready') return;
    expect(await admin.headers()).toEqual({
      status: 'ok',
      headers: expect.objectContaining({
        'X-Shopify-Access-Token': 'fixed_token_value',
      }),
    });
    expect(admin.invalidate()).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('fetches a token from the client id and secret when no fixed token is set, and can renew it', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        reply({access_token: 'tok_one_1234', expires_in: 86399}),
      )
      .mockResolvedValueOnce(
        reply({access_token: 'tok_two_5678', expires_in: 86399}),
      );
    const admin = adminConfigFromEnv(
      {
        ...BASE,
        ADMIN_CLIENT_ID: 'fictional-id',
        ADMIN_CLIENT_SECRET: 'fictional-secret',
      },
      undefined,
      fetchFn,
    );
    if (admin.status !== 'ready') throw new Error('expected ready');
    const first = await admin.headers();
    expect(
      first.status === 'ok' && first.headers['X-Shopify-Access-Token'],
    ).toBe('tok_one_1234');
    expect(admin.invalidate()).toBe(true);
    const second = await admin.headers();
    expect(
      second.status === 'ok' && second.headers['X-Shopify-Access-Token'],
    ).toBe('tok_two_5678');
  });

  it('prefers a fixed token over the client credentials, and reports what is missing', () => {
    const both = adminConfigFromEnv({
      ...BASE,
      SHOPIFY_ADMIN_API_ACCESS_TOKEN: 'fixed_token_value',
      ADMIN_CLIENT_ID: 'a',
      ADMIN_CLIENT_SECRET: 'b',
    });
    expect(both.status).toBe('ready');
    expect(adminConfigFromEnv(BASE)).toEqual({
      status: 'not_configured',
      missing: ['SHOPIFY_ADMIN_API_ACCESS_TOKEN'],
    });
    expect(
      adminConfigFromEnv({
        PUBLIC_STORE_DOMAIN: 'mock.shop',
        ADMIN_CLIENT_ID: 'a',
        ADMIN_CLIENT_SECRET: 'b',
      }),
    ).toEqual({
      status: 'not_configured',
      missing: ['PUBLIC_STORE_DOMAIN (a <shop>.myshopify.com domain)'],
    });
  });
});
