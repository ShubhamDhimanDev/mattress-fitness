// Sitemap index and sitemap pages built from Shopify's `sitemap` Storefront API field. Ported from @shopify/hydrogen
// 2026.4.7 (MIT), which dropped `getSitemap` and `getSitemapIndex` in 2026.10 (ADR-0012). The output is unchanged.

import type {Storefront} from './storefront';

export type SitemapType =
  'products' | 'pages' | 'collections' | 'metaObjects' | 'articles' | 'blogs';

const INDEX_PREFIX = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
`;
const INDEX_SUFFIX = `
</sitemapindex>`;
const PREFIX = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">`;
const SUFFIX = `</urlset>`;

const XML_HEADERS = {
  'Content-Type': 'application/xml',
  'Cache-Control': `max-age=${60 * 60 * 24}`,
};

const pageQuery = (name: string, type: string, extra = '') => `#graphql
  query Sitemap${name}($page: Int!) {
    sitemap(type: ${type}) {
      resources(page: $page) {
        items {
          handle
          updatedAt${extra}
        }
      }
    }
  }
`;

const QUERIES: Record<SitemapType, string> = {
  products: pageQuery('Products', 'PRODUCT'),
  articles: pageQuery('Articles', 'ARTICLE'),
  collections: pageQuery('Collections', 'COLLECTION'),
  pages: pageQuery('Pages', 'PAGE'),
  blogs: pageQuery('Blogs', 'BLOG'),
  metaObjects: pageQuery(
    'Metaobjects',
    'METAOBJECT',
    `
          ... on SitemapResourceMetaobject {
            type
          }`,
  ),
};

const INDEX_QUERY = `#graphql
  query SitemapIndex {
    products: sitemap(type: PRODUCT) { pagesCount { count } }
    collections: sitemap(type: COLLECTION) { pagesCount { count } }
    articles: sitemap(type: ARTICLE) { pagesCount { count } }
    pages: sitemap(type: PAGE) { pagesCount { count } }
    blogs: sitemap(type: BLOG) { pagesCount { count } }
    metaObjects: sitemap(type: METAOBJECT) { pagesCount { count } }
  }
`;

type Untyped = (
  document: string,
  options?: {variables?: Record<string, unknown>},
) => Promise<Record<string, unknown>>;

export async function getSitemapIndex(options: {
  storefront: Storefront;
  request: Request;
  types?: SitemapType[];
  customChildSitemaps?: string[];
}): Promise<Response> {
  const {
    storefront,
    request,
    types = [
      'products',
      'pages',
      'collections',
      'metaObjects',
      'articles',
      'blogs',
    ],
    customChildSitemaps = [],
  } = options;
  const query = storefront.query as unknown as Untyped;
  const data = (await query(INDEX_QUERY)) as Partial<
    Record<SitemapType, {pagesCount: {count: number}} | null>
  >;
  const baseUrl = new URL(request.url).origin;
  const children = types
    .map((type) => {
      const entry = data[type];
      if (!entry) throw new Error(`No sitemap data for type ${type}.`);
      let links = '';
      for (let page = 1; page <= entry.pagesCount.count; page++) {
        links += `  <sitemap><loc>${baseUrl}/sitemap/${type}/${page}.xml</loc></sitemap>\n`;
      }
      return links;
    })
    .join('\n');
  const custom = customChildSitemaps
    .map(
      (url) =>
        `  <sitemap><loc>${baseUrl}${url.startsWith('/') ? url : `/${url}`}</loc></sitemap>`,
    )
    .join('\n');
  return new Response(INDEX_PREFIX + children + custom + INDEX_SUFFIX, {
    headers: XML_HEADERS,
  });
}

type SitemapItem = {handle: string; updatedAt: string; type?: string};

export async function getSitemap(options: {
  storefront: Storefront;
  request: Request;
  params: {type?: string; page?: string};
  getLink: (input: {type: string; baseUrl: string; handle?: string}) => string;
  noItemsFallback?: string;
}): Promise<Response> {
  const {storefront, request, params, getLink, noItemsFallback = '/'} = options;
  if (!params.type || !params.page) {
    throw new Response('No data found', {status: 404});
  }
  const type = params.type as SitemapType;
  const document = QUERIES[type];
  if (!document) throw new Response('Not found', {status: 404});
  const query = storefront.query as unknown as Untyped;
  const data = (await query(document, {
    variables: {page: Number.parseInt(params.page, 10)},
  })) as {sitemap?: {resources?: {items?: SitemapItem[]}}};

  const baseUrl = new URL(request.url).origin;
  const items = data.sitemap?.resources?.items ?? [];
  const body = items.length
    ? PREFIX +
      items
        .map((item) =>
          `<url>
  <loc>${getLink({type: item.type ?? type, baseUrl, handle: item.handle})}</loc>
  <lastmod>${item.updatedAt}</lastmod>
  <changefreq>weekly</changefreq>
</url>`.trim(),
        )
        .join('\n') +
      SUFFIX
    : `${PREFIX}\n  <url><loc>${baseUrl + noItemsFallback}</loc></url>\n${SUFFIX}`;
  return new Response(body, {headers: XML_HEADERS});
}
