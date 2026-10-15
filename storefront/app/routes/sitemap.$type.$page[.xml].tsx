import type {Route} from './+types/sitemap.$type.$page[.xml]';
import {getSitemap} from '@shopify/hydrogen';
import {loadOfferOnlyHandles} from '~/lib/shopify/offer-only';
import {
  EMPTY_SITEMAP_MARKER,
  bareUrlRedirect,
  dropProductEntries,
  isEmptySitemapBody,
  isSitemapType,
  parseSitemapPage,
  sitemapLink,
} from '~/lib/seo/sitemap';
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
  // A query string must not make a new cache entry that reaches Shopify again (K-L9).
  const bare = bareUrlRedirect(request);
  if (bare) return bare;
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
    // Hydrogen writes this URL when a page has no items; the marker lets us answer 404 instead (K-L9).
    noItemsFallback: EMPTY_SITEMAP_MARKER,
    getLink: ({type, baseUrl, handle}) =>
      // An unusable handle becomes the site root rather than a broken or injected URL.
      sitemapLink(type, baseUrl, handle ?? '') ?? `${baseUrl}/`,
  });
  let xml = await response.text();
  if (isEmptySitemapBody(xml)) {
    throw new Response('Not found', {status: 404});
  }
  // Offer-only products (Extend price points, services, gifts, protectors) are not content (K-L3).
  if (params.type === 'products') {
    xml = dropProductEntries(xml, await loadOfferOnlyHandles(storefront));
  }
  return sitemapResponse(new Response(xml, response), request);
}
