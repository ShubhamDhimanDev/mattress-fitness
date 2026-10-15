import type {Route} from './+types/sitemap.$type.$page[.xml]';
import {getSitemap} from '@shopify/hydrogen';
import {isSitemapType, parseSitemapPage, sitemapLink} from '~/lib/seo/sitemap';
import {
  sitemapOriginFor,
  sitemapResponse,
  sitemapUnavailable,
} from '~/lib/seo/sitemap-route';

// One page of one Shopify resource type (P7-04). US English only (NFR-008): no locale alternates.
export async function loader({
  request,
  params,
  context: {storefront, env},
}: Route.LoaderArgs) {
  // Validate before Hydrogen sees it: an unknown type must be a 404, not a lookup on its internal table.
  const page = parseSitemapPage(params.page);
  if (!isSitemapType(params.type) || page === null) {
    throw new Response('Not found', {status: 404});
  }
  const origin = sitemapOriginFor(env, request);
  if (origin === null) return sitemapUnavailable();

  const response = await getSitemap({
    storefront,
    request: new Request(`${origin}/sitemap/${params.type}/${page}.xml`),
    params: {type: params.type, page: String(page)},
    getLink: ({type, baseUrl, handle}) =>
      // An unusable handle becomes the site root rather than a broken or injected URL.
      sitemapLink(type, baseUrl, handle ?? '') ?? `${baseUrl}/`,
  });
  return sitemapResponse(response, request);
}
