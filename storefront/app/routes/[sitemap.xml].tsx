import type {Route} from './+types/[sitemap.xml]';
import {getSitemapIndex} from '~/lib/hydrogen/sitemap';
import {SITEMAP_TYPES, bareUrlRedirect} from '~/lib/seo/sitemap';
import {
  sitemapOriginFor,
  sitemapResponse,
  sitemapUnavailable,
} from '~/lib/seo/sitemap-route';

// The sitemap index (P7-04, REQ-SEO-001): Shopify's resource sitemaps plus our own `/sitemap/extras.xml`.
export async function loader({
  request,
  context: {storefront, env},
}: Route.LoaderArgs) {
  const bare = bareUrlRedirect(request);
  if (bare) return bare;
  const origin = sitemapOriginFor(env, request);
  if (origin === null) return sitemapUnavailable();

  const response = await getSitemapIndex({
    storefront,
    // Hydrogen builds every link from the request's origin; handing it a request on the configured origin keeps a
    // forged Host header out of the sitemap (P-L2).
    request: new Request(`${origin}/sitemap.xml`),
    types: [...SITEMAP_TYPES],
    customChildSitemaps: ['/sitemap/extras.xml'],
  });
  return sitemapResponse(response, request);
}
