// The `context.customerAccount` object the account routes use (ADR-0012). Hydrogen 2026.10 replaced the all-in-one
// client with a customer session (OAuth and tokens, `@shopify/hydrogen/customer-account`) and a GraphQL client that is
// handed the access token on every call. This adapter keeps the methods the account routes were written against
// (`login`, `authorize`, `logout`, `isLoggedIn`, `handleAuthStatus`, `query`, `mutate`) on top of them. The routes stay
// ours, not the library's handler group, because they add the same-origin and no-store rules of T-05, T-08 and T-11.

import {
  CustomerAccountOAuthError,
  createCustomerAccountClient,
  createCustomerSession,
  gql,
  type AnyCustomerAccountDocument,
  type CustomerAccountClient,
  type CustomerSession,
  type WritableCustomerSessionManager,
} from '@shopify/hydrogen/customer-account';
import type {ShopifyRequestContext} from '@shopify/hydrogen';
import type {
  CustomerAccountMutations,
  CustomerAccountQueries,
} from 'customer-accountapi.generated';
import {logWarn} from '~/lib/logging/logger';
import type {AppSessionLike} from '~/lib/session';
import type {ClientReturn, ClientVariablesInRestParams} from './client-types';

type GraphQLErrors = Array<{
  message: string;
  extensions?: Record<string, unknown>;
}>;

type CustomerResponse<Data> = {data: Data; errors?: GraphQLErrors};

export type LoginOptions = {
  countryCode?: string;
  acrValues?: string;
  loginHint?: string;
  loginHintMode?: string;
  locale?: string;
};

export type LogoutOptions = {
  postLogoutRedirectUri?: string;
  headers?: HeadersInit;
};

export type CustomerAccount = {
  i18n: {language: string};
  login: (options?: LoginOptions) => Promise<Response>;
  authorize: () => Promise<Response>;
  isLoggedIn: () => Promise<boolean>;
  handleAuthStatus: () => Promise<void>;
  getAccessToken: () => Promise<string | undefined>;
  logout: (options?: LogoutOptions) => Promise<Response>;
  query: <OverrideReturnType = never, RawGqlString extends string = string>(
    query: RawGqlString,
    ...options: ClientVariablesInRestParams<
      CustomerAccountQueries,
      RawGqlString
    >
  ) => Promise<
    CustomerResponse<
      ClientReturn<CustomerAccountQueries, RawGqlString, OverrideReturnType>
    >
  >;
  mutate: <OverrideReturnType = never, RawGqlString extends string = string>(
    mutation: RawGqlString,
    ...options: ClientVariablesInRestParams<
      CustomerAccountMutations,
      RawGqlString
    >
  ) => Promise<
    CustomerResponse<
      ClientReturn<CustomerAccountMutations, RawGqlString, OverrideReturnType>
    >
  >;
};

export type CustomerAccountEnv = {
  SHOP_ID?: string;
  PUBLIC_CUSTOMER_ACCOUNT_API_CLIENT_ID?: string;
};

// One session per isolate: it holds no request state, and concurrent refreshes of the same customer share work.
let cachedSession: {key: string; session: CustomerSession} | undefined;

function sessionFor(env: CustomerAccountEnv): CustomerSession | undefined {
  const shopId = env.SHOP_ID;
  const clientId = env.PUBLIC_CUSTOMER_ACCOUNT_API_CLIENT_ID;
  if (!shopId || !clientId) return undefined;
  const key = `${shopId}:${clientId}`;
  if (cachedSession?.key !== key) {
    cachedSession = {
      key,
      session: createCustomerSession({
        shopId,
        customerAccountApiClientId: clientId,
      }),
    };
  }
  return cachedSession.session;
}

/** Adapts the cookie session; it is committed once by `finishResponse` in server.ts, so there is no `commit` here. */
function sessionManagerFor(
  session: AppSessionLike,
  request: Request,
): WritableCustomerSessionManager {
  const origin = new URL(request.url).origin;
  return {
    getSessionOrigin: () => origin,
    getSessionItem: (key) => session.get(key),
    setSessionItem: (key, value) => {
      session.set(key, value);
    },
    removeSessionItem: (key) => {
      session.unset(key);
    },
  };
}

function redirect(location: string, headers?: HeadersInit): Response {
  const merged = new Headers(headers);
  merged.set('Location', location);
  return new Response(null, {status: 302, headers: merged});
}

/** The login redirect a signed-out visitor gets from any account call, as a thrown Response (the routes catch it). */
function loginRedirect(request: Request): Response {
  const url = new URL(request.url);
  const target =
    request.method === 'GET' ? `${url.pathname}${url.search}` : '/account';
  return redirect(`/account/login?return_to=${encodeURIComponent(target)}`);
}

export function createCustomerAccount(options: {
  env: CustomerAccountEnv;
  request: Request;
  session: AppSessionLike;
  requestContext: ShopifyRequestContext;
  language: string;
}): CustomerAccount {
  const {env, request, session, requestContext} = options;
  const customerSession = sessionFor(env);
  const sessionManager = sessionManagerFor(session, request);
  let client: CustomerAccountClient | undefined;

  function requireSession(): CustomerSession {
    if (!customerSession) {
      // Names only; the values are credentials-adjacent (T-04).
      throw new Error(
        'Customer accounts are not configured: set SHOP_ID and PUBLIC_CUSTOMER_ACCOUNT_API_CLIENT_ID.',
      );
    }
    return customerSession;
  }

  function accessToken(): Promise<string | undefined> {
    return requireSession().getOrRefreshAccessToken(
      sessionManager,
      requestContext,
    );
  }

  async function call(document: string, variables: unknown) {
    const token = await accessToken();
    if (!token) throw loginRedirect(request);
    client ??= createCustomerAccountClient({
      shopId: env.SHOP_ID ?? '',
      requestContext,
    });
    // The document is built from the caller's text at runtime; the result is typed by the codegen map in
    // `CustomerAccount` above, so the library's inference is bypassed here once.
    const doc: AnyCustomerAccountDocument = gql(document);
    const result = await client.graphql(doc, {
      accessToken: token,
      variables: (variables ?? undefined) as never,
    });
    return {
      data: result.data,
      ...(result.errors ? {errors: result.errors} : {}),
    };
  }

  const run = ((document: string, config?: {variables?: unknown}) =>
    call(document, config?.variables)) as unknown as CustomerAccount['query'];

  return {
    i18n: {language: options.language},
    async login(login = {}) {
      const target = new URL(request.url).searchParams.get('return_to');
      const url = await requireSession().prepareLoginUrl(
        sessionManager,
        requestContext,
        {
          returnTo: target ?? '/account',
          countryCode: login.countryCode,
          acrValues: login.acrValues,
          loginHint: login.loginHint,
          loginHintMode: login.loginHintMode,
          locale: login.locale,
        },
      );
      return redirect(url);
    },
    async authorize() {
      try {
        const path = await requireSession().handleOAuthCallback(
          sessionManager,
          requestContext,
          request,
        );
        return redirect(path);
      } catch (error) {
        if (!(error instanceof CustomerAccountOAuthError)) throw error;
        // The code names the failed check (state, nonce, issuer, expiry); never the callback parameters.
        logWarn('account.login_failed', {code: error.code});
        return redirect('/');
      }
    },
    async isLoggedIn() {
      // Read only: it never refreshes, so it is safe in a deferred loader after the response head is sent. The account
      // routes that need data refresh through `query`, where the session cookie is still committed.
      if (!customerSession) return false;
      return customerSession.isLoggedIn(sessionManager, requestContext);
    },
    async handleAuthStatus() {
      if (!(await accessToken())) throw loginRedirect(request);
    },
    getAccessToken: () => accessToken(),
    async logout(logout = {}) {
      const url = await requireSession().logout(
        sessionManager,
        requestContext,
        {
          postLogoutRedirectUri: logout.postLogoutRedirectUri,
        },
      );
      return redirect(url, logout.headers);
    },
    query: run,
    mutate: run as unknown as CustomerAccount['mutate'],
  };
}
