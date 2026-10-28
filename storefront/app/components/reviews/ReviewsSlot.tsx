import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ComponentType,
} from 'react';
import type {ReviewsListProps} from '~/components/reviews/ReviewsList';

// The list is a lazy chunk requested only where this slot renders (the loader renders it only when a provider is configured)
// and only when the slot is near the viewport, so a store with reviews off carries no reviews code and makes no request, and
// one with reviews on pays nothing for shoppers who never scroll that far (bundle budget, scripts/perf). A chunk that cannot
// be downloaded shows the "no reviews yet" text and nothing else breaks (NFR-013).
const NoReviews: ComponentType<ReviewsListProps> = () => (
  <p className="text-sm text-fg-muted">No reviews yet</p>
);
const ReviewsList = lazy(
  (): Promise<{default: ComponentType<ReviewsListProps>}> =>
    import('~/components/reviews/ReviewsList').then(
      (module) => ({default: module.ReviewsList}),
      () => ({default: NoReviews}),
    ),
);

/**
 * "Customer reviews" under the buy box (REQ-PDP-005). The heading and the `#reviews` anchor are always present when
 * reviews are on, so the star link at the top of the buy box has somewhere to land; the content arrives when the section
 * is about to be seen.
 */
export function ReviewsSlot({handle}: {handle: string}) {
  const anchor = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const element = anchor.current;
    if (!element) return;
    if (typeof IntersectionObserver !== 'function') {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      {rootMargin: '400px 0px'},
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <section id="reviews" aria-labelledby="pdp-reviews-heading">
      <h2
        id="pdp-reviews-heading"
        className="type-display mb-4 text-3xl md:text-heading"
      >
        Customer reviews
      </h2>
      <div ref={anchor} className="min-h-24">
        {near ? (
          <Suspense
            fallback={<p className="text-sm text-fg-muted">Loading reviews</p>}
          >
            <ReviewsList handle={handle} />
          </Suspense>
        ) : null}
      </div>
    </section>
  );
}
