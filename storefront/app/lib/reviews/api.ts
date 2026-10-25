// The shape of GET /api/reviews, shared by the route (server) and the section (browser). Pure; type-only imports, so
// nothing server-side reaches the client bundle. The browser validates what it receives like any other input.
//   GET /api/reviews?handle=queen-mattress&page=1&limit=5
//   200 {"status":"ok","page":1,"aggregate":{...}|null,"reviews":[...],"hasMore":true}   (aggregate only on page 1)
//   200 {"status":"unavailable"}                                                          (provider off, slow, down)

import type {ReviewsAggregate, ReviewView} from '~/lib/reviews/provider';

export const REVIEWS_PAGE_SIZE = 5;
export const REVIEWS_MAX_LIMIT = 20;
export const REVIEWS_MAX_PAGE = 20;
const HANDLE = /^[a-z0-9][a-z0-9-]{0,254}$/;

export type ReviewsQuery = {
  readonly handle: string;
  readonly page: number;
  readonly limit: number;
};

export type ReviewsApiResponse =
  | {
      readonly status: 'ok';
      readonly page: number;
      readonly aggregate: ReviewsAggregate | null;
      readonly reviews: readonly ReviewView[];
      readonly hasMore: boolean;
    }
  | {readonly status: 'unavailable'};

function boundedInt(
  raw: string | null,
  fallback: number,
  min: number,
  max: number,
): number | null {
  if (raw === null) return fallback;
  if (!/^[0-9]{1,3}$/.test(raw)) return null;
  const value = Number(raw);
  return value >= min && value <= max ? value : null;
}

/** Strict: anything unexpected is `null` (the route answers 400), nothing is silently corrected. */
export function parseReviewsQuery(url: URL): ReviewsQuery | null {
  const handle = url.searchParams.get('handle') ?? '';
  if (!HANDLE.test(handle)) return null;
  const page = boundedInt(url.searchParams.get('page'), 1, 1, REVIEWS_MAX_PAGE);
  const limit = boundedInt(
    url.searchParams.get('limit'),
    REVIEWS_PAGE_SIZE,
    1,
    REVIEWS_MAX_LIMIT,
  );
  return page === null || limit === null ? null : {handle, page, limit};
}

export function reviewsRequestPath(query: ReviewsQuery): string {
  const params = new URLSearchParams({
    handle: query.handle,
    page: String(query.page),
    limit: String(query.limit),
  });
  return `/api/reviews?${params.toString()}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function reviewOf(raw: unknown): ReviewView | null {
  if (!isRecord(raw)) return null;
  const {id, rating, title, body, author, date} = raw;
  if (
    typeof id !== 'string' ||
    typeof rating !== 'number' ||
    typeof body !== 'string' ||
    typeof author !== 'string' ||
    (title !== null && typeof title !== 'string') ||
    (date !== null && typeof date !== 'string')
  ) {
    return null;
  }
  return {id, rating, title, body, author, date};
}

function aggregateOf(raw: unknown): ReviewsAggregate | null {
  if (!isRecord(raw)) return null;
  const {average, count, exact} = raw;
  return typeof average === 'number' &&
    typeof count === 'number' &&
    typeof exact === 'boolean'
    ? {average, count, exact}
    : null;
}

/** What the browser does with the answer: anything that does not fit is treated as `unavailable`. */
export function parseReviewsApiResponse(json: unknown): ReviewsApiResponse {
  if (!isRecord(json) || json['status'] !== 'ok') {
    return {status: 'unavailable'};
  }
  const list = json['reviews'];
  const page = json['page'];
  if (!Array.isArray(list) || typeof page !== 'number') {
    return {status: 'unavailable'};
  }
  const reviews = list.flatMap((raw: unknown) => {
    const review = reviewOf(raw);
    return review ? [review] : [];
  });
  return {
    status: 'ok',
    page,
    aggregate: aggregateOf(json['aggregate']),
    reviews,
    hasMore: json['hasMore'] === true,
  };
}
