// SERVER ONLY. Reads ONE order through the Shopify Admin GraphQL API for the Extend sync (P5A-08, T-03, T-13).
// Read-only: the document is a query and the token needs only the order read scope. The token lives in a closure
// like the Extend token, so it cannot leak through JSON.stringify, logs or error reports.
//
// Outbound allow-list: the host is always `<shop>.myshopify.com` over https (the domain pattern below), the API
// version is a constant, redirects are refused, and every call has a timeout and a size cap.

import {
  ADMIN_API_VERSION,
  EXTEND_ORDER_BY_ID_QUERY,
  parseAdminOrder,
} from '~/lib/extend/admin-order';
import {readEnvString} from '~/lib/extend/env';
import {normalizeShopifyId} from '~/lib/extend/ids';
import type {ShopifyOrderLike} from '~/lib/extend/orders';
import type {FetchLike, SleepFn} from '~/lib/extend/types';

const SHOP_DOMAIN = /^[a-z0-9][a-z0-9-]{0,60}[a-z0-9]\.myshopify\.com$/;
const MAX_RESPONSE_CHARS = 2_000_000;
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_ATTEMPTS = 3;

export type AdminConfigResult =
  | {
      status: 'ready';
      readonly store: string;
      readonly apiVersion: string;
      readonly headers: () => Record<string, string>;
    }
  | {status: 'not_configured'; missing: readonly string[]};

/**
 * The shop comes from PUBLIC_STORE_DOMAIN (the storefront's own store), never from the webhook, so a forged
 * `X-Shopify-Shop-Domain` header cannot point the token at another host. A custom or mock.shop domain is refused.
 */
export function adminConfigFromEnv(env: object): AdminConfigResult {
  const domain = readEnvString(env, 'PUBLIC_STORE_DOMAIN')
    ?.toLowerCase()
    .replace(/^https:\/\//, '')
    .replace(/\/+$/, '');
  const token = readEnvString(env, 'SHOPIFY_ADMIN_API_ACCESS_TOKEN');
  const missing = [
    domain === undefined || !SHOP_DOMAIN.test(domain)
      ? 'PUBLIC_STORE_DOMAIN (a <shop>.myshopify.com domain)'
      : null,
    token === null ? 'SHOPIFY_ADMIN_API_ACCESS_TOKEN' : null,
  ].filter((name): name is string => name !== null);
  if (
    missing.length > 0 ||
    domain === undefined ||
    token === null ||
    !/^[\x21-\x7E]{1,512}$/.test(token)
  ) {
    return {
      status: 'not_configured',
      missing:
        missing.length > 0 ? missing : ['SHOPIFY_ADMIN_API_ACCESS_TOKEN'],
    };
  }
  return {
    status: 'ready',
    store: domain,
    apiVersion: ADMIN_API_VERSION,
    headers: () => ({
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Shopify-Access-Token': token,
    }),
  };
}

export type ReadOrderFailure =
  | 'not_configured'
  | 'invalid_order_id'
  | 'not_found'
  | 'auth'
  | 'throttled'
  | 'timeout'
  | 'network'
  | 'http'
  | 'graphql'
  | 'malformed'
  | 'truncated';

export type ReadOrderResult =
  | {status: 'ok'; order: ShopifyOrderLike}
  | {status: 'error'; reason: ReadOrderFailure; retriable: boolean};

export type ReadOrderDeps = {
  admin: AdminConfigResult;
  fetch: FetchLike;
  sleep: SleepFn;
  timeoutMs?: number;
  maxAttempts?: number;
};

type Exchange =
  | {kind: 'body'; body: unknown}
  | {kind: 'failed'; reason: ReadOrderFailure; retriable: boolean};

async function exchange(
  admin: Extract<AdminConfigResult, {status: 'ready'}>,
  fetchFn: FetchLike,
  orderGid: string,
  timeoutMs: number,
): Promise<Exchange> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(
      `https://${admin.store}/admin/api/${admin.apiVersion}/graphql.json`,
      {
        method: 'POST',
        headers: admin.headers(),
        body: JSON.stringify({
          query: EXTEND_ORDER_BY_ID_QUERY,
          variables: {id: orderGid},
          operationName: 'ExtendOrderById',
        }),
        signal: controller.signal,
        redirect: 'error',
      },
    );
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel();
      return {kind: 'failed', reason: 'auth', retriable: false};
    }
    if (response.status === 429) {
      await response.body?.cancel();
      return {kind: 'failed', reason: 'throttled', retriable: true};
    }
    if (response.status < 200 || response.status > 299) {
      await response.body?.cancel();
      return {
        kind: 'failed',
        reason: 'http',
        retriable: response.status >= 500 || response.status === 408,
      };
    }
    const raw = await response.text();
    if (raw.length > MAX_RESPONSE_CHARS) {
      return {kind: 'failed', reason: 'malformed', retriable: false};
    }
    try {
      return {kind: 'body', body: JSON.parse(raw)};
    } catch {
      return {kind: 'failed', reason: 'malformed', retriable: false};
    }
  } catch {
    return controller.signal.aborted
      ? {kind: 'failed', reason: 'timeout', retriable: true}
      : {kind: 'failed', reason: 'network', retriable: true};
  } finally {
    clearTimeout(timer);
  }
}

function interpret(body: unknown): ReadOrderResult {
  if (typeof body !== 'object' || body === null) {
    return {status: 'error', reason: 'malformed', retriable: false};
  }
  const errors: unknown = Reflect.get(body, 'errors');
  if (Array.isArray(errors) && errors.length > 0) {
    // THROTTLED is Shopify's documented code for the calculated-cost limit (see scripts/lib/shopify-admin.mjs).
    const throttled = errors.some(
      (entry: unknown) =>
        typeof entry === 'object' &&
        entry !== null &&
        Reflect.get(Reflect.get(entry, 'extensions') ?? {}, 'code') ===
          'THROTTLED',
    );
    return {
      status: 'error',
      reason: throttled ? 'throttled' : 'graphql',
      retriable: throttled,
    };
  }
  const data: unknown = Reflect.get(body, 'data');
  const node: unknown =
    typeof data === 'object' && data !== null
      ? Reflect.get(data, 'order')
      : undefined;
  if (node === null) {
    return {status: 'error', reason: 'not_found', retriable: false};
  }
  const parsed = parseAdminOrder(node);
  if (parsed.status === 'error') {
    return {status: 'error', reason: parsed.reason, retriable: false};
  }
  return {status: 'ok', order: parsed.order};
}

/**
 * Fetches and maps one order. Bounded attempts with exponential backoff for transient failures only (timeout,
 * network, 429, 5xx); an auth failure, a missing order or a malformed answer is returned at once. Never throws and
 * never logs: the caller logs the reason with the order id.
 */
export async function readOrderForSync(
  deps: ReadOrderDeps,
  orderId: string,
): Promise<ReadOrderResult> {
  if (deps.admin.status !== 'ready') {
    return {status: 'error', reason: 'not_configured', retriable: false};
  }
  const numeric = normalizeShopifyId(orderId);
  if (numeric === null) {
    return {status: 'error', reason: 'invalid_order_id', retriable: false};
  }
  const gid = `gid://shopify/Order/${numeric}`;
  const attempts = Math.max(1, deps.maxAttempts ?? DEFAULT_ATTEMPTS);
  let last: ReadOrderResult = {
    status: 'error',
    reason: 'network',
    retriable: true,
  };
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await exchange(
      deps.admin,
      deps.fetch,
      gid,
      deps.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
    last =
      result.kind === 'body'
        ? interpret(result.body)
        : {status: 'error', reason: result.reason, retriable: result.retriable};
    if (last.status === 'ok' || !last.retriable || attempt === attempts) {
      return last;
    }
    await deps.sleep(Math.min(4000, 500 * 2 ** (attempt - 1)));
  }
  return last;
}
