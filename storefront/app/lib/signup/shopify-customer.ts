// SERVER ONLY. Puts every newsletter signup into Shopify as a customer carrying the tag `subscribe` (owner request
// 2026-11-06, REQ-ANL-003, CR-34), so the store team can filter Customers by that tag and the address is marked as
// subscribed to email marketing. It has the same `subscribe` contract as the Klaviyo and SMTP clients, so every check in
// handler.ts (same origin, rate limit, honeypot, explicit unticked consent) runs before it.
//
// Uses the Shopify ADMIN GraphQL API (the Storefront API cannot create a customer without a password). The credential is
// the Dev Dashboard app's ADMIN_CLIENT_ID and ADMIN_CLIENT_SECRET, from which the server fetches and renews its own 24-hour
// token (~/lib/shopify/admin-token.ts), or a fixed SHOPIFY_ADMIN_API_ACCESS_TOKEN if one is set. Server-only. Nothing is faked: without them there is
// no client.
//
// Steps: look the address up; if the customer exists, add the tag and mark the email subscribed; if not, create the customer
// with the tag and the subscribed consent in one call. The mutations and fields below follow Shopify's Admin GraphQL
// reference (`customerByIdentifier`, `customerCreate`, `tagsAdd`, `customerEmailMarketingConsentUpdate`).
// UNVERIFIED against the client's store and API version 2026-10: needs a run against the development store (see
// docs/integrations/NEWSLETTER_SHOPIFY.md). Logs carry reason codes only, never an address.

import {adminConfigFromEnv} from '~/lib/extend/admin-client';
import {logWarn} from '~/lib/logging/logger';
import {readCappedBody} from '~/lib/extend/capped-body';
import type {FetchLike} from '~/lib/extend/types';
import type {
  KlaviyoClient,
  SubscribeFailure,
  SubscribeRequest,
} from '~/lib/signup/klaviyo-client';

/** The tag the store team filters by. */
export const SUBSCRIBE_TAG = 'subscribe';

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

/** True when the store domain and an Admin credential (a fixed token, or the app's client id and secret) are present. Decides whether the signup is on. */
export function shopifyCustomerSignupAvailable(env: object): boolean {
  return adminConfigFromEnv(env).status === 'ready';
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
  const resolved = adminConfigFromEnv(options.env, undefined, options.fetch);
  if (resolved.status !== 'ready') return null;
  const admin = resolved;
  const fetchFn: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  const now = options.now ?? (() => new Date());
  const endpoint = `https://${admin.store}/admin/api/${admin.apiVersion}/graphql.json`;

  /** The request headers, or the reason there are none (the token could not be fetched). */
  async function headers(): Promise<
    | {readonly status: 'ok'; readonly value: Record<string, string>}
    | {readonly status: 'failed'; readonly reason: SubscribeFailure}
  > {
    const auth = await admin.headers();
    if (auth.status !== 'ok') {
      logWarn('signup.shopify_token_failed', {reason: auth.reason});
      // A refusal means our id, secret or installation is wrong (ours to fix); anything else is an outage.
      return {
        status: 'failed',
        reason: auth.reason === 'auth' ? 'auth' : 'server',
      };
    }
    return {status: 'ok', value: auth.headers};
  }

  async function call(
    query: string,
    variables: Readonly<Record<string, unknown>>,
    retried = false,
  ): Promise<Call> {
    const credential = await headers();
    if (credential.status !== 'ok') {
      return {status: 'failed', reason: credential.reason};
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetchFn(endpoint, {
        method: 'POST',
        headers: credential.value,
        body: JSON.stringify({query, variables}),
        signal: controller.signal,
        // 'manual', not 'error': Node's fetch throws on 'error'. A redirect comes back as a 3xx and is a failure below.
        redirect: 'manual',
      });
      if (response.status === 401 || response.status === 403) {
        await response.body?.cancel();
        // A fetched token can be revoked (the app was reinstalled): forget it and try once with a new one.
        if (!retried && admin.invalidate()) {
          return call(query, variables, true);
        }
        return {status: 'failed', reason: 'auth'};
      }
      if (response.status === 429) {
        await response.body?.cancel();
        return {status: 'failed', reason: 'rate_limited'};
      }
      if (response.status < 200 || response.status > 299) {
        await response.body?.cancel();
        logWarn('signup.shopify_call_failed', {httpStatus: response.status});
        return {status: 'failed', reason: 'server'};
      }
      const read = await readCappedBody(response, MAX_RESPONSE_BYTES);
      if (read.status !== 'ok') return {status: 'failed', reason: 'unexpected'};
      const body: unknown = JSON.parse(new TextDecoder().decode(read.bytes));
      const errors = child(body, 'errors');
      if (Array.isArray(errors) && errors.length > 0) {
        // Missing scope or an unknown field both land here: our configuration, not the shopper's address.
        logWarn('signup.shopify_call_failed', {graphqlErrors: errors.length});
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
