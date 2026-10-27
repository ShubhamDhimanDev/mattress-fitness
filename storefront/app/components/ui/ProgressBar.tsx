import {cn} from '~/components/ui/cn';

export type ProgressTone = 'red' | 'success';

type ProgressBarProps = {
  /** Current value between `min` and `max`. The caller derives it from server data; this component only draws it. */
  value: number;
  min?: number;
  max?: number;
  /** Accessible name, e.g. "Progress to free delivery". Required: a bare bar says nothing to a screen reader. */
  label: string;
  /** Spoken value instead of the bare number, e.g. "$120 away from free delivery". */
  valueText?: string;
  /** `red` while the goal is open, `success` once it is reached. */
  tone?: ProgressTone;
  className?: string;
};

/** Share of the track to fill, 0 to 100. Out-of-range, reversed or non-numeric input draws an empty or full bar, never NaN. */
export function progressPercent(value: number, min = 0, max = 100): number {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max))
    return 0;
  if (max <= min) return 0;
  const share = ((value - min) / (max - min)) * 100;
  return Math.min(100, Math.max(0, share));
}

const FILL: Record<ProgressTone, string> = {
  red: 'bg-primary-500',
  success: 'bg-success-solid',
};

/**
 * Progress to a goal (free delivery). `role="progressbar"` with value, min and max; the fill is also coloured, but the
 * accompanying text next to the bar (not part of this component) says what the number means. The fill widens behind
 * `motion-safe:`; with reduced motion it jumps.
 */
export function ProgressBar({
  value,
  min = 0,
  max = 100,
  label,
  valueText,
  tone = 'red',
  className,
}: ProgressBarProps) {
  const percent = progressPercent(value, min, max);
  const now = Math.min(
    max,
    Math.max(min, Number.isFinite(value) ? value : min),
  );
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={now}
      aria-valuetext={valueText}
      className={cn(
        'h-2.5 w-full overflow-hidden rounded-pill bg-ink-100',
        className,
      )}
    >
      <div
        className={cn(
          'h-full rounded-pill motion-safe:transition-[width] motion-safe:duration-300 motion-safe:ease-out',
          FILL[tone],
        )}
        style={{width: `${percent}%`}}
      />
    </div>
  );
}
