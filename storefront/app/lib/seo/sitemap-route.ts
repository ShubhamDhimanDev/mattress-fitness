// Shared by the sitemap routes (P7-04): the configured origin, and the headers every sitemap answer carries.

import {applySecurityHeaders} from '~/lib/security-headers';
import {resolveSiteOrigin} from '~/lib/site-origin';

type SiteEnv = Parameters<typeof resolveSiteOrigin>[0]['env'];

/** The configured site origin (PUBLIC_SITE_URL), or the request's in development only; never a forged Host (P-L2). */
export function sitemapOriginFor(
  env: SiteEnv,
  request: Request,
): string | null {
  return resolveSiteOrigin({
    env,
    requestUrl: request.url,
    isDev: import.meta.env.DEV,
  });
}

/**
 * Without a configured origin there is no valid absolute URL to list. 404 rather than a sitemap of relative
 * links: search engines ignore a missing sitemap but may act on a wrong one.
 */
export function sitemapUnavailable(): Response {
  return new Response('Sitemap not available', {status: 404});
}

/**
 * A day of caching is the existing behaviour. Resource routes do not pass through entry.server, so the
 * host-independent security headers are applied here too (they matter for `nosniff` on an XML answer).
 */
export function sitemapResponse(
  response: Response,
  request: Request,
): Response {
  const headers = new Headers(response.headers);
  headers.set('Content-Type', 'application/xml; charset=utf-8');
  headers.set('Cache-Control', 'public, max-age=86400');
  applySecurityHeaders(headers, {
    requestUrl: request.url,
    forwardedProto: request.headers.get('x-forwarded-proto'),
  });
  return new Response(response.body, {status: response.status, headers});
}
