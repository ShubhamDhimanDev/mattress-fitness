// The contract every reviews provider adapter implements (P3B-12, REQ-PDP-005). The page never talks to a vendor: it asks
// our own `/api/reviews` route, which drives one of these on the server. Swapping the provider (Q-011) is a new adapter and
// a registry line. SERVER ONLY: adapters hold private tokens.

import type {ReviewsProviderId} from '~/lib/reviews/config';

/** One review as the page shows it: plain text only, already sanitised (sanitize.ts). */
export type ReviewView = {
  readonly id: string;
  /** Whole stars, 1 to 5. */
  readonly rating: number;
  readonly title: string | null;
  readonly body: string;
  /** "Sam B." style: a first name and an initial, or "Customer". Never a full name. */
  readonly author: string;
  /** ISO date (YYYY-MM-DD) or null when the provider gave none. */
  readonly date: string | null;
};

export type ReviewsAggregate = {
  /** 0 to 5, one decimal. */
  readonly average: number;
  readonly count: number;
  /**
   * False when the count is a lower bound (more reviews exist than the adapter was willing to read). An inexact aggregate
   * is never put into structured data.
   */
  readonly exact: boolean;
};

export type ReviewsPageOptions = {
  readonly limit: number;
  /** 1-based. */
  readonly page: number;
};

/** `unavailable` = the provider could not answer (down, slow, misconfigured, malformed answer): show "no reviews yet". */
export type ReviewsResult =
  | {
      readonly status: 'ok';
      readonly reviews: readonly ReviewView[];
      readonly hasMore: boolean;
    }
  | {readonly status: 'unavailable'};

export type ReviewsAggregateResult =
  | {readonly status: 'ok'; readonly aggregate: ReviewsAggregate | null}
  | {readonly status: 'unavailable'};

export interface ReviewsProvider {
  readonly id: ReviewsProviderId;
  /** A product handle (the page's identity). The adapter maps it to the vendor's own product id. Never throws. */
  fetchProductReviews(
    productHandle: string,
    options: ReviewsPageOptions,
  ): Promise<ReviewsResult>;
  /** `aggregate: null` means the product has no reviews. Never throws. */
  fetchAggregate(productHandle: string): Promise<ReviewsAggregateResult>;
}
