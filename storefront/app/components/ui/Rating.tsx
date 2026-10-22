import {cn} from '~/components/ui/cn';
import {StarIcon} from '~/components/ui/Icons';

const MAX_STARS = 5;

type RatingProps = {
  /** Average from the reviews provider, 0 to 5. Null or undefined when there are no reviews. */
  value?: number | null;
  /** Number of reviews. */
  count?: number;
  /** Where the count links to, e.g. "#reviews". */
  href?: string;
  /** Text shown when there is nothing to rate yet. */
  emptyLabel?: string;
  className?: string;
};

function clampRating(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(MAX_STARS, Math.max(0, value));
}

/** "Rated 4.5 out of 5 stars from 128 reviews" for assistive technology; the stars are decorative. */
export function ratingText(value: number, count?: number): string {
  const rounded = Math.round(clampRating(value) * 10) / 10;
  const base = `Rated ${rounded} out of ${MAX_STARS} stars`;
  if (count === undefined) return base;
  return `${base} from ${count} ${count === 1 ? 'review' : 'reviews'}`;
}

// Stars are near-black on a grey track (an amber star is 2.4:1 on white); the visible count carries the value.
// Presentational adapter: the reviews provider is not chosen yet (Q-011), so this takes plain numbers.
export function Rating({
  value,
  count,
  href,
  emptyLabel = 'No reviews yet',
  className,
}: RatingProps) {
  if (value === null || value === undefined || count === 0) {
    return (
      <p className={cn('text-sm text-fg-muted', className)}>{emptyLabel}</p>
    );
  }

  const rating = clampRating(value);
  const stars = Array.from({length: MAX_STARS}, (_, index) => {
    const fill = Math.min(1, Math.max(0, rating - index));
    return {index, widthPercent: Math.round(fill * 100)};
  });
  const countLabel =
    count === undefined
      ? null
      : `${count} ${count === 1 ? 'Review' : 'Reviews'}`;

  const body = (
    <>
      <span className="sr-only">{ratingText(rating, count)}</span>
      <span aria-hidden="true" className="inline-flex">
        {stars.map((star) => (
          <span key={star.index} className="relative inline-block size-5">
            <StarIcon className="absolute inset-0 size-5 text-ink-300" />
            <span
              className="absolute inset-y-0 left-0 overflow-hidden"
              style={{width: `${star.widthPercent}%`}}
            >
              <StarIcon className="size-5 text-ink-900" />
            </span>
          </span>
        ))}
      </span>
      {countLabel ? (
        <span aria-hidden="true" className="text-sm font-bold text-fg">
          {countLabel}
        </span>
      ) : null}
    </>
  );

  const shared = cn('inline-flex items-center gap-1', className);
  return href ? (
    <a href={href} className={cn(shared, 'min-h-touch hover:underline')}>
      {body}
    </a>
  ) : (
    <p className={shared}>{body}</p>
  );
}
