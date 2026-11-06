// SERVER ONLY. Loads the offer rules and the delivery zone from Shopify itself (ADR-0013), so no offer environment
// variable exists: gifts come from active automatic discounts (Buy X get Y, or 100% off specific products), the other rules from the `offer_rule` and
// `delivery_zone` metaobjects. It reads with an Admin token (scopes read_discounts, read_metaobjects, read_products): a fixed
// SHOPIFY_ADMIN_API_ACCESS_TOKEN if one is set, else one fetched from ADMIN_CLIENT_ID and ADMIN_CLIENT_SECRET
// (~/lib/extend/admin-client.ts), plus the store domain, nothing else.
//
// Rules change when staff edit Shopify, so they are cached per store for a minute, requests that arrive during a refresh
// share it, and a failed refresh keeps the last good rules (stale beats absent). With no token (a dev server on mock.shop)
// the answer is "none": no offers, and the cart keeps working.

import {
  adminConfigFromEnv,
  type AdminConfigResult,
} from '~/lib/extend/admin-client';
import {readCappedBody} from '~/lib/extend/capped-body';
import {readEnvString} from '~/lib/extend/env';
import type {FetchLike} from '~/lib/extend/types';
import type {OfferRules} from '~/lib/offers/types';
import {
  EMPTY_OFFER_CONFIG,
  parseOfferConfig,
  type OfferConfigLoad,
} from './config';
import {
  buildRawOfferConfig,
  giftProductIdsOf,
  giftsFromDiscounts,
  productInfoOf,
  referencedIds,
  type ProductInfo,
} from './shopify-rules-map';

const FRESH_MS = 60_000;
/** After a failed refresh, wait this long before asking Shopify again. */
const RETRY_MS = 10_000;
const TIMEOUT_MS = 4_000;
const MAX_BYTES = 2_000_000;
const PRODUCT_CHUNK = 10;
const COLLECTION_CHUNK = 2;
const MAX_PRODUCTS = 100;
const MAX_COLLECTIONS = 10;

// These are Admin API documents, deliberately NOT tagged `#graphql`: Hydrogen's codegen validates tagged documents against
// the Storefront schema, which has no discount types, and fails the build.
// The two discount documents are kept lean (Shopify refuses a query whose requested cost is over 1000): gift variants are
// fetched afterwards per product, in the same chunks as the rule products.
const DISCOUNTS_QUERY = `
query OfferGiftDiscounts {
  discountNodes(first: 10, query: "status:active method:automatic type:bxgy") {
    nodes {
      id
      discount {
        __typename
        ... on DiscountAutomaticBxgy {
          title
          status
          usesPerOrderLimit
          customerBuys {
            value {
              __typename
              ... on DiscountQuantity { quantity }
            }
            items {
              __typename
              ... on DiscountProducts {
                products(first: 100) { nodes { id } }
              }
              ... on DiscountCollections {
                collections(first: 10) { nodes { id } }
              }
            }
          }
          customerGets {
            value {
              __typename
              ... on DiscountOnQuantity {
                quantity { quantity }
                effect {
                  __typename
                  ... on DiscountPercentage { percentage }
                }
              }
            }
            items {
              __typename
              ... on DiscountProducts {
                products(first: 3) { nodes { id title } }
                productVariants(first: 10) {
                  nodes {
                    id
                    title
                    selectedOptions { name value }
                    product { id title }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}`;

// Plain "Amount off products" automatic discounts: those at 100% off specific products make those products gifts.
const FREE_PRODUCTS_QUERY = `
query OfferFreeProducts {
  discountNodes(first: 25, query: "status:active method:automatic type:percentage") {
    nodes {
      id
      discount {
        __typename
        ... on DiscountAutomaticBasic {
          title
          status
          minimumRequirement { __typename }
          customerGets {
            value {
              __typename
              ... on DiscountPercentage { percentage }
            }
            items {
              __typename
              ... on DiscountProducts {
                products(first: 3) { nodes { id title } }
              }
            }
          }
        }
      }
    }
  }
}`;

const RULES_QUERY = `
query OfferRuleEntries {
  rules: metaobjects(type: "offer_rule", first: 50) {
    nodes { id fields { key value } }
  }
  zones: metaobjects(type: "delivery_zone", first: 1) {
    nodes { fields { key value } }
  }
}`;

const PRODUCTS_QUERY = `
query OfferRuleProducts($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on Product {
      id
      title
      variants(first: 50) {
        nodes { id title selectedOptions { name value } }
      }
    }
  }
}`;

const COLLECTIONS_QUERY = `
query OfferRuleCollections($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on Collection {
      id
      products(first: 250) { nodes { id } }
    }
  }
}`;

type ReadyAdmin = Extract<AdminConfigResult, {status: 'ready'}>;
type QueryResult =
  | {readonly status: 'ok'; readonly data: unknown}
  | {readonly status: 'error'; readonly reason: string};

async function query(
  admin: ReadyAdmin,
  fetchFn: FetchLike,
  document: string,
  variables: Record<string, unknown>,
  retried = false,
): Promise<QueryResult> {
  const auth = await admin.headers();
  if (auth.status !== 'ok') {
    return {status: 'error', reason: `token_${auth.reason}`};
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchFn(
      `https://${admin.store}/admin/api/${admin.apiVersion}/graphql.json`,
      {
        method: 'POST',
        headers: auth.headers,
        body: JSON.stringify({query: document, variables}),
        signal: controller.signal,
        // 'manual', not 'error': Node's fetch throws on 'error'. A redirect comes back as a 3xx and is an error below.
        redirect: 'manual',
      },
    );
    if ((response.status === 401 || response.status === 403) && !retried) {
      // A fetched token can be revoked (the app was reinstalled): drop it and ask once more with a new one.
      await response.body?.cancel();
      if (admin.invalidate()) {
        return query(admin, fetchFn, document, variables, true);
      }
      return {status: 'error', reason: `http_${response.status}`};
    }
    if (response.status < 200 || response.status > 299) {
      await response.body?.cancel();
      return {status: 'error', reason: `http_${response.status}`};
    }
    const read = await readCappedBody(response, MAX_BYTES);
    if (read.status !== 'ok') return {status: 'error', reason: 'malformed'};
    const body: unknown = JSON.parse(new TextDecoder().decode(read.bytes));
    if (typeof body !== 'object' || body === null) {
      return {status: 'error', reason: 'malformed'};
    }
    const errors: unknown = Reflect.get(body, 'errors');
    if (Array.isArray(errors) && errors.length > 0) {
      return {status: 'error', reason: 'graphql'};
    }
    return {status: 'ok', data: Reflect.get(body, 'data')};
  } catch {
    return {
      status: 'error',
      reason: controller.signal.aborted ? 'timeout' : 'network',
    };
  } finally {
    clearTimeout(timer);
  }
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function nodesOf(data: unknown, key: string): readonly unknown[] {
  if (typeof data !== 'object' || data === null) return [];
  const connection: unknown = Reflect.get(data, key);
  if (typeof connection !== 'object' || connection === null) return [];
  const nodes: unknown = Reflect.get(connection, 'nodes');
  return Array.isArray(nodes) ? nodes : [];
}

function nodeList(data: unknown): readonly unknown[] {
  if (typeof data !== 'object' || data === null) return [];
  const nodes: unknown = Reflect.get(data, 'nodes');
  return Array.isArray(nodes) ? nodes : [];
}

type Fetched =
  | {readonly status: 'ok'; readonly load: OfferConfigLoad}
  | {readonly status: 'error'; readonly reason: string};

async function fetchOfferConfig(
  admin: ReadyAdmin,
  fetchFn: FetchLike,
): Promise<Fetched> {
  const [discounts, free, rules] = await Promise.all([
    query(admin, fetchFn, DISCOUNTS_QUERY, {}),
    query(admin, fetchFn, FREE_PRODUCTS_QUERY, {}),
    query(admin, fetchFn, RULES_QUERY, {}),
  ]);
  if (discounts.status === 'error') {
    return {status: 'error', reason: `discounts_${discounts.reason}`};
  }
  if (free.status === 'error') {
    return {status: 'error', reason: `free_products_${free.reason}`};
  }
  if (rules.status === 'error') {
    return {status: 'error', reason: `rules_${rules.reason}`};
  }
  const warnings: string[] = [];
  const warn = (note: string) => warnings.push(note);
  const ruleNodes = nodesOf(rules.data, 'rules');
  const ids = referencedIds(ruleNodes);

  const products = new Map<string, ProductInfo>();
  const productIds = [
    ...new Set([
      ...ids.offeredProductIds,
      ...giftProductIdsOf(discounts.data, free.data),
    ]),
  ].slice(0, MAX_PRODUCTS);
  for (const batch of chunks(productIds, PRODUCT_CHUNK)) {
    const answer = await query(admin, fetchFn, PRODUCTS_QUERY, {ids: batch});
    if (answer.status === 'error') {
      return {status: 'error', reason: `products_${answer.reason}`};
    }
    for (const node of nodeList(answer.data)) {
      const info = productInfoOf(node);
      if (info !== null && info.id !== '') products.set(info.id, info);
    }
  }

  const collections = new Map<string, string[]>();
  for (const batch of chunks(
    ids.triggerCollectionIds.slice(0, MAX_COLLECTIONS),
    COLLECTION_CHUNK,
  )) {
    const answer = await query(admin, fetchFn, COLLECTIONS_QUERY, {
      ids: batch,
    });
    if (answer.status === 'error') {
      return {status: 'error', reason: `collections_${answer.reason}`};
    }
    for (const node of nodeList(answer.data)) {
      if (typeof node !== 'object' || node === null) continue;
      const id: unknown = Reflect.get(node, 'id');
      if (typeof id !== 'string') continue;
      collections.set(
        id,
        nodesOf(node, 'products').flatMap((product) => {
          const productId =
            typeof product === 'object' && product !== null
              ? Reflect.get(product, 'id')
              : null;
          return typeof productId === 'string' ? [productId] : [];
        }),
      );
    }
  }

  const raw = buildRawOfferConfig({
    gifts: giftsFromDiscounts(discounts.data, warn, {
      free: free.data,
      products,
    }),
    ruleNodes,
    zoneNode: nodesOf(rules.data, 'zones')[0] ?? null,
    lookups: {products, collections},
    warn,
  });
  const parsed = parseOfferConfig(raw);
  return {
    status: 'ok',
    load: {...parsed, warnings: [...warnings, ...parsed.warnings]},
  };
}

type Entry = {readonly load: OfferConfigLoad; readonly expiresAt: number};

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<OfferConfigLoad>>();
/** Entries a test put in: they never expire and never need a token. */
const primed = new Set<string>();

const NONE: OfferConfigLoad = {
  status: 'none',
  config: EMPTY_OFFER_CONFIG,
  warnings: [],
};

function storeKeyOf(env: object): string | null {
  return readEnvString(env, 'PUBLIC_STORE_DOMAIN')?.toLowerCase() ?? null;
}

export type LoaderDeps = {
  readonly fetch?: FetchLike;
  readonly now?: () => number;
};

/**
 * The offer rules and delivery zone as Shopify has them now (at most a minute old). Never throws. `none` = this
 * environment has no Admin token, so there are no offers; `invalid` = Shopify could not be read and nothing good was
 * ever loaded. Callers treat both as "no offers" and the cart keeps working.
 */
export async function loadOfferConfig(
  env: object,
  deps: LoaderDeps = {},
): Promise<OfferConfigLoad> {
  const key = storeKeyOf(env);
  if (key === null) return NONE;
  const now = (deps.now ?? Date.now)();
  const cached = cache.get(key);
  if (cached !== undefined && (primed.has(key) || cached.expiresAt > now)) {
    return cached.load;
  }
  const admin = adminConfigFromEnv(env, undefined, deps.fetch);
  if (admin.status !== 'ready') return NONE;
  const running = inflight.get(key);
  if (running !== undefined) return running;

  const refresh = (async (): Promise<OfferConfigLoad> => {
    const fetched = await fetchOfferConfig(admin, deps.fetch ?? fetch);
    if (fetched.status === 'ok') {
      cache.set(key, {load: fetched.load, expiresAt: now + FRESH_MS});
      return fetched.load;
    }
    // Keep serving the last good rules while Shopify is unreachable; ask again soon.
    const last = cache.get(key)?.load;
    const load: OfferConfigLoad =
      last !== undefined && last.status === 'ok'
        ? {...last, warnings: [...last.warnings, `stale: ${fetched.reason}`]}
        : {
            status: 'invalid',
            config: EMPTY_OFFER_CONFIG,
            warnings: [fetched.reason],
          };
    cache.set(key, {load, expiresAt: now + RETRY_MS});
    return load;
  })().finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, refresh);
  return refresh;
}

/** Just the rules, for callers that need no zone and do not judge whether the configuration was readable. */
export async function offerRulesOf(env: object): Promise<OfferRules> {
  return (await loadOfferConfig(env)).config.rules;
}

/** Test hook: serve this answer for the store in `env` without any Shopify call. */
export function primeOfferConfigForTests(
  env: object,
  load: OfferConfigLoad,
): void {
  const key = storeKeyOf(env);
  if (key === null) return;
  primed.add(key);
  cache.set(key, {load, expiresAt: Number.POSITIVE_INFINITY});
}

/** Test hook: forget everything cached or primed. */
export function resetOfferConfigCacheForTests(): void {
  cache.clear();
  inflight.clear();
  primed.clear();
}
