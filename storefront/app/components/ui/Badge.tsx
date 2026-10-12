import type {ReactNode} from 'react';
import {cn} from '~/components/ui/cn';
import {GiftIcon, TagIcon} from '~/components/ui/Icons';

export type BadgeVariant = 'sale' | 'gift' | 'new' | 'neutral';

type BadgeProps = {
  variant?: BadgeVariant;
  children: ReactNode;
  className?: string;
};

// Every pair clears 4.5:1 (see the palette notes in styles/tailwind.css). A badge always carries text, so
// meaning is never colour-only. Whether a badge shows at all is decided from Shopify data by the caller
// (a sale badge needs compare-at above price), never here.
const VARIANT: Record<BadgeVariant, string> = {
  sale: 'bg-error-solid text-white',
  gift: 'border border-primary-700 bg-primary-50 text-primary-800',
  new: 'bg-ink-900 text-white',
  neutral: 'bg-ink-100 text-ink-700',
};

export function Badge({variant = 'neutral', children, className}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-choice px-2 py-1 text-xs leading-4 font-bold tracking-wide uppercase',
        VARIANT[variant],
        className,
      )}
    >
      {variant === 'gift' ? <GiftIcon className="size-4" /> : null}
      {variant === 'sale' ? <TagIcon className="size-4" /> : null}
      {children}
    </span>
  );
}
