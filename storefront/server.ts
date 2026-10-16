import * as serverBuild from 'virtual:react-router/server-build';
import {createRequestHandler, storefrontRedirect} from '@shopify/hydrogen';
import {createHydrogenRouterContext} from '~/lib/context';
import {errorFields, logError} from '~/lib/logging/logger';
import {
  withSecurityHeaders,
  type SecurityHeaderInput,
} from '~/lib/security-headers';
import {finishResponse} from '~/lib/server-safety';

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
    const hydrogenContext = await createHydrogenRouterContext(
      request,
      env,
      executionContext,
    );

    /**
     * Create a Hydrogen request handler that internally
     * delegates to React Router for routing and rendering.
     */
    const handleRequest = createRequestHandler({
      build: serverBuild,
      mode: process.env.NODE_ENV,
      getLoadContext: () => hydrogenContext,
    });

    // Security headers first, then the session cookie: a response with immutable headers (a redirect or a fetched
    // response) is copied before the cookie is appended, so a pending session cannot throw (server-safety.ts).
    const response = await finishResponse(
      await handleRequest(request),
      hydrogenContext.session,
      securityHeaderInput(request),
    );

    if (response.status === 404) {
      /**
       * Check for redirects only when there's a 404 from the app.
       * If the redirect doesn't exist, then `storefrontRedirect`
       * will pass through the 404 response.
       */
      return await storefrontRedirect({
        request,
        response,
        storefront: hydrogenContext.storefront,
      });
    }

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
