import type {ReactNode} from 'react';
import {cn} from '~/components/ui/cn';
import {GiftIcon, TagIcon} from '~/components/ui/Icons';

export type BadgeVariant = 'sale' | 'gift' | 'new' | 'neutral';

/** `tag` is the larger, sentence-case line under a product card image (a long offer must stay readable). */
export type BadgeSize = 'label' | 'tag';

type BadgeProps = {
  variant?: BadgeVariant;
  size?: BadgeSize;
  children: ReactNode;
  className?: string;
};

// Every pair clears 4.5:1 (see the palette notes in styles/tailwind.css, enforced by tests/unit/ui/contrast.test.ts).
// A badge always carries text, so meaning is never colour-only. A sale is amber with near-black text and never
// brand red, so a saving cannot be mistaken for the brand or for an error (UXD-14). Whether a badge shows at all is
// decided from Shopify data by the caller (a sale badge needs compare-at above price), never here.
const VARIANT: Record<BadgeVariant, string> = {
  sale: 'bg-accent-400 text-ink-900',
  gift: 'border border-primary-500 bg-surface text-primary-700',
  new: 'bg-ink-900 text-white',
  neutral: 'bg-ink-100 text-ink-700',
};

const SIZE: Record<BadgeSize, string> = {
  label: 'text-xs leading-4 tracking-wide uppercase',
  tag: 'text-sm leading-5 normal-case',
};

export function Badge({
  variant = 'neutral',
  size = 'label',
  children,
  className,
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-choice px-2 py-1 font-bold',
        SIZE[size],
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
