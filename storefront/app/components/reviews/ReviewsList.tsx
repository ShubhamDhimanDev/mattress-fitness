import {useCallback, useEffect, useRef, useState} from 'react';
import {Button} from '~/components/ui/Button';
import {Rating} from '~/components/ui/Rating';
import {
  parseReviewsApiResponse,
  REVIEWS_PAGE_SIZE,
  reviewsRequestPath,
} from '~/lib/reviews/api';
import type {ReviewsAggregate, ReviewView} from '~/lib/reviews/provider';

export type ReviewsListProps = {readonly handle: string};

type State =
  | {readonly status: 'loading'}
  | {readonly status: 'unavailable'}
  | {
      readonly status: 'ready';
      readonly aggregate: ReviewsAggregate | null;
      readonly reviews: readonly ReviewView[];
      readonly page: number;
      readonly hasMore: boolean;
      /** Index of the first review of the page just appended, so focus can move to it; null on the first page. */
      readonly appendedFrom: number | null;
    };

const dateFormat = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

function formatDate(iso: string | null): string | null {
  if (iso === null) return null;
  const time = Date.parse(iso);
  return Number.isFinite(time) ? dateFormat.format(time) : null;
}

async function request(
  handle: string,
  page: number,
  signal: AbortSignal,
): Promise<ReturnType<typeof parseReviewsApiResponse>> {
  try {
    const response = await fetch(
      reviewsRequestPath({handle, page, limit: REVIEWS_PAGE_SIZE}),
      {signal, headers: {Accept: 'application/json'}},
    );
    if (!response.ok) return {status: 'unavailable'};
    return parseReviewsApiResponse(await response.json());
  } catch {
    return {status: 'unavailable'};
  }
}

/** Aggregate stars and the review list with "Load more" (REQ-PDP-005). Every failure reads as "No reviews yet". */
export function ReviewsList({handle}: ReviewsListProps) {
  const [state, setState] = useState<State>({status: 'loading'});
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const firstNew = useRef<HTMLLIElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    void request(handle, 1, controller.signal).then((answer) => {
      if (controller.signal.aborted) return;
      setState(
        answer.status === 'ok'
          ? {
              status: 'ready',
              aggregate: answer.aggregate,
              reviews: answer.reviews,
              page: 1,
              hasMore: answer.hasMore,
              appendedFrom: null,
            }
          : {status: 'unavailable'},
      );
    });
    return () => controller.abort();
  }, [handle]);

  const appendedFrom = state.status === 'ready' ? state.appendedFrom : null;
  useEffect(() => {
    if (appendedFrom !== null) firstNew.current?.focus();
  }, [appendedFrom]);

  const loadMore = useCallback(async () => {
    if (state.status !== 'ready') return;
    setLoadingMore(true);
    setMoreFailed(false);
    const answer = await request(
      handle,
      state.page + 1,
      new AbortController().signal,
    );
    setLoadingMore(false);
    if (answer.status !== 'ok') {
      setMoreFailed(true);
      return;
    }
    setState({
      ...state,
      appendedFrom: answer.reviews.length > 0 ? state.reviews.length : null,
      reviews: [...state.reviews, ...answer.reviews],
      page: state.page + 1,
      hasMore: answer.hasMore,
    });
  }, [handle, state]);

  if (state.status === 'loading') {
    return (
      <p role="status" className="text-sm text-fg-muted">
        Loading reviews
      </p>
    );
  }
  if (state.status === 'unavailable' || state.reviews.length === 0) {
    return <p className="text-sm text-fg-muted">No reviews yet</p>;
  }

  const {aggregate, reviews, hasMore} = state;

  return (
    <div className="flex flex-col gap-4">
      {aggregate ? (
        <Rating
          value={aggregate.average}
          count={aggregate.exact ? aggregate.count : undefined}
        />
      ) : null}
      <ul className="flex flex-col divide-y divide-line">
        {reviews.map((review, index) => (
          <li
            key={review.id}
            ref={index === state.appendedFrom ? firstNew : null}
            tabIndex={-1}
            className="flex flex-col gap-1 py-4 outline-none first:pt-0"
          >
            <Rating value={review.rating} />
            {review.title ? <p className="font-bold">{review.title}</p> : null}
            <p className="max-w-prose whitespace-pre-line">{review.body}</p>
            <p className="text-sm text-fg-muted">
              {review.author}
              {formatDate(review.date) ? ` · ${formatDate(review.date)}` : ''}
            </p>
          </li>
        ))}
      </ul>
      <div aria-live="polite" className="text-sm text-fg-muted">
        {moreFailed ? 'Could not load more reviews. Try again.' : ''}
      </div>
      {hasMore ? (
        <Button
          type="button"
          variant="secondary"
          loading={loadingMore}
          loadingLabel="Loading more reviews"
          onClick={() => void loadMore()}
          className="self-start"
        >
          Load more reviews
        </Button>
      ) : null}
    </div>
  );
}
