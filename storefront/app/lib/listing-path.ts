// The list id a listing page reports to analytics (P7-01, REQ-ANL-001). Kept out of `listing-analytics`, which the
// home page's product cards also load, so only the listing component carries it (bundle budget, scripts/perf).

/**
 * The list id for a listing page, from its path: the collection handle, `all` for the all-products page, `search`,
 * and `brand-<handle>` for a brand page; undefined elsewhere. The handle is not checked here: a card's attribute is
 * only data and the click mapper checks it, and `reportListing` checks it before a list event is sent, so a path
 * that is not a plain handle goes out without a list.
 */
export function listIdForPath(pathname: string): string | undefined {
  if (pathname === '/search') return 'search';
  const match = /^\/(collections|brands)\/([^/]+)$/.exec(pathname);
  if (!match) return undefined;
  return (match[1] === 'brands' ? 'brand-' : '') + match[2];
}
