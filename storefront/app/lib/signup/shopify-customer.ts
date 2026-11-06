// SERVER ONLY. Puts every newsletter signup into Shopify as a customer carrying the tag `subscribe` (owner request
// 2026-11-06, REQ-ANL-003, CR-34), so the store team can filter Customers by that tag and the address is marked as
// subscribed to email marketing. It has the same `subscribe` contract as the Klaviyo and SMTP clients, so every check in
// handler.ts (same origin, rate limit, honeypot, explicit unticked consent) runs before it.
//
// Uses the Shopify ADMIN GraphQL API (the Storefront API cannot create a customer without a password). The token is its own
// `write_customers` token (SHOPIFY_CUSTOMERS_ADMIN_API_ACCESS_TOKEN), never the read_orders token of the order lookup, and
// server-only. Nothing is faked: without it there is no client.
//
// Steps: look the address up; if the customer exists, add the tag and mark the email subscribed; if not, create the customer
// with the tag and the subscribed consent in one call. The mutations and fields below follow Shopify's Admin GraphQL
// reference (`customerByIdentifier`, `customerCreate`, `tagsAdd`, `customerEmailMarketingConsentUpdate`).
// UNVERIFIED against the client's store and API version 2026-10: needs a run against the development store (see
// docs/integrations/NEWSLETTER_SHOPIFY.md). Logs carry reason codes only, never an address.

import {adminConfigFromEnv} from '~/lib/extend/admin-client';
import {readCappedBody} from '~/lib/extend/capped-body';
import type {FetchLike} from '~/lib/extend/types';
import type {
  KlaviyoClient,
  SubscribeFailure,
  SubscribeRequest,
} from '~/lib/signup/klaviyo-client';

/** The tag the store team filters by. */
export const SUBSCRIBE_TAG = 'subscribe';
export const CUSTOMERS_TOKEN_ENV = 'SHOPIFY_CUSTOMERS_ADMIN_API_ACCESS_TOKEN';

const TIMEOUT_MS = 6000;
const MAX_RESPONSE_BYTES = 200_000;

export const LOOKUP_QUERY = `query SignupCustomerByEmail($email: String!) {
  customerByIdentifier(identifier: {emailAddress: $email}) { id }
}`;

export const CREATE_MUTATION = `mutation SignupCustomerCreate($input: CustomerInput!) {
  customerCreate(input: $input) {
    customer { id }
    userErrors { field message }
  }
}`;

export const TAGS_ADD_MUTATION = `mutation SignupTagsAdd($id: ID!, $tags: [String!]!) {
  tagsAdd(id: $id, tags: $tags) {
    node { id }
    userErrors { field message }
  }
}`;

export const CONSENT_MUTATION = `mutation SignupEmailConsent($input: CustomerEmailMarketingConsentUpdateInput!) {
  customerEmailMarketingConsentUpdate(input: $input) {
    customer { id }
    userErrors { field message }
  }
}`;

/** True when the store domain and the customers token are present and well formed. Decides whether the signup is on. */
export function shopifyCustomerSignupAvailable(env: object): boolean {
  return adminConfigFromEnv(env, CUSTOMERS_TOKEN_ENV).status === 'ready';
}

type Call =
  | {readonly status: 'ok'; readonly data: unknown}
  | {readonly status: 'failed'; readonly reason: SubscribeFailure};

function child(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null
    ? Reflect.get(value, key)
    : undefined;
}

/** A mutation's userErrors, or null when the payload has none. A payload that is not the expected shape counts as an error. */
function hasUserErrors(payload: unknown): boolean {
  if (typeof payload !== 'object' || payload === null) return true;
  const errors = child(payload, 'userErrors');
  return !Array.isArray(errors) || errors.length > 0;
}

export function createShopifyCustomerSubscriber(options: {
  readonly env: object;
  readonly fetch?: FetchLike;
  readonly now?: () => Date;
}): KlaviyoClient | null {
  const admin = adminConfigFromEnv(options.env, CUSTOMERS_TOKEN_ENV);
  if (admin.status !== 'ready') return null;
  const fetchFn: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  const now = options.now ?? (() => new Date());
  const endpoint = `https://${admin.store}/admin/api/${admin.apiVersion}/graphql.json`;

  async function call(
    query: string,
    variables: Readonly<Record<string, unknown>>,
  ): Promise<Call> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetchFn(endpoint, {
        method: 'POST',
        headers: admin.status === 'ready' ? admin.headers() : {},
        body: JSON.stringify({query, variables}),
        signal: controller.signal,
        redirect: 'error',
      });
      if (response.status === 401 || response.status === 403) {
        await response.body?.cancel();
        return {status: 'failed', reason: 'auth'};
      }
      if (response.status === 429) {
        await response.body?.cancel();
        return {status: 'failed', reason: 'rate_limited'};
      }
      if (response.status < 200 || response.status > 299) {
        await response.body?.cancel();
        return {status: 'failed', reason: 'server'};
      }
      const read = await readCappedBody(response, MAX_RESPONSE_BYTES);
      if (read.status !== 'ok') return {status: 'failed', reason: 'unexpected'};
      const body: unknown = JSON.parse(new TextDecoder().decode(read.bytes));
      const errors = child(body, 'errors');
      if (Array.isArray(errors) && errors.length > 0) {
        // Missing scope or an unknown field both land here: our configuration, not the shopper's address.
        return {status: 'failed', reason: 'config'};
      }
      return {status: 'ok', data: child(body, 'data')};
    } catch {
      return {
        status: 'failed',
        reason: controller.signal.aborted ? 'timeout' : 'network',
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async function findId(email: string): Promise<Call & {id?: string}> {
    const found = await call(LOOKUP_QUERY, {email});
    if (found.status !== 'ok') return found;
    const id = child(child(found.data, 'customerByIdentifier'), 'id');
    return typeof id === 'string' ? {...found, id} : found;
  }

  const consent = () => ({
    marketingState: 'SUBSCRIBED',
    marketingOptInLevel: 'SINGLE_OPT_IN',
    consentUpdatedAt: now().toISOString(),
  });

  /** An existing customer: add the tag, then mark the email subscribed. */
  async function tagExisting(id: string): Promise<Call> {
    const tagged = await call(TAGS_ADD_MUTATION, {id, tags: [SUBSCRIBE_TAG]});
    if (
      tagged.status !== 'ok' ||
      hasUserErrors(child(tagged.data, 'tagsAdd'))
    ) {
      return tagged.status === 'ok'
        ? {status: 'failed', reason: 'rejected'}
        : tagged;
    }
    const marked = await call(CONSENT_MUTATION, {
      input: {customerId: id, emailMarketingConsent: consent()},
    });
    if (marked.status !== 'ok') return marked;
    return hasUserErrors(
      child(marked.data, 'customerEmailMarketingConsentUpdate'),
    )
      ? {status: 'failed', reason: 'rejected'}
      : marked;
  }

  return {
    async subscribe(request: SubscribeRequest) {
      try {
        const existing = await findId(request.email);
        if (existing.status !== 'ok') return existing;
        if (existing.id !== undefined) {
          const done = await tagExisting(existing.id);
          return done.status === 'ok' ? {status: 'accepted'} : done;
        }
        const created = await call(CREATE_MUTATION, {
          input: {
            email: request.email,
            tags: [SUBSCRIBE_TAG],
            emailMarketingConsent: consent(),
          },
        });
        if (created.status !== 'ok') return created;
        if (!hasUserErrors(child(created.data, 'customerCreate'))) {
          return {status: 'accepted'};
        }
        // Most likely the same address was created a moment ago by another request: look again and tag that customer.
        const again = await findId(request.email);
        if (again.status === 'ok' && again.id !== undefined) {
          const done = await tagExisting(again.id);
          return done.status === 'ok' ? {status: 'accepted'} : done;
        }
        return {status: 'failed', reason: 'rejected'};
      } catch {
        return {status: 'failed', reason: 'unexpected'};
      }
    },
  };
}
