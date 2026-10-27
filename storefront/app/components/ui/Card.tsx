import {
  createElement,
  forwardRef,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import {cn} from '~/components/ui/cn';

/**
 *  - `flat`: white, 1 px warm hairline.
 *  - `raised`: the same plus the soft lift shadow (finder card, cart summary).
 *  - `dashed-amber`: the free-gift look, a 2 px dashed amber border on a pale amber tint.
 *  - `tinted`: warm paper, no border (a strip inside a card, a quiet panel on white).
 */
export type CardVariant = 'flat' | 'raised' | 'dashed-amber' | 'tinted';
export type CardPadding = 'none' | 'sm' | 'md';
export type CardElement = 'div' | 'section' | 'article' | 'aside' | 'li';

type CardProps = {
  variant?: CardVariant;
  /** `md` is 16 px on a phone and 24 px from `md` up; `sm` is 16 px; `none` for a card that holds a full-bleed image. */
  padding?: CardPadding;
  /** The element to render. Use `li` inside a list, `section` or `article` when the card has a heading. */
  as?: CardElement;
  /** The card is a hover target (a product card, a linked tile): it lifts on hover. Hover only decorates; it never hides anything. */
  interactive?: boolean;
  children: ReactNode;
  className?: string;
} & Pick<
  HTMLAttributes<HTMLElement>,
  | 'id'
  | 'role'
  | 'tabIndex'
  | 'aria-label'
  | 'aria-labelledby'
  | 'aria-describedby'
>;

const VARIANT: Record<CardVariant, string> = {
  flat: 'border border-line bg-surface',
  raised: 'border border-line bg-surface shadow-lift',
  'dashed-amber': 'border-2 border-dashed border-accent-400 bg-accent-50',
  tinted: 'border border-transparent bg-paper',
};

const PADDING: Record<CardPadding, string> = {
  none: '',
  sm: 'p-4',
  md: 'p-4 md:p-6',
};

/** Class names for a card-looking element that cannot be a `Card` (a link that is the whole card, for example). */
export function cardStyles({
  variant = 'flat',
  padding = 'md',
  interactive = false,
}: Pick<CardProps, 'variant' | 'padding' | 'interactive'> = {}): string {
  return cn(
    'rounded-card',
    VARIANT[variant],
    PADDING[padding],
    interactive &&
      'motion-safe:transition-[box-shadow,translate] hover:shadow-lift motion-safe:hover:-translate-y-0.5',
  );
}

export const Card = forwardRef<HTMLElement, CardProps>(function Card(
  {
    variant = 'flat',
    padding = 'md',
    as = 'div',
    interactive = false,
    children,
    className,
    ...rest
  },
  ref,
) {
  return createElement(
    as,
    {
      ...rest,
      ref,
      className: cn(cardStyles({variant, padding, interactive}), className),
    },
    children,
  );
});
