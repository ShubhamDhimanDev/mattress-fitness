import type {ReactNode} from 'react';
import {cn} from '~/components/ui/cn';
import {CheckIcon} from '~/components/ui/Icons';

/**
 * `neutral` is a paper chip for white surfaces; `outline` is white with a hairline, for use on paper (a paper chip
 * on paper would disappear); `success` is the green "in our delivery zone" chip and always carries a check icon.
 */
export type ChipTone = 'neutral' | 'outline' | 'success';

type ChipProps = {
  tone?: ChipTone;
  /** Replaces the default icon (only `success` has one by default). */
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
};

const TONE: Record<ChipTone, string> = {
  neutral: 'bg-paper text-ink-700',
  outline: 'border border-line bg-surface text-ink-700',
  success: 'bg-success-bg text-success-fg',
};

/** A small static label (memory foam, firm, in our delivery zone). For anything clickable use a Button or a link. */
export function Chip({tone = 'neutral', icon, children, className}: ChipProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-pill px-3 py-1 text-caption font-semibold',
        TONE[tone],
        className,
      )}
    >
      {icon ?? (tone === 'success' ? <CheckIcon className="size-4" /> : null)}
      {children}
    </span>
  );
}
