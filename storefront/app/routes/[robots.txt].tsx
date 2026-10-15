import type {Route} from './+types/[robots.txt]';
import {MANAGED_FILTER_PARAMS} from '~/lib/filters';
import {buildRobotsTxt} from '~/lib/seo/robots';
import {bareUrlRedirect} from '~/lib/seo/sitemap';
import {applySecurityHeaders} from '~/lib/security-headers';
import {resolveSiteOrigin} from '~/lib/site-origin';

export function loader({request, context}: Route.LoaderArgs) {
  // A query string must not make a new cache entry (K-L9).
  const bare = bareUrlRedirect(request);
  if (bare) return bare;
  // The sitemap URL comes from PUBLIC_SITE_URL, not the Host header a caller chooses (O-L10). Without it
  // (outside development) the Sitemap line is left out.
  const origin = resolveSiteOrigin({
    env: context.env,
    requestUrl: request.url,
    isDev: import.meta.env.DEV,
  });
  const body = buildRobotsTxt({origin, facetParams: MANAGED_FILTER_PARAMS});

  const headers = new Headers({
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': `public, max-age=${60 * 60 * 24}`,
  });
  // Resource routes do not pass through entry.server.
  applySecurityHeaders(headers, {
    requestUrl: request.url,
    forwardedProto: request.headers.get('x-forwarded-proto'),
  });
  return new Response(body, {status: 200, headers});
}
