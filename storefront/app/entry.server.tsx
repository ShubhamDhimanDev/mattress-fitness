import {ServerRouter} from 'react-router';
import {isbot} from 'isbot';
import {renderToReadableStream} from 'react-dom/server';
import {
  createContentSecurityPolicy,
  type HydrogenRouterContextProvider,
} from '@shopify/hydrogen';
import type {EntryContext} from 'react-router';
import {errorFields, logError} from '~/lib/logging/logger';
import {
  applySecurityHeaders,
  buildReportOnlyCsp,
  withSecurityHeaders,
} from '~/lib/security-headers';
import {canonicalLinkHeader, canonicalUrl} from '~/lib/seo/canonical';
import {resolveSiteOrigin} from '~/lib/site-origin';

/** The request facts the host-independent header helpers need (the proxy's protocol decides HSTS, P-L5). */
function headerInput(request: Request) {
  return {
    requestUrl: request.url,
    forwardedProto: request.headers.get('x-forwarded-proto'),
  };
}

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  reactRouterContext: EntryContext,
  context: HydrogenRouterContextProvider,
) {
  const {nonce, header, NonceProvider} = createContentSecurityPolicy({
    shop: {
      checkoutDomain: context.env.PUBLIC_CHECKOUT_DOMAIN,
      storeDomain: context.env.PUBLIC_STORE_DOMAIN,
    },
  });

  const body = await renderToReadableStream(
    <NonceProvider>
      <ServerRouter
        context={reactRouterContext}
        url={request.url}
        nonce={nonce}
      />
    </NonceProvider>,
    {
      nonce,
      signal: request.signal,
      onError(error) {
        // The class name only: a render error can quote request data (T-05).
        logError('render.failed', errorFields(error));
        responseStatusCode = 500;
      },
    },
  );

  if (isbot(request.headers.get('user-agent'))) {
    await body.allReady;
  }

  responseHeaders.set('Content-Type', 'text/html; charset=utf-8');
  // Hydrogen's nonce policy stays the enforced one (T-07). The stricter variant is report-only until its
  // violations have been reviewed on a real host (docs/security/SECURITY_HEADERS.md).
  responseHeaders.set('Content-Security-Policy', header);
  const reportOnly = buildReportOnlyCsp({
    nonce,
    storeDomain: context.env.PUBLIC_STORE_DOMAIN,
    checkoutDomain: context.env.PUBLIC_CHECKOUT_DOMAIN,
    development: import.meta.env.DEV,
  });
  if (reportOnly) {
    responseHeaders.set('Content-Security-Policy-Report-Only', reportOnly);
  }
  applySecurityHeaders(responseHeaders, headerInput(request));

  // The canonical URL as a Link header too, so every indexable page has one without each route repeating it
  // (REQ-SEO-001). The origin is the configured one, never the request's Host (P-L2).
  if (request.method === 'GET' && responseStatusCode === 200) {
    const canonical = canonicalUrl(
      resolveSiteOrigin({
        env: context.env,
        requestUrl: request.url,
        isDev: import.meta.env.DEV,
      }),
      new URL(request.url).pathname,
    );
    if (canonical) {
      responseHeaders.append('Link', canonicalLinkHeader(canonical));
    }
  }

  return new Response(body, {
    headers: responseHeaders,
    status: responseStatusCode,
  });
}

/**
 * Data requests (the `.data` fetches that client navigations make) do not pass through `handleRequest`. `server.ts`
 * already applies the host-independent headers to every response; this repeats it (idempotent, and safe for an
 * immutable response) so a server entry that is not `server.ts` (Q-003) still covers them. No CSP: not a document.
 */
export function handleDataRequest(
  response: Response,
  {request}: {request: Request},
) {
  return withSecurityHeaders(response, headerInput(request));
}
