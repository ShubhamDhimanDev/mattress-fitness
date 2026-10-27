import type {ReactNode} from 'react';
import {Action, type ActionElementProps} from '~/components/ui/Action';
import {cn} from '~/components/ui/cn';
import {SpinnerIcon} from '~/components/ui/Icons';

/**
 * Variants (CR-31 look; the original names all still work):
 *  - `primary` brand red, the one main action of a view. `pill` is shorthand for primary in the pill shape.
 *  - `secondary` red outline; `outline` ink outline (quiet second action next to a primary).
 *  - `dark` ink fill; `amber` (alias `accent`) amber fill, for black bands and offer panels.
 *  - `white` white fill with ink text, for red or black bands; `inverse` white fill with red text and
 *    `inverse-outline` a white outline, for the red band only.
 *  - `ghost` red text on a tint when hovered; `link` red underlined text, no box.
 * Any variant can take the pill shape with `shape="pill"`. Bands that are red or black must carry `on-dark`, which
 * turns the focus ring yellow (blue on red is 1.31:1). Hover and pressed shades are chosen so the label contrast rises,
 * never relying on the fill change alone.
 */
export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'outline'
  | 'dark'
  | 'amber'
  | 'white'
  | 'ghost'
  | 'link'
  | 'accent'
  | 'pill'
  | 'inverse'
  | 'inverse-outline';
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

const PRIMARY =
  'border-primary-500 bg-primary-500 text-white hover:border-primary-600 hover:bg-primary-600 active:border-primary-700 active:bg-primary-700';
const AMBER =
  'border-accent-400 bg-accent-400 text-ink-900 hover:border-accent-300 hover:bg-accent-300 active:border-accent-500 active:bg-accent-500';

const VARIANT: Record<ButtonVariant, string> = {
  primary: PRIMARY,
  pill: PRIMARY,
  secondary:
    'border-primary-500 bg-surface text-primary-700 hover:bg-primary-50 active:bg-primary-100',
  outline:
    'border-ink-900 bg-surface text-ink-900 hover:bg-paper active:bg-ink-100',
  dark: 'border-ink-900 bg-ink-900 text-white hover:border-ink-700 hover:bg-ink-700 active:border-ink-800 active:bg-ink-800',
  amber: AMBER,
  accent: AMBER,
  white:
    'border-white bg-white text-ink-900 hover:border-paper hover:bg-paper active:border-ink-100 active:bg-ink-100',
  ghost:
    'border-transparent bg-transparent text-primary-700 hover:bg-primary-50 active:bg-primary-100',
  link: 'border-transparent bg-transparent text-primary-700 underline underline-offset-4 hover:text-primary-800 active:text-primary-900',
  inverse:
    'border-white bg-white text-primary-700 hover:border-primary-50 hover:bg-primary-50 active:border-primary-100 active:bg-primary-100',
  'inverse-outline':
    'border-white bg-transparent text-white hover:bg-white hover:text-primary-700 active:bg-primary-50 active:text-primary-700',
};

// Every size is at least the 44 px touch target (NFR-001). md is 48 px; lg is 56 px (hero, cart, checkout).
const SIZE_HEIGHT: Record<ButtonSize, string> = {
  sm: 'min-h-touch text-sm',
  md: 'min-h-12 text-base',
  lg: 'min-h-14 text-lg',
};
const SIZE_PADDING: Record<ButtonSize, string> = {
  sm: 'px-4',
  md: 'px-6',
  lg: 'px-8',
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
    'inline-flex items-center justify-center gap-2 border-2 text-center font-bold motion-safe:transition-colors',
    pill ? 'rounded-pill' : 'rounded-choice',
    VARIANT[variant],
    SIZE_HEIGHT[size],
    // The link variant is text only, so it keeps the height and drops the box padding.
    variant === 'link' ? 'px-1' : SIZE_PADDING[size],
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
