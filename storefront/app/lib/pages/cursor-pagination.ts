// Cursor pagination from the URL, checked before it reaches a query (REQ-CNT-002, security M3). Shared by every list
// that pages with Hydrogen's `Pagination` (blogs, collections, orders).

import {CURSOR_PATTERN} from '~/lib/filters';

/** The variables of a cursor-paginated Storefront connection. */
export type PaginationVariables =
  | {readonly first: number; readonly endCursor: string | null}
  | {readonly last: number; readonly startCursor: string};

/**
 * Pagination variables from the URL (`?cursor=...&direction=next|previous`, the names Hydrogen's Pagination
 * writes), validated like the product listing cursor: the cursor must match `CURSOR_PATTERN` and the direction must be
 * one of the two known values. Anything else, a cursor or a direction that is not recognised, is dropped and the
 * first page is served, so no caller-chosen string reaches the Storefront API (T-07, as in filters.ts).
 */
export function cursorPaginationVariables(
  searchParams: URLSearchParams,
  pageBy: number,
): PaginationVariables {
  const cursor = searchParams.get('cursor');
  const direction = searchParams.get('direction');
  const valid =
    cursor !== null &&
    CURSOR_PATTERN.test(cursor) &&
    (direction === null || direction === 'next' || direction === 'previous');
  if (!valid) return {first: pageBy, endCursor: null};
  return direction === 'previous'
    ? {last: pageBy, startCursor: cursor}
    : {first: pageBy, endCursor: cursor};
}
