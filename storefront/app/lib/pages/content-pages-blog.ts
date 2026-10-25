// Small pure helpers for the blog pages and the "last updated" line of content pages (REQ-CNT-002, P6-09).

export type ArticleLink = {readonly handle: string; readonly title: string};

/**
 * A long US date (`October 5, 2026`), or an empty string for a value that is not a date. The zone is fixed to UTC
 * on purpose: the server and the browser must print the same day, or the page would hydrate with a mismatch.
 */
export function formatLongDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return '';
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(time));
}

export type Neighbours = {
  readonly newer: ArticleLink | null;
  readonly older: ArticleLink | null;
};

/**
 * The articles either side of `handle` in a list that is sorted newest first. The Storefront API has no
 * next/previous field, so the route reads a bounded list of handles and titles and finds the position here. An
 * article outside that window (or a missing one) has no neighbours, which hides the links instead of guessing.
 */
export function articleNeighbours(
  newestFirst: readonly ArticleLink[],
  handle: string,
): Neighbours {
  const index = newestFirst.findIndex((article) => article.handle === handle);
  if (index === -1) return {newer: null, older: null};
  return {
    newer: newestFirst[index - 1] ?? null,
    older: newestFirst[index + 1] ?? null,
  };
}

/** Site paths for the blog routes; handles come from Shopify and are encoded for the URL. */
export function blogPath(blogHandle: string): string {
  return `/blogs/${encodeURIComponent(blogHandle)}`;
}

export function articlePath(blogHandle: string, articleHandle: string): string {
  return `${blogPath(blogHandle)}/${encodeURIComponent(articleHandle)}`;
}
