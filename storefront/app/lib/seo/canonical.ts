// Canonical URL policy (P7-04, REQ-SEO-001, docs/architecture/SEO_POLICY.md, DEC-044).
//
// One rule for every page: the canonical URL is the site origin plus the path, with no query string and no
// fragment. A filtered, sorted or paginated view of a collection, a product page with a selected size, a
// search term and a tracking parameter therefore all point at the same clean URL. The origin always comes from
// the configured `PUBLIC_SITE_URL` (site-origin.ts), never from the request, so a forged Host header cannot
// reach a canonical link (P-L2). Without an origin there is no canonical, which is harmless; a wrong one is not.

/**
 * Paths crawlers are told to stay out of (robots.txt): private or per-shopper pages and endpoints. Internal search is
 * NOT here: it is `noindex,follow`, and a noindex can only be read on a URL the crawler may fetch. A prefix matches the path itself and anything below it ("/cart" and "/cart/c/1", not "/cartridge").
 */
export const ROBOTS_DISALLOWED_PREFIXES: readonly string[] = [
  '/cart',
  '/account',
  '/checkout-steps',
  '/delivery',
  '/api',
  '/webhooks',
  '/discount',
];

/**
 * Paths that never get a canonical link or a sitemap entry: everything robots.txt blocks, plus pages that are
 * crawlable but are tools or machine files rather than content (they carry their own noindex).
 */
export const NON_INDEXABLE_PREFIXES: readonly string[] = [
  ...ROBOTS_DISALLOWED_PREFIXES,
  '/search',
  '/compare',
  // Guest order lookup (L-6): carries its own noindex. Deliberately NOT in the robots Disallow list, which would
  // stop crawlers from ever seeing that noindex.
  '/track-order',
  '/sitemap',
  '/sitemap.xml',
  '/robots.txt',
  '/_dev',
];

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** Routes match case-insensitively and decode the path, so the check does too (`/CART`, `/%63art`). */
function comparable(pathname: string): string {
  try {
    return decodeURIComponent(pathname).toLowerCase();
  } catch {
    return pathname.toLowerCase();
  }
}

export function isIndexablePath(pathname: string): boolean {
  const path = comparable(pathname);
  return !NON_INDEXABLE_PREFIXES.some((prefix) => matchesPrefix(path, prefix));
}

/** Drops a trailing slash (but keeps the root), so `/collections/x/` and `/collections/x` are one URL. */
function trimTrailingSlash(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') || '/' : pathname;
}

/**
 * The canonical URL for a request path, or null when there is no configured origin or the path is not
 * indexable. `pathname` is taken as the URL parser leaves it (already percent-encoded).
 */
export function canonicalUrl(
  origin: string | null,
  pathname: string,
): string | null {
  if (origin === null || !pathname.startsWith('/')) return null;
  let parsed: URL;
  try {
    parsed = new URL(pathname, origin);
  } catch {
    return null;
  }
  // `//host/path` would have been read as a different origin; the origin must be unchanged.
  if (parsed.origin !== origin) return null;
  if (!isIndexablePath(parsed.pathname)) return null;
  return `${origin}${trimTrailingSlash(parsed.pathname)}`;
}

/** The value of a `Link` response header carrying the canonical URL; Google reads it like the HTML tag. */
export function canonicalLinkHeader(canonical: string): string {
  return `<${canonical}>; rel="canonical"`;
}

/** A React Router `meta` descriptor for `<link rel="canonical">`. */
export function canonicalMeta(
  canonical: string | null,
): Array<{tagName: 'link'; rel: 'canonical'; href: string}> {
  return canonical
    ? [{tagName: 'link', rel: 'canonical', href: canonical}]
    : [];
}
