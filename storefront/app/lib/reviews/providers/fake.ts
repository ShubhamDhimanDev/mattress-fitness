// SERVER ONLY, DEVELOPMENT ONLY. A typed fake provider for tests and the dev server (P3B-12). The config refuses it
// outside development (config.ts), and the registry only imports it behind `import.meta.env.DEV`.
//
// Behaviour by handle, so every page state can be reached without an account:
//   handle ending `-none`   no reviews
//   handle ending `-down`   the provider is unavailable
//   anything else           12 reviews, 4.2 average
// The text is invented for the fake and carries no real customer data.

import type {
  ReviewsAggregateResult,
  ReviewsPageOptions,
  ReviewsProvider,
  ReviewsResult,
  ReviewView,
} from '~/lib/reviews/provider';

const RATINGS = [5, 4, 5, 3, 4, 5, 4, 4, 5, 3, 4, 4] as const;
const AUTHORS = ['Sam B.', 'Alex', 'Jordan K.', 'Customer'] as const;

export const FAKE_REVIEWS: readonly ReviewView[] = RATINGS.map(
  (rating, index) => ({
    id: `fake-${index + 1}`,
    rating,
    title: index % 3 === 0 ? 'Sleeps well' : null,
    body: `Fake review ${index + 1}: comfortable after a few nights.`,
    author: AUTHORS[index % AUTHORS.length] ?? 'Customer',
    date: `2026-09-${String(10 + index).padStart(2, '0')}`,
  }),
);

export function createFakeProvider(): ReviewsProvider {
  return {
    id: 'fake',
    fetchProductReviews(
      productHandle: string,
      options: ReviewsPageOptions,
    ): Promise<ReviewsResult> {
      if (productHandle.endsWith('-down')) {
        return Promise.resolve({status: 'unavailable'});
      }
      const all = productHandle.endsWith('-none') ? [] : FAKE_REVIEWS;
      const start = (options.page - 1) * options.limit;
      return Promise.resolve({
        status: 'ok',
        reviews: all.slice(start, start + options.limit),
        hasMore: start + options.limit < all.length,
      });
    },
    fetchAggregate(productHandle: string): Promise<ReviewsAggregateResult> {
      if (productHandle.endsWith('-down')) {
        return Promise.resolve({status: 'unavailable'});
      }
      if (productHandle.endsWith('-none')) {
        return Promise.resolve({status: 'ok', aggregate: null});
      }
      const sum = FAKE_REVIEWS.reduce(
        (total, review) => total + review.rating,
        0,
      );
      return Promise.resolve({
        status: 'ok',
        aggregate: {
          average: Math.round((sum / FAKE_REVIEWS.length) * 10) / 10,
          count: FAKE_REVIEWS.length,
          exact: true,
        },
      });
    },
  };
}
