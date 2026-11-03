// SERVER ONLY. Saves a visit request as a Shopify customer through the Admin GraphQL API (CR-33, DEC-144, T-05, T-13).
//
// Needs its OWN token, `SHOPIFY_CUSTOMER_ADMIN_API_ACCESS_TOKEN`, with `write_customers` and `read_customers` only: the
// order-read token must stay read-only. Same outbound rules as the order read: the host is always
// `<shop>.myshopify.com` over https, redirects are refused, there is a timeout and a size cap. One attempt, no retry: the
// shopper is waiting, and a failure is shown to them as "try again".
//
// New phone number: `customerCreate` with the tags and a note. Known phone number (Shopify refuses a duplicate): look the
// customer up by phone and add the tags to the existing record, so the store sees the new request without us touching
// their other details.
//
// UNVERIFIED against a store: mutation shapes follow the Admin API reference for the pinned version and are covered by
// tests with a stubbed fetch only. Verify on a development store before relying on it (docs/integrations/VISIT_REQUESTS.md).

import {adminConfigFromEnv} from '~/lib/extend/admin-client';
import {readCappedBody} from '~/lib/extend/capped-body';
import type {FetchLike} from '~/lib/extend/types';
import {
  visitNote,
  visitTags,
  type VisitRequest,
} from '~/lib/leads/visit-request';

export const CUSTOMER_TOKEN_ENV = 'SHOPIFY_CUSTOMER_ADMIN_API_ACCESS_TOKEN';

const MAX_RESPONSE_BYTES = 200_000;
const TIMEOUT_MS = 8000;

export type SaveVisitFailure =
  | 'auth'
  | 'throttled'
  | 'timeout'
  | 'network'
  | 'http'
  | 'graphql'
  | 'user_error'
  | 'malformed';

export type SaveVisitResult =
  | {readonly status: 'saved'}
  | {readonly status: 'failed'; readonly reason: SaveVisitFailure};

export type VisitCustomerClient = {
  save(request: VisitRequest): Promise<SaveVisitResult>;
};

// Admin API documents: no `#graphql` marker, which would make codegen validate them against the Storefront schema.
const CREATE_MUTATION = `
  mutation VisitRequestCreate($input: CustomerInput!) {
    customerCreate(input: $input) {
      customer {
        id
      }
      userErrors {
        message
      }
    }
  }
`;

const FIND_QUERY = `
  query VisitRequestFind($query: String!) {
    customers(first: 1, query: $query) {
      nodes {
        id
      }
    }
  }
`;

const TAGS_MUTATION = `
  mutation VisitRequestTags($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) {
      userErrors {
        message
      }
    }
  }
`;

type Call =
  | {readonly kind: 'data'; readonly data: Record<string, unknown>}
  | {readonly kind: 'failed'; readonly reason: SaveVisitFailure};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function failureOf(errors: readonly unknown[]): SaveVisitFailure {
  const codes = errors.map((entry) => {
    const extensions = isRecord(entry) ? entry['extensions'] : null;
    return isRecord(extensions) ? extensions['code'] : null;
  });
  if (codes.includes('THROTTLED')) return 'throttled';
  if (codes.includes('ACCESS_DENIED')) return 'auth';
  return 'graphql';
}

async function call(
  endpoint: string,
  headers: Record<string, string>,
  fetchFn: FetchLike,
  query: string,
  variables: Record<string, unknown>,
): Promise<Call> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchFn(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({query, variables}),
      signal: controller.signal,
      redirect: 'error',
    });
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel();
      return {kind: 'failed', reason: 'auth'};
    }
    if (response.status === 429) {
      await response.body?.cancel();
      return {kind: 'failed', reason: 'throttled'};
    }
    if (response.status < 200 || response.status > 299) {
      await response.body?.cancel();
      return {kind: 'failed', reason: 'http'};
    }
    const read = await readCappedBody(response, MAX_RESPONSE_BYTES);
    if (read.status !== 'ok') return {kind: 'failed', reason: 'malformed'};
    const body: unknown = JSON.parse(new TextDecoder().decode(read.bytes));
    if (!isRecord(body)) return {kind: 'failed', reason: 'malformed'};
    const errors = body['errors'];
    if (Array.isArray(errors) && errors.length > 0) {
      return {kind: 'failed', reason: failureOf(errors)};
    }
    const data = body['data'];
    return isRecord(data)
      ? {kind: 'data', data}
      : {kind: 'failed', reason: 'malformed'};
  } catch {
    return {
      kind: 'failed',
      reason: controller.signal.aborted ? 'timeout' : 'network',
    };
  } finally {
    clearTimeout(timer);
  }
}

/** The userErrors messages of one mutation payload, or null when the payload is not the expected shape. */
function userErrorMessages(payload: unknown): string[] | null {
  if (!isRecord(payload)) return null;
  const errors = payload['userErrors'];
  if (!Array.isArray(errors)) return null;
  return errors.map((entry: unknown) =>
    isRecord(entry) && typeof entry['message'] === 'string'
      ? entry['message']
      : '',
  );
}

/** Shopify words a duplicate phone as "Phone has already been taken". */
function isDuplicate(messages: readonly string[]): boolean {
  return messages.some((message) => /taken|already/i.test(message));
}

/** Null when the token or the shop domain is missing or malformed: nothing is faked. */
export function createVisitCustomerClient(options: {
  readonly env: object;
  readonly fetch: FetchLike;
  readonly now?: () => Date;
}): VisitCustomerClient | null {
  const admin = adminConfigFromEnv(options.env, CUSTOMER_TOKEN_ENV);
  if (admin.status !== 'ready') return null;
  const endpoint = `https://${admin.store}/admin/api/${admin.apiVersion}/graphql.json`;
  const headers = admin.headers();
  const now = options.now ?? (() => new Date());

  async function addTagsToExisting(
    request: VisitRequest,
  ): Promise<SaveVisitResult> {
    const found = await call(endpoint, headers, options.fetch, FIND_QUERY, {
      query: `phone:${request.phone}`,
    });
    if (found.kind === 'failed') {
      return {status: 'failed', reason: found.reason};
    }
    const customers = found.data['customers'];
    const nodes = isRecord(customers) ? customers['nodes'] : null;
    const first: unknown = Array.isArray(nodes) ? nodes[0] : undefined;
    const id = isRecord(first) ? first['id'] : null;
    if (typeof id !== 'string') return {status: 'failed', reason: 'malformed'};

    const tagged = await call(endpoint, headers, options.fetch, TAGS_MUTATION, {
      id,
      tags: visitTags(request),
    });
    if (tagged.kind === 'failed') {
      return {status: 'failed', reason: tagged.reason};
    }
    const messages = userErrorMessages(tagged.data['tagsAdd']);
    if (messages === null) return {status: 'failed', reason: 'malformed'};
    return messages.length === 0
      ? {status: 'saved'}
      : {status: 'failed', reason: 'user_error'};
  }

  return {
    async save(request) {
      const created = await call(
        endpoint,
        headers,
        options.fetch,
        CREATE_MUTATION,
        {
          input: {
            firstName: request.firstName,
            ...(request.lastName === null ? {} : {lastName: request.lastName}),
            phone: request.phone,
            tags: visitTags(request),
            note: visitNote(request, now()),
          },
        },
      );
      if (created.kind === 'failed') {
        return {status: 'failed', reason: created.reason};
      }
      const messages = userErrorMessages(created.data['customerCreate']);
      if (messages === null) return {status: 'failed', reason: 'malformed'};
      if (messages.length === 0) return {status: 'saved'};
      return isDuplicate(messages)
        ? addTagsToExisting(request)
        : {status: 'failed', reason: 'user_error'};
    },
  };
}
