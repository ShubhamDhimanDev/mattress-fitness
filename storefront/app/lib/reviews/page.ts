// SERVER ONLY. What the product loader needs from the reviews layer (P3B-12, REQ-PDP-005): whether reviews are on, and the
// aggregate for the stars and the rating markup. Off costs nothing (no provider built, no request). On, the read is bounded
// by a short deadline so a slow provider can never hold up the page: the stars and markup are simply missing that time, and
// the read keeps going and fills the service memory for the next view.

import type {ReviewsAggregate} from '~/lib/reviews/provider';
import {getReviewsRuntime, reviewsEnabled} from '~/lib/reviews/runtime';

export const PAGE_SUMMARY_DEADLINE_MS = 1200;

export type ReviewsPageState = {
  /** Render the "Customer reviews" section. */
  readonly enabled: boolean;
  /** Exact-or-not aggregate from the provider; null when off, empty or unreachable. */
  readonly aggregate: ReviewsAggregate | null;
};

export const REVIEWS_OFF: ReviewsPageState = {enabled: false, aggregate: null};

export async function loadReviewsPageState(
  env: object,
  handle: string,
  development: boolean,
): Promise<ReviewsPageState> {
  if (!reviewsEnabled(env, development)) return REVIEWS_OFF;
  const runtime = await getReviewsRuntime(env, development);
  if (runtime.status === 'off') return REVIEWS_OFF;
  const summary = await runtime.service.summaryWithin(
    handle,
    PAGE_SUMMARY_DEADLINE_MS,
  );
  return {
    enabled: true,
    aggregate: summary.status === 'ok' ? summary.aggregate : null,
  };
}
