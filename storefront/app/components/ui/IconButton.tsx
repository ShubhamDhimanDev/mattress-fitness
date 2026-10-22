import type {ReactNode} from 'react';
import {Action, type ActionElementProps} from '~/components/ui/Action';
import {cn} from '~/components/ui/cn';

type OwnProps = {
  /** Accessible name. Required: an icon alone is not a label. Include any count it shows, e.g. "Cart, 2 items". */
  label: string;
  icon: ReactNode;
  /** Visible text under the icon from the `lg` breakpoint up. Its words must appear in `label` (WCAG 2.5.3). */
  caption?: string;
  /** Count bubble. Hidden from assistive technology because `label` already carries it. */
  badge?: number;
  variant?: 'ghost' | 'solid';
  className?: string;
};

export type IconButtonProps = OwnProps & ActionElementProps;

const VARIANT = {
  ghost: 'bg-transparent text-fg hover:bg-surface-muted active:bg-ink-200',
  solid: 'bg-primary-500 text-white hover:bg-primary-600 active:bg-primary-700',
} as const;

export function IconButton({
  label,
  icon,
  caption,
  badge,
  variant = 'ghost',
  className,
  ...element
}: IconButtonProps) {
  const disabled = 'disabled' in element && element.disabled === true;
  const showBadge = badge !== undefined && badge > 0;

  return (
    <Action
      {...element}
      inert={disabled}
      aria-label={label}
      className={cn(
        'relative inline-flex min-h-touch min-w-touch shrink-0 flex-col items-center justify-center gap-0.5 rounded-choice px-2 motion-safe:transition-colors',
        VARIANT[variant],
        disabled && 'pointer-events-none opacity-60',
        className,
      )}
    >
      {icon}
      {caption ? (
        <span aria-hidden="true" className="hidden text-xs font-bold lg:block">
          {caption}
        </span>
      ) : null}
      {showBadge ? (
        <span
          aria-hidden="true"
          className="absolute top-0.5 right-0.5 inline-flex min-w-5 items-center justify-center rounded-pill bg-primary-500 px-1 text-xs leading-5 font-bold text-white"
        >
          {badge > 99 ? '99+' : badge}
        </span>
      ) : null}
    </Action>
  );
}
