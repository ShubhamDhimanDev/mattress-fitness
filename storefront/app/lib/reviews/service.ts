// SERVER ONLY. Cost control around a reviews provider (P3B-12, REQ-PDP-005, NFR-013, T-13): a short memory of answers
// (including in-flight ones, so ten visitors on one product make one upstream request), a small failure memory so a down
// provider is not hammered, and a ceiling on upstream calls per minute. The memory is per process: it bounds cost, it is
// not a shared cache. Never throws; every failure is `{status: 'unavailable'}`.

import type {
  ReviewsAggregateResult,
  ReviewsPageOptions,
  ReviewsProvider,
  ReviewsResult,
} from '~/lib/reviews/provider';

export const REVIEWS_TTL_MS = 5 * 60_000;
export const REVIEWS_FAILURE_TTL_MS = 30_000;
/** ASSUMPTION, no traffic evidence yet: 120 upstream reads a minute is far above what a small store's cache misses need. */
export const REVIEWS_CALLS_PER_MINUTE = 120;
const MAX_ENTRIES = 500;

export type ReviewsService = {
  summary(handle: string): Promise<ReviewsAggregateResult>;
  /** The summary, or `unavailable` when it takes longer than `ms` (the underlying read keeps running and fills the memory). */
  summaryWithin(handle: string, ms: number): Promise<ReviewsAggregateResult>;
  page(handle: string, options: ReviewsPageOptions): Promise<ReviewsResult>;
};

type Entry<T> = {until: number; readonly promise: Promise<T>};
type Unavailable = {readonly status: 'unavailable'};
const UNAVAILABLE: Unavailable = {status: 'unavailable'};

export function createReviewsService(
  provider: ReviewsProvider,
  options: {
    readonly now?: () => number;
    readonly ttlMs?: number;
    readonly callsPerMinute?: number;
    readonly log?: (
      event: string,
      fields: Record<string, string | number>,
    ) => void;
  } = {},
): ReviewsService {
  const now = options.now ?? (() => Date.now());
  const ttlMs = options.ttlMs ?? REVIEWS_TTL_MS;
  const callsPerMinute = options.callsPerMinute ?? REVIEWS_CALLS_PER_MINUTE;
  let windowStart = now();
  let calls = 0;

  function withinBudget(): boolean {
    if (now() - windowStart >= 60_000) {
      windowStart = now();
      calls = 0;
    }
    if (calls >= callsPerMinute) return false;
    calls += 1;
    return true;
  }

  // One memory per result type keeps the stored promises correctly typed without casts.
  function memoryOf<T extends {readonly status: string}>() {
    const entries = new Map<string, Entry<T>>();
    return (
      key: string,
      unavailable: T,
      read: () => Promise<T>,
    ): Promise<T> => {
      const hit = entries.get(key);
      if (hit && hit.until > now()) return hit.promise;
      entries.delete(key);
      if (!withinBudget()) {
        options.log?.('reviews.budget_exceeded', {provider: provider.id});
        return Promise.resolve(unavailable);
      }
      if (entries.size >= MAX_ENTRIES) {
        const oldest = entries.keys().next();
        if (!oldest.done) entries.delete(oldest.value);
      }
      const entry: Entry<T> = {
        until: now() + ttlMs,
        promise: read().catch(() => unavailable),
      };
      entries.set(key, entry);
      void entry.promise.then((result) => {
        if (result.status === 'unavailable') {
          entry.until = Math.min(entry.until, now() + REVIEWS_FAILURE_TTL_MS);
        }
      });
      return entry.promise;
    };
  }

  const rememberSummary = memoryOf<ReviewsAggregateResult>();
  const rememberPage = memoryOf<ReviewsResult>();

  function summary(handle: string): Promise<ReviewsAggregateResult> {
    return rememberSummary(`s:${handle}`, UNAVAILABLE, () =>
      provider.fetchAggregate(handle),
    );
  }

  return {
    summary,
    summaryWithin(handle, ms) {
      return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(UNAVAILABLE), ms);
        void summary(handle).then((result) => {
          clearTimeout(timer);
          resolve(result);
        });
      });
    },
    page(handle, page) {
      return rememberPage(
        `p:${handle}:${page.page}:${page.limit}`,
        UNAVAILABLE,
        () => provider.fetchProductReviews(handle, page),
      );
    },
  };
}
