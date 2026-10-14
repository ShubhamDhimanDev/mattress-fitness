import {createHydrogenContext} from '@shopify/hydrogen';
import {cartSetId} from '~/lib/cart/cookie';
import {reportUnusableSecret, sessionSecretProblem} from '~/lib/cookie-secret';
import {AppSession} from '~/lib/session';
import {CART_QUERY_FRAGMENT} from '~/lib/fragments';
import type {CartApiQueryFragment} from 'storefrontapi.generated';

// Define the additional context object
const additionalContext = {
  // Additional context for custom properties, CMS clients, 3P SDKs, etc.
  // These will be available as both context.propertyName and context.get(propertyContext)
  // Example of complex objects that could be added:
  // cms: await createCMSClient(env),
  // reviews: await createReviewsClient(env),
} as const;

// Automatically augment HydrogenAdditionalContext with the additional context type
type AdditionalContextType = typeof additionalContext;

declare global {
  interface HydrogenAdditionalContext extends AdditionalContextType {}

  // Augment HydrogenCustomCartFragment with the codegen'd cart fragment type so
  // that context.cart.get() and all cart mutations return the extended cart type.
  interface HydrogenCustomCartFragment extends CartApiQueryFragment {}
}

/**
 * Creates Hydrogen context for React Router 7.9.x
 * Returns HydrogenRouterContextProvider with hybrid access patterns
 * */
export async function createHydrogenRouterContext(
  request: Request,
  env: Env,
  executionContext: ExecutionContext,
) {
  /**
   * Open a cache instance in the worker and a custom session instance.
   */
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

  const hydrogenContext = createHydrogenContext(
    {
      env,
      request,
      cache,
      waitUntil,
      session,
      // Or detect from URL path based on locale subpath, cookies, or any other strategy
      i18n: {language: 'EN', country: 'US'},
      cart: {
        queryFragment: CART_QUERY_FRAGMENT,
        // HttpOnly, SameSite, Secure and an expiry on the cart cookie (security review P-M1).
        setId: cartSetId(request.url),
      },
    },
    additionalContext,
  );

  return hydrogenContext;
}
