import {RouterContextProvider} from 'react-router';
import type {StorefrontClient, ShopifyRequestContext} from '@shopify/hydrogen';
import {cartSetId} from '~/lib/cart/cookie';
import {reportUnusableSecret, sessionSecretProblem} from '~/lib/cookie-secret';
import {AppSession} from '~/lib/session';
import {CART_QUERY_FRAGMENT} from '~/lib/fragments';
import {createCartHandler, type CartHandler} from '~/lib/hydrogen/cart-handler';
import {
  createCustomerAccount,
  type CustomerAccount,
} from '~/lib/hydrogen/customer-account';
import {
  APP_I18N,
  createStorefrontServices,
  type Storefront,
} from '~/lib/hydrogen/storefront';

/** The request services every loader and action reads from `context` (ADR-0012). */
export type AppContext = {
  env: Env;
  waitUntil: ExecutionContext['waitUntil'];
  storefront: Storefront;
  cart: CartHandler;
  customerAccount: CustomerAccount;
  session: AppSession;
};

declare module 'react-router' {
  interface AppLoadContext extends AppContext {}
  interface RouterContextProvider extends AppContext {}
}

export type RequestServices = {
  /** The object the router hands to loaders and actions. */
  routerContext: RouterContextProvider;
  /** For the Shopify route handlers and the response headers in server.ts. */
  client: StorefrontClient;
  requestContext: ShopifyRequestContext;
  session: AppSession;
};

/**
 * Builds the per-request services. The names `storefront`, `cart`, `customerAccount`, `session`, `env` and `waitUntil`
 * on the context are the ones the routes were written against with Hydrogen 2026.4's `createHydrogenContext`; the
 * implementations are ours (app/lib/hydrogen) on top of the 2026.10 library.
 */
export async function createHydrogenRouterContext(
  request: Request,
  env: Env,
  executionContext: ExecutionContext,
): Promise<RequestServices> {
  // A missing or short signing key is a deployment mistake (E-L1): production refuses every request until it
  // is fixed. The name is logged once per isolate so the cause is visible without a line per request.
  const secretProblem = sessionSecretProblem(
    env?.SESSION_SECRET,
    import.meta.env.PROD,
  );
  if (secretProblem !== null) {
    reportUnusableSecret('SESSION_SECRET');
    throw new Error(secretProblem);
  }

  const waitUntil = executionContext.waitUntil.bind(executionContext);
  const [cache, session] = await Promise.all([
    caches.open('hydrogen'),
    AppSession.init(request, [env.SESSION_SECRET]),
  ]);

  const {client, requestContext, storefront} = createStorefrontServices({
    request,
    env,
    cache,
    waitUntil,
  });

  const customerAccount = createCustomerAccount({
    env,
    request,
    session,
    requestContext,
    language: APP_I18N.language,
  });

  const cart = createCartHandler({
    storefront,
    cookieHeader: request.headers.get('Cookie'),
    // HttpOnly, SameSite, Secure and an expiry on the cart cookie (security review P-M1).
    setCartId: cartSetId(request.url),
    cartQueryFragment: CART_QUERY_FRAGMENT,
    isLoggedIn: () => customerAccount.isLoggedIn(),
  });

  const routerContext = new RouterContextProvider();
  Object.assign(routerContext, {
    env,
    waitUntil,
    storefront,
    cart,
    customerAccount,
    session,
  } satisfies AppContext);

  return {routerContext, client, requestContext, session};
}
