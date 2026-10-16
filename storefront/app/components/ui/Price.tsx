import {
  formatCents,
  formatMoney,
  toCents,
  type MoneyV2Like,
} from '~/lib/format';
import {cn} from '~/components/ui/cn';

export type PriceSize = 'sm' | 'md' | 'lg';

type PriceProps = {
  /** The price the shopper pays, exactly as Shopify returned it. */
  price: MoneyV2Like;
  /** Shopify's compare-at price. Only shown, and only counts as a sale, when it is above `price`. */
  compareAt?: MoneyV2Like | null;
  /** Small label before the amount, e.g. "From". */
  prefix?: string;
  /** Adds "Save $200 (20%)" under a sale price. */
  showSavings?: boolean;
  /** Drops ".00" from whole-dollar amounts. */
  compact?: boolean;
  size?: PriceSize;
  className?: string;
};

export type PriceView =
  | {kind: 'regular'; price: string}
  | {
      kind: 'sale';
      price: string;
      compareAt: string;
      savings: string;
      percentOff: number;
    };

/**
 * Pure view model. All arithmetic is on integer cents, never on floats or formatted text. Returns null
 * for data the money helpers reject (bad amount, non-USD) so a bad record cannot take the page down.
 */
export function getPriceView(
  price: MoneyV2Like,
  compareAt: MoneyV2Like | null | undefined,
  compact = false,
): PriceView | null {
  try {
    const priceCents = toCents(price.amount);
    const regular = {
      kind: 'regular',
      price: formatMoney(price, {compact}),
    } as const;
    if (!compareAt) return regular;

    const compareCents = toCents(compareAt.amount);
    formatMoney(compareAt); // validates the currency
    if (compareCents <= priceCents) return regular;

    const savingsCents = compareCents - priceCents;
    return {
      kind: 'sale',
      price: regular.price,
      compareAt: formatMoney(compareAt, {compact}),
      savings: formatCents(savingsCents, {compact}),
      percentOff: Math.round((savingsCents * 100) / compareCents),
    };
  } catch (error) {
    console.error(
      'Price: could not display an amount:',
      error instanceof Error ? error.message : 'unknown error',
    );
    return null;
  }
}

const SIZE: Record<PriceSize, {price: string; other: string}> = {
  sm: {price: 'text-base', other: 'text-sm'},
  md: {price: 'text-xl', other: 'text-base'},
  lg: {price: 'text-3xl', other: 'text-lg'},
};

export function Price({
  price,
  compareAt,
  prefix,
  showSavings = false,
  compact = false,
  size = 'md',
  className,
}: PriceProps) {
  const view = getPriceView(price, compareAt, compact);
  if (!view) return null;
  const sizes = SIZE[size];

  return (
    <div
      className={cn('flex flex-wrap items-baseline gap-x-2 gap-y-1', className)}
    >
      {prefix ? (
        <span className={cn('font-bold text-fg-muted uppercase', sizes.other)}>
          {prefix}
        </span>
      ) : null}
      <span
        className={cn(
          'font-bold',
          sizes.price,
          view.kind === 'sale' ? 'text-error-fg' : 'text-fg',
        )}
      >
        {view.kind === 'sale' ? (
          <span className="sr-only">Sale price: </span>
        ) : null}
        {view.price}
      </span>
      {view.kind === 'sale' ? (
        <>
          <s className={cn('text-fg-muted', sizes.other)}>
            <span className="sr-only">Original price: </span>
            {view.compareAt}
          </s>
          {showSavings ? (
            <span className={cn('font-bold text-error-fg', sizes.other)}>
              Save {view.savings} ({view.percentOff}%)
            </span>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
