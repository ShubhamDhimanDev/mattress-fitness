import type {ReactNode} from 'react';
import {Action, type ActionElementProps} from '~/components/ui/Action';
import {cn} from '~/components/ui/cn';
import {SpinnerIcon} from '~/components/ui/Icons';

/**
 * `pill` is shorthand for the primary look in the pill shape, the navigation-level call to action.
 * Any other variant can take the pill shape with `shape="pill"`; choice buttons keep the 4 px radius.
 */
export type ButtonVariant =
  'primary' | 'secondary' | 'ghost' | 'accent' | 'pill';
export type ButtonSize = 'sm' | 'md' | 'lg';
export type ButtonShape = 'default' | 'pill';

type StyleProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  shape?: ButtonShape;
  fullWidth?: boolean;
};

type OwnProps = StyleProps & {
  /** Shows a spinner and ignores clicks while keeping focus where it is. */
  loading?: boolean;
  loadingLabel?: string;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  className?: string;
  children: ReactNode;
};

export type ButtonProps = OwnProps & ActionElementProps;

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    'border-primary-700 bg-primary-700 text-white hover:border-primary-800 hover:bg-primary-800 active:bg-primary-900',
  pill: 'border-primary-700 bg-primary-700 text-white hover:border-primary-800 hover:bg-primary-800 active:bg-primary-900',
  secondary:
    'border-primary-700 bg-surface text-primary-700 hover:bg-primary-50 active:bg-primary-100',
  ghost:
    'border-transparent bg-transparent text-primary-700 hover:bg-primary-50 active:bg-primary-100',
  accent:
    'border-accent-400 bg-accent-400 text-ink-900 hover:border-accent-300 hover:bg-accent-300 active:bg-accent-500',
};

// Every size is at least the 44 px touch target (NFR-001).
const SIZE: Record<ButtonSize, string> = {
  sm: 'min-h-touch px-4 text-sm',
  md: 'min-h-12 px-6 text-sm',
  lg: 'min-h-14 px-8 text-base',
};

/** Class names for anything that must look like a button (a styled link in a card, for example). */
export function buttonStyles({
  variant = 'primary',
  size = 'md',
  shape = 'default',
  fullWidth = false,
  inert = false,
}: StyleProps & {inert?: boolean} = {}): string {
  const pill = shape === 'pill' || variant === 'pill';
  return cn(
    'inline-flex items-center justify-center gap-2 border-2 text-center font-bold tracking-wide transition-colors',
    variant !== 'ghost' && 'uppercase',
    pill ? 'rounded-pill' : 'rounded-choice',
    VARIANT[variant],
    SIZE[size],
    fullWidth && 'w-full',
    inert && 'pointer-events-none opacity-60',
  );
}

export function Button({
  variant,
  size,
  shape,
  fullWidth,
  loading = false,
  loadingLabel = 'Loading',
  leadingIcon,
  trailingIcon,
  className,
  children,
  ...element
}: ButtonProps) {
  const disabled = 'disabled' in element && element.disabled === true;
  const inert = loading || disabled;

  return (
    <Action
      {...element}
      inert={inert}
      aria-busy={loading || undefined}
      className={cn(
        buttonStyles({variant, size, shape, fullWidth, inert}),
        className,
      )}
    >
      {loading ? <SpinnerIcon className="size-5" /> : leadingIcon}
      {children}
      {loading ? <span className="sr-only">{loadingLabel}</span> : trailingIcon}
    </Action>
  );
}
