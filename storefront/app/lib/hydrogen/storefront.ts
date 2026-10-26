// The `context.storefront` object the loaders use (ADR-0012). Hydrogen 2026.10 replaced it with a request-scoped
// `client.graphql(document, options)` that returns `{data, errors, headers}`; this adapter keeps the call shape the
// 46 call sites were written against (`storefront.query(QUERY, {variables, cache})` returning the data object with an
// optional `errors` list, `CacheLong()` and friends, `i18n`) on top of the new client, so that the query modules,
// their codegen types and their tests did not have to change.

import {
  Cache,
  createShopifyRequestContext,
  createStorefrontClient,
  type CacheInstance,
  type CachingStrategy,
  type GraphQLFormattedError,
  type I18nConfig,
  type ShopifyRequestContext,
  type StorefrontClient,
} from '@shopify/hydrogen';
import type {
  StorefrontMutations,
  StorefrontQueries,
} from 'storefrontapi.generated';
import {logWarn} from '~/lib/logging/logger';
import type {
  AutoAddedVariableNames,
  ClientReturn,
  ClientVariablesInRestParams,
} from './client-types';

export type StorefrontApiErrors = GraphQLFormattedError[] | undefined;
export type StorefrontError = {errors?: StorefrontApiErrors};

type StorefrontCommonExtraParams = {
  headers?: HeadersInit;
  storefrontApiVersion?: string;
  displayName?: string;
};

type StorefrontQueryExtraParams = StorefrontCommonExtraParams & {
  cache?: CachingStrategy;
};

export type Storefront = {
  query: <OverrideReturnType = never, RawGqlString extends string = string>(
    query: RawGqlString,
    ...options: ClientVariablesInRestParams<
      StorefrontQueries,
      RawGqlString,
      StorefrontQueryExtraParams,
      AutoAddedVariableNames
    >
  ) => Promise<
    ClientReturn<StorefrontQueries, RawGqlString, OverrideReturnType> &
      StorefrontError
  >;
  mutate: <OverrideReturnType = never, RawGqlString extends string = string>(
    mutation: RawGqlString,
    ...options: ClientVariablesInRestParams<
      StorefrontMutations,
      RawGqlString,
      StorefrontCommonExtraParams,
      AutoAddedVariableNames
    >
  ) => Promise<
    ClientReturn<StorefrontMutations, RawGqlString, OverrideReturnType> &
      StorefrontError
  >;
  CacheNone: () => CachingStrategy;
  CacheLong: () => CachingStrategy;
  CacheShort: () => CachingStrategy;
  CacheCustom: (strategy: CachingStrategy) => CachingStrategy;
  i18n: I18nConfig;
};

/** What `StorefrontClient.graphql` accepts for a plain query string (see `loose` below). */
type LooseGraphql = (
  document: string,
  options?: {
    variables?: Record<string, unknown>;
    cache?: CachingStrategy;
    signal?: AbortSignal;
  },
) => Promise<{
  data: Record<string, unknown> | null;
  errors?: GraphQLFormattedError[];
  headers: Headers;
}>;

type CallOptions = {
  variables?: Record<string, unknown>;
  cache?: CachingStrategy;
};

/**
 * The library types a plain string through gql.tada, which cannot read a query built at runtime and rejects the
 * generated-type lookup this project uses. The client accepts any string at runtime, so the call is typed once here,
 * and the results are typed by the codegen map in `Storefront` above.
 */
function loose(client: StorefrontClient): LooseGraphql {
  return client.graphql as unknown as LooseGraphql;
}

/**
 * Wraps a request-scoped client. A query without an explicit strategy gets the short one, as `storefront.query` always
 * did; mutations are never cached. A GraphQL error list is returned on the result (the old behaviour) and logged as a
 * count only: the library's own message can carry the query text and variables (T-05).
 */
export function createStorefront(client: StorefrontClient): Storefront {
  const graphql = loose(client);

  async function run(
    document: string,
    options: CallOptions | undefined,
    cacheable: boolean,
  ) {
    const result = await graphql(document, {
      variables: options?.variables,
      ...(cacheable ? {cache: options?.cache ?? Cache.short()} : {}),
    });
    if (result.errors?.length) {
      logWarn('storefront.graphql_errors', {count: result.errors.length});
    }
    return {...result.data, ...(result.errors ? {errors: result.errors} : {})};
  }

  // The generic signature of `Storefront.query` cannot be satisfied by a function body; the casts below are the one
  // place where the codegen-keyed typing meets the untyped transport.
  const query = ((document: string, options?: CallOptions) =>
    run(document, options, true)) as unknown as Storefront['query'];
  const mutate = ((document: string, options?: CallOptions) =>
    run(document, options, false)) as unknown as Storefront['mutate'];

  return {
    query,
    mutate,
    CacheNone: () => Cache.none(),
    CacheLong: () => Cache.long(),
    CacheShort: () => Cache.short(),
    CacheCustom: (strategy) => strategy,
    i18n: client.requestContext.i18n,
  };
}

export type StorefrontEnv = {
  PUBLIC_STORE_DOMAIN?: string;
  PUBLIC_STOREFRONT_ID?: string;
  PUBLIC_STOREFRONT_API_TOKEN?: string;
  PRIVATE_STOREFRONT_API_TOKEN?: string;
};

export const APP_I18N = {language: 'EN', country: 'US'} as const;

/**
 * The shopper's address as the own server sets it (`x-real-ip`, from the socket or the trusted proxy) or Oxygen
 * (`oxygen-buyer-ip`). The adapter in scripts/node-server removes every other address header, so neither name can be
 * chosen by the client on this host.
 */
function buyerIpOf(headers: Headers): string | undefined {
  for (const name of ['oxygen-buyer-ip', 'x-real-ip']) {
    const value = headers.get(name)?.split(',')[0]?.trim();
    if (value) return value;
  }
  return undefined;
}

export type StorefrontServices = {
  client: StorefrontClient;
  requestContext: ShopifyRequestContext;
  storefront: Storefront;
};

/**
 * One client per request. With a private token the buyer's address goes along when the host knows it; without it the
 * private client without buyer context is used (the old behaviour sent the token with an empty address). With no
 * private token the public client is used, with the public token when there is one.
 */
export function createStorefrontServices(options: {
  request: Request;
  env: StorefrontEnv;
  cache?: CacheInstance;
  waitUntil?: (promise: Promise<unknown>) => void;
}): StorefrontServices {
  const {request, env, cache, waitUntil} = options;
  const storeDomain = env.PUBLIC_STORE_DOMAIN;
  if (!storeDomain) throw new Error('PUBLIC_STORE_DOMAIN is not set.');
  const common = {
    storeDomain,
    storefrontId: env.PUBLIC_STOREFRONT_ID,
    cache,
    waitUntil,
  };

  let client: StorefrontClient;
  if (env.PRIVATE_STOREFRONT_API_TOKEN) {
    const buyerIp = buyerIpOf(request.headers);
    client = buyerIp
      ? createStorefrontClient({
          type: 'private',
          requestContext: createShopifyRequestContext({
            request,
            i18n: APP_I18N,
            buyerIp,
          }),
          config: {
            ...common,
            privateStorefrontToken: env.PRIVATE_STOREFRONT_API_TOKEN,
          },
        })
      : createStorefrontClient({
          type: 'private_no_buyer_context',
          requestContext: createShopifyRequestContext({
            request,
            i18n: APP_I18N,
          }),
          config: {
            ...common,
            privateStorefrontToken: env.PRIVATE_STOREFRONT_API_TOKEN,
          },
        });
  } else {
    client = createStorefrontClient({
      type: 'public',
      requestContext: createShopifyRequestContext({request, i18n: APP_I18N}),
      config: {
        ...common,
        publicStorefrontToken: env.PUBLIC_STOREFRONT_API_TOKEN || undefined,
      },
    });
  }
  return {
    client,
    requestContext: client.requestContext,
    storefront: createStorefront(client),
  };
}
