import {afterEach, describe, expect, it, vi} from 'vitest';
import {adminConfigFromEnv} from '~/lib/extend/admin-client';
import type {FetchInit, FetchLike} from '~/lib/extend/types';
import {publicSignupConfig} from '~/lib/signup/config';
import {combineSubscribers} from '~/lib/signup/combined-subscriber';
import {
  resetSignupStateForTests,
  signupDepsFromEnv,
} from '~/lib/signup/handler';
import type {KlaviyoClient} from '~/lib/signup/klaviyo-client';
import {
  CUSTOMERS_TOKEN_ENV,
  SUBSCRIBE_TAG,
  createShopifyCustomerSubscriber,
  shopifyCustomerSignupAvailable,
} from '~/lib/signup/shopify-customer';

// REQ-ANL-003 / CR-34: every signup also becomes a Shopify customer tagged `subscribe`. No network: fetch is injected. The
// token and the address are fictional.

afterEach(() => resetSignupStateForTests());

const ENV = {
  PUBLIC_STORE_DOMAIN: 'demo-shop.myshopify.com',
  [CUSTOMERS_TOKEN_ENV]: 'shpat_fictional_token_123',
};
const NOW = new Date('2026-11-06T10:00:00Z');
const REQUEST = {
  email: 'shopper@example.com',
  phone: null,
  source: 'Storefront footer signup form (email-v1)',
};

type Sent = {
  query: string;
  variables: Record<string, unknown>;
  init: FetchInit;
};

/** Answers the nth call with the nth body; records what was sent. */
function scripted(...bodies: readonly unknown[]) {
  const sent: Sent[] = [];
  const fetchFn: FetchLike = (_url, init) => {
    const body: unknown = JSON.parse(init.body ?? '{}');
    sent.push({
      query: Reflect.get(body as object, 'query') as string,
      variables: Reflect.get(body as object, 'variables') as Record<
        string,
        unknown
      >,
      init,
    });
    const answer = bodies[sent.length - 1] ?? {data: {}};
    return Promise.resolve(
      new Response(JSON.stringify(answer), {
        status: 200,
        headers: {'content-type': 'application/json'},
      }),
    );
  };
  return {sent, fetchFn};
}

const NONE = {data: {customerByIdentifier: null}};
const FOUND = {data: {customerByIdentifier: {id: 'gid://shopify/Customer/1'}}};
const OK_CREATE = {
  data: {
    customerCreate: {
      customer: {id: 'gid://shopify/Customer/2'},
      userErrors: [],
    },
  },
};
const OK_TAGS = {data: {tagsAdd: {node: {id: 'x'}, userErrors: []}}};
const OK_CONSENT = {
  data: {
    customerEmailMarketingConsentUpdate: {
      customer: {id: 'x'},
      userErrors: [],
    },
  },
};

describe('configuration', () => {
  it('is off without the store domain or the customers token, and never reuses the order token', () => {
    expect(shopifyCustomerSignupAvailable({})).toBe(false);
    expect(
      shopifyCustomerSignupAvailable({
        PUBLIC_STORE_DOMAIN: ENV.PUBLIC_STORE_DOMAIN,
      }),
    ).toBe(false);
    expect(
      shopifyCustomerSignupAvailable({
        PUBLIC_STORE_DOMAIN: ENV.PUBLIC_STORE_DOMAIN,
        SHOPIFY_ADMIN_API_ACCESS_TOKEN: 'read_orders_token_123',
      }),
    ).toBe(false);
    expect(shopifyCustomerSignupAvailable(ENV)).toBe(true);
    expect(createShopifyCustomerSubscriber({env: {}})).toBeNull();
  });

  it('refuses a store domain that is not a myshopify.com host', () => {
    expect(
      shopifyCustomerSignupAvailable({
        ...ENV,
        PUBLIC_STORE_DOMAIN: 'evil.example.com',
      }),
    ).toBe(false);
  });

  it('keeps the order token behaviour of adminConfigFromEnv unchanged', () => {
    const result = adminConfigFromEnv({
      PUBLIC_STORE_DOMAIN: ENV.PUBLIC_STORE_DOMAIN,
    });
    expect(result).toEqual({
      status: 'not_configured',
      missing: ['SHOPIFY_ADMIN_API_ACCESS_TOKEN'],
    });
  });

  it('turns the signup on by itself and gives the handler a client', () => {
    expect(
      publicSignupConfig(ENV, '/policies/privacy-policy', {
        allowUnapprovedSms: true,
      }),
    ).toEqual({sms: false, privacyHref: '/policies/privacy-policy'});
    expect(
      signupDepsFromEnv(ENV, {allowUnapprovedSms: true}).client,
    ).not.toBeNull();
  });
});

describe('creating and tagging the customer', () => {
  it('creates a new customer with the subscribe tag and subscribed email consent in one call', async () => {
    const {sent, fetchFn} = scripted(NONE, OK_CREATE);
    const client = createShopifyCustomerSubscriber({
      env: ENV,
      fetch: fetchFn,
      now: () => NOW,
    });
    expect(await client?.subscribe(REQUEST)).toEqual({status: 'accepted'});
    expect(sent).toHaveLength(2);
    expect(sent[0]?.variables).toEqual({email: 'shopper@example.com'});
    expect(sent[1]?.variables).toEqual({
      input: {
        email: 'shopper@example.com',
        tags: ['subscribe'],
        emailMarketingConsent: {
          marketingState: 'SUBSCRIBED',
          marketingOptInLevel: 'SINGLE_OPT_IN',
          consentUpdatedAt: '2026-11-06T10:00:00.000Z',
        },
      },
    });
    expect(SUBSCRIBE_TAG).toBe('subscribe');
  });

  it('tags an existing customer and marks the email subscribed, without creating a duplicate', async () => {
    const {sent, fetchFn} = scripted(FOUND, OK_TAGS, OK_CONSENT);
    const client = createShopifyCustomerSubscriber({
      env: ENV,
      fetch: fetchFn,
      now: () => NOW,
    });
    expect(await client?.subscribe(REQUEST)).toEqual({status: 'accepted'});
    expect(
      sent.map((call) => call.query.match(/(?:query|mutation) (\w+)/)?.[1]),
    ).toEqual(['SignupCustomerByEmail', 'SignupTagsAdd', 'SignupEmailConsent']);
    expect(sent[1]?.variables).toEqual({
      id: 'gid://shopify/Customer/1',
      tags: ['subscribe'],
    });
  });

  it('after a create refusal (a race) finds the customer and tags it', async () => {
    const {fetchFn} = scripted(
      NONE,
      {
        data: {
          customerCreate: {
            customer: null,
            userErrors: [{field: ['email'], message: 'taken'}],
          },
        },
      },
      FOUND,
      OK_TAGS,
      OK_CONSENT,
    );
    const client = createShopifyCustomerSubscriber({env: ENV, fetch: fetchFn});
    expect(await client?.subscribe(REQUEST)).toEqual({status: 'accepted'});
  });

  it('reports a refused create with no customer to find as rejected', async () => {
    const {fetchFn} = scripted(
      NONE,
      {
        data: {
          customerCreate: {customer: null, userErrors: [{message: 'bad'}]},
        },
      },
      NONE,
    );
    const client = createShopifyCustomerSubscriber({env: ENV, fetch: fetchFn});
    expect(await client?.subscribe(REQUEST)).toEqual({
      status: 'failed',
      reason: 'rejected',
    });
  });

  it('sends the token only to the shop host, with redirects refused', async () => {
    const urls: string[] = [];
    const seen: FetchInit[] = [];
    const client = createShopifyCustomerSubscriber({
      env: ENV,
      fetch: (url, init) => {
        urls.push(url);
        seen.push(init);
        return Promise.resolve(Response.json(NONE));
      },
    });
    await client?.subscribe(REQUEST);
    expect(urls[0]).toMatch(
      /^https:\/\/demo-shop\.myshopify\.com\/admin\/api\/[\d-]+\/graphql\.json$/,
    );
    expect(seen[0]?.redirect).toBe('error');
    expect(seen[0]?.headers['X-Shopify-Access-Token']).toBe(
      'shpat_fictional_token_123',
    );
  });
});

describe('failures never throw and never leak', () => {
  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [429, 'rate_limited'],
    [500, 'server'],
  ] as const)('maps HTTP %s to %s', async (status, reason) => {
    const client = createShopifyCustomerSubscriber({
      env: ENV,
      fetch: () => Promise.resolve(new Response('', {status})),
    });
    expect(await client?.subscribe(REQUEST)).toEqual({
      status: 'failed',
      reason,
    });
  });

  it('treats GraphQL errors (a missing scope) as our configuration', async () => {
    const {fetchFn} = scripted({errors: [{message: 'Access denied'}]});
    const client = createShopifyCustomerSubscriber({env: ENV, fetch: fetchFn});
    expect(await client?.subscribe(REQUEST)).toEqual({
      status: 'failed',
      reason: 'config',
    });
  });

  it('turns a network error and an unreadable body into a failure', async () => {
    const down = createShopifyCustomerSubscriber({
      env: ENV,
      fetch: () => Promise.reject(new Error('boom')),
    });
    expect(await down?.subscribe(REQUEST)).toEqual({
      status: 'failed',
      reason: 'network',
    });
    const junk = createShopifyCustomerSubscriber({
      env: ENV,
      fetch: () => Promise.resolve(new Response('not json', {status: 200})),
    });
    expect((await junk?.subscribe(REQUEST))?.status).toBe('failed');
  });
});

describe('combineSubscribers', () => {
  const accepted: KlaviyoClient = {
    subscribe: () => Promise.resolve({status: 'accepted'}),
  };
  const failed: KlaviyoClient = {
    subscribe: () => Promise.resolve({status: 'failed', reason: 'network'}),
  };

  it('is the one that exists, or null', () => {
    expect(combineSubscribers(null, null)).toBeNull();
    expect(combineSubscribers(accepted, null)).toBe(accepted);
    expect(combineSubscribers(null, failed)).toBe(failed);
  });

  it('runs both and accepts when at least one took the signup', async () => {
    const spy = vi.fn(accepted.subscribe);
    const both = combineSubscribers({subscribe: spy}, accepted);
    expect(await both?.subscribe(REQUEST)).toEqual({status: 'accepted'});
    expect(spy).toHaveBeenCalledTimes(1);
    expect(
      await combineSubscribers(failed, accepted)?.subscribe(REQUEST),
    ).toEqual({status: 'accepted'});
    expect(
      await combineSubscribers(accepted, failed)?.subscribe(REQUEST),
    ).toEqual({status: 'accepted'});
  });

  it('fails only when both fail, and survives a client that throws', async () => {
    expect(
      await combineSubscribers(failed, failed)?.subscribe(REQUEST),
    ).toEqual({status: 'failed', reason: 'network'});
    const throws: KlaviyoClient = {
      subscribe: () => Promise.reject(new Error('boom')),
    };
    expect(
      await combineSubscribers(throws, accepted)?.subscribe(REQUEST),
    ).toEqual({status: 'accepted'});
  });
});
