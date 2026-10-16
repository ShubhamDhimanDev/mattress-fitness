import {cn} from '~/components/ui/cn';

type SkeletonProps = {className?: string};

/**
 * Placeholder block shown while data loads. Give it the final size (width, height or aspect ratio) so the
 * page does not shift when real content arrives (NFR-002). Decorative: announce loading with a status
 * region next to it, not here.
 */
export function Skeleton({className}: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'rounded-choice bg-ink-200 motion-safe:animate-pulse',
        className,
      )}
    />
  );
}

export function SkeletonText({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  const rows = Array.from({length: lines}, (_, position) => ({
    id: `line-${position}`,
    // The last line is shorter, like the end of a paragraph.
    short: position === lines - 1 && lines > 1,
  }));
  return (
    <div aria-hidden="true" className={cn('flex flex-col gap-2', className)}>
      {rows.map((row) => (
        <div
          key={row.id}
          className={cn(
            'h-4 rounded-choice bg-ink-200 motion-safe:animate-pulse',
            row.short ? 'w-2/3' : 'w-full',
          )}
        />
      ))}
    </div>
  );
}
