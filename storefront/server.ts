import * as serverBuild from 'virtual:react-router/server-build';
import {createRequestHandler} from 'react-router';
import {
  createShopifyRouteTemplates,
  handleShopifyRedirects,
  handleShopifyRoutes,
} from '@shopify/hydrogen';
import {createHydrogenRouterContext} from '~/lib/context';
import {errorFields, logError} from '~/lib/logging/logger';
import {
  withSecurityHeaders,
  type SecurityHeaderInput,
} from '~/lib/security-headers';
import {finishResponse} from '~/lib/server-safety';

// Standard Shopify paths only: the app serves /products, /collections, /pages, /policies, /blogs, /cart and /search at the
// same paths Shopify uses, so there is nothing to map (ADR-0012).
const routeTemplates = createShopifyRouteTemplates({});

/**
 * Which paths Hydrogen's own route handler may answer. Everything else in `handleShopifyRoutes` would take over a page
 * this project owns: `/checkout` and `/cart/<variant>:<qty>` would hand the cart to Shopify without the offer gate
 * (ADR-0003, REQ-PRE-006, `/checkout-steps` and `cart.$lines` own those), and the `/account/*` paths would be sent to the
 * store's own login. What remains is the same-origin Storefront API proxy that Shopify's analytics script posts through
 * (it carries the session and consent cookies) and the `/__shopify` helper path (ADR-0012).
 */
const SHOPIFY_OWNED_PATHS = [
  /^\/api\/(?:unstable|2\d{3}-\d{2})\/graphql\.json$/,
  /^\/__shopify(?:\/|$)/,
];

function isShopifyOwnedPath(request: Request): boolean {
  const {pathname} = new URL(request.url);
  return SHOPIFY_OWNED_PATHS.some((pattern) => pattern.test(pathname));
}

function securityHeaderInput(request: Request): SecurityHeaderInput {
  return {
    requestUrl: request.url,
    forwardedProto: request.headers.get('X-Forwarded-Proto'),
  };
}

async function respond(
  request: Request,
  env: Env,
  executionContext: ExecutionContext,
): Promise<Response> {
  try {
    // Same guards the 2026.4 request handler applied before routing.
    if (
      (request.method === 'GET' || request.method === 'HEAD') &&
      request.body
    ) {
      return new Response(`${request.method} requests cannot have a body`, {
        status: 400,
      });
    }
    const url = new URL(request.url);
    if (url.pathname.includes('//')) {
      return new Response(null, {
        status: 301,
        headers: {location: url.pathname.replace(/\/+/g, '/') + url.search},
      });
    }

    const {routerContext, client, requestContext, session} =
      await createHydrogenRouterContext(request, env, executionContext);

    if (isShopifyOwnedPath(request)) {
      const shopifyRoute = handleShopifyRoutes({
        request,
        requestContext,
        storefrontClient: client,
        routeTemplates,
      });
      // `return await`: a rejection must reach the catch below, not escape the handler.
      if (shopifyRoute) return await shopifyRoute;
    }

    const handleRequest = createRequestHandler(
      serverBuild,
      process.env.NODE_ENV,
    );

    // Security headers first, then the session cookie: a response with immutable headers (a redirect or a fetched
    // response) is copied before the cookie is appended, so a pending session cannot throw (server-safety.ts).
    const response = await finishResponse(
      await handleRequest(request, routerContext),
      session,
      securityHeaderInput(request),
    );

    if (response.status === 404) {
      /**
       * Check for redirects only when there's a 404 from the app: Shopify's URL redirects and `/admin`. When none
       * applies the 404 passes through unchanged.
       */
      const redirect = await handleShopifyRedirects({
        request,
        storefrontClient: client,
        routeTemplates,
      });
      if (redirect) return redirect;
    }

    // Shopify's tracking cookies from the Storefront calls of this request, and the private cache-control of a
    // personalised answer. Without this call those headers vanish.
    requestContext.applyResponseHeaders(response.headers);
    return response;
  } catch (error) {
    // The error name and the path only: a message or cause can hold the query, variables and a cart id with its
    // key, and a query string can carry search text (N-L4, T-05).
    logError('request.unhandled', {
      ...errorFields(error),
      path: new URL(request.url).pathname,
    });
    return new Response('An unexpected error occurred', {status: 500});
  }
}

/**
 * Export a fetch handler in module format.
 */
export default {
  async fetch(
    request: Request,
    env: Env,
    executionContext: ExecutionContext,
  ): Promise<Response> {
    const response = await respond(request, env, executionContext);
    // The single exit for every response: documents, resource routes (/api/*, /webhooks/*, cart JSON), redirects from
    // `storefrontRedirect` and the error response above all get the host-independent security headers here
    // (P-L6). A server entry other than this one (an own-server deployment, Q-003) must make the same call.
    return withSecurityHeaders(response, securityHeaderInput(request));
  },
};
