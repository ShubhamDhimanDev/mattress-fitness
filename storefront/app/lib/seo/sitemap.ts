// Sitemap building blocks (P7-04, REQ-SEO-001). Pure, so the URL rules are unit-tested.
//
// Shopify's own `sitemap` Storefront API resources list products, collections, pages, blogs and articles
// (Hydrogen's getSitemap pages through them). What Shopify cannot know about is added here: the home page, the
// collection index, brand pages and store pages, and only when they are backed by real data. Fixture-backed pages
// are noindex (previewRobotsMeta) and must not be advertised, so they are never listed.

import {isIndexablePath} from '~/lib/seo/canonical';

/** The resource types the sitemap index lists. Metaobjects are left out: they have no page of their own. */
export const SITEMAP_TYPES = [
  'products',
  'collections',
  'pages',
  'blogs',
  'articles',
] as const;
export type SitemapType = (typeof SITEMAP_TYPES)[number];

export function isSitemapType(value: unknown): value is SitemapType {
  return SITEMAP_TYPES.some((type) => type === value);
}

/** The most pages one resource type can have: 400 products at 250 per page is two; this is a hard cap. */
const MAX_SITEMAP_PAGE = 100;

/** A positive whole number up to the cap, as written in the URL; anything else is not a page. */
export function parseSitemapPage(raw: string | undefined): number | null {
  if (raw === undefined || !/^[1-9]\d{0,2}$/.test(raw)) return null;
  const page = Number(raw);
  return page <= MAX_SITEMAP_PAGE ? page : null;
}

// Shopify handles are lower-case letters, digits and hyphens (non-Latin shops may differ), so a handle is
// accepted as any run of characters that cannot break a path or the XML around it.
const SAFE_SEGMENT = /^[^\s/\\?#%<>&"']{1,255}$/u;
// Control characters are what `\s` leaves behind; checked by code point so the pattern stays lint-clean.
const hasControlCharacter = (text: string): boolean =>
  [...text].some((char) => (char.codePointAt(0) ?? 0) < 0x20);
// A path only: a leading slash, no query, no fragment, no whitespace.
const PLAIN_PATH = /^\/[^?#\s]*$/;

function encodeSegments(handle: string): string | null {
  const segments = handle.split('/');
  // "." and ".." would be resolved away by a browser or crawler, so they are never a handle.
  if (
    segments.some(
      (segment) =>
        segment === '.' ||
        segment === '..' ||
        hasControlCharacter(segment) ||
        !SAFE_SEGMENT.test(segment),
    )
  ) {
    return null;
  }
  return segments.map((segment) => encodeURIComponent(segment)).join('/');
}

/**
 * The absolute URL of a Shopify sitemap resource, or null when the handle is unusable (the entry is then
 * dropped rather than emitted broken). Article handles arrive as `blog-handle/article-handle`, which is the
 * shape the `/blogs/:blog/:article` route has.
 */
export function sitemapLink(
  type: string,
  origin: string,
  handle: string,
): string | null {
  const path = encodeSegments(handle);
  if (path === null) return null;
  switch (type) {
    case 'products':
      return `${origin}/products/${path}`;
    case 'collections':
      return `${origin}/collections/${path}`;
    case 'pages':
      return `${origin}/pages/${path}`;
    case 'blogs':
    case 'articles':
      return `${origin}/blogs/${path}`;
    default:
      return null;
  }
}

export type SitemapEntry = {
  readonly loc: string;
  readonly lastmod?: string;
};

/** Escapes the five XML special characters in element text. */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** The protocol limit for one sitemap file. */
export const MAX_URLS_PER_SITEMAP = 50_000;

const URLSET_OPEN =
  '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';

export function renderUrlset(entries: readonly SitemapEntry[]): string {
  const urls = entries.slice(0, MAX_URLS_PER_SITEMAP).map((entry) => {
    const lastmod = entry.lastmod
      ? `<lastmod>${escapeXml(entry.lastmod)}</lastmod>`
      : '';
    return `  <url><loc>${escapeXml(entry.loc)}</loc>${lastmod}</url>`;
  });
  return `${URLSET_OPEN}\n${urls.join('\n')}\n</urlset>\n`;
}

export function renderSitemapIndex(locs: readonly string[]): string {
  const items = locs.map(
    (loc) => `  <sitemap><loc>${escapeXml(loc)}</loc></sitemap>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items.join('\n')}\n</sitemapindex>\n`;
}

export type ExtraSitemapInput = {
  readonly origin: string;
  /** Brand page paths, only from real `brand` metaobjects (never the sample brands). */
  readonly brandPaths: readonly string[];
  /** Policy page paths (`/policies/<handle>`), only for policies the shop has written (shop-policies.ts). */
  readonly policyPaths?: readonly string[];
};

/**
 * The pages Shopify's sitemap does not list. The home page and the collection index are static; brands are listed only when the caller found real data, and shop policies only when they exist. Every path is checked against the same indexable
 * rule as the canonical link, and duplicates are removed.
 */
export function extraSitemapEntries(input: ExtraSitemapInput): SitemapEntry[] {
  const fixed = ['/', '/collections'];
  const brandIndex = input.brandPaths.length > 0 ? ['/brands'] : [];
  const paths = [
    ...fixed,
    ...brandIndex,
    ...input.brandPaths,
    ...(input.policyPaths ?? []),
  ];
  const seen = new Set<string>();
  const entries: SitemapEntry[] = [];
  for (const path of paths) {
    // Paths only: no query or fragment, and nothing the indexable rule refuses.
    if (!PLAIN_PATH.test(path) || !isIndexablePath(path) || seen.has(path)) {
      continue;
    }
    seen.add(path);
    entries.push({
      loc: path === '/' ? `${input.origin}/` : `${input.origin}${path}`,
    });
  }
  return entries;
}

/**
 * The path Hydrogen's `getSitemap` falls back to when a page has no items at all. It is not a real page, so the route
 * can recognise an empty (out-of-range) page by it and answer 404 instead of a sitemap that lists the home page
 * (security review K-L9).
 */
export const EMPTY_SITEMAP_MARKER = '/__empty-sitemap-page__';

export function isEmptySitemapBody(xml: string): boolean {
  return xml.includes(EMPTY_SITEMAP_MARKER);
}

/**
 * Removes the `<url>` entries of the given product handles from Shopify's product sitemap XML (offer-only products,
 * K-L3). Matching is on the `<loc>` path `/products/<handle>` after the same encoding the links were built with.
 */
export function dropProductEntries(
  xml: string,
  handles: ReadonlySet<string>,
): string {
  if (handles.size === 0) return xml;
  const excluded = new Set(
    [...handles].map((handle) => `/products/${encodeURIComponent(handle)}`),
  );
  return xml.replace(/<url>[\s\S]*?<\/url>/g, (block) => {
    const loc = /<loc>([^<]*)<\/loc>/.exec(block)?.[1];
    if (loc === undefined) return block;
    let path: string;
    try {
      path = new URL(loc).pathname;
    } catch {
      return block;
    }
    return excluded.has(path) ? '' : block;
  });
}

/**
 * A request with a query string is redirected to the bare URL, so the cached object is keyed by the path alone and
 * `?x=1` cannot be used to bypass the cache and reach Shopify again (K-L9). Null when there is no query.
 */
export function bareUrlRedirect(request: Request): Response | null {
  const url = new URL(request.url);
  if (url.search === '') return null;
  return new Response(null, {
    status: 301,
    headers: {
      Location: url.pathname, // relative: never the request Host (P-L2)
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
