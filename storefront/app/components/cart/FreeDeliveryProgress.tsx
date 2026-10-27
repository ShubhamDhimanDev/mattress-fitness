import {freeDeliveryView} from '~/components/cart/cart-view';
import {Card} from '~/components/ui/Card';
import {cn} from '~/components/ui/cn';
import {TruckIcon} from '~/components/ui/Icons';
import {ProgressBar} from '~/components/ui/ProgressBar';
import type {FreeDeliveryProgress as Progress} from '~/lib/offers/types';

/**
 * Free-delivery progress (REQ-CART-004, CLR-009). The numbers come from the offer engine (Shopify's subtotal
 * against the admin threshold); this only draws them. Renders nothing when the message is switched off. The
 * text is the accessible value of the bar and is announced politely when it changes. On the page it is a card
 * with the threshold named at the right; in the drawer it is a strip across the top.
 */
export function FreeDeliveryProgress({
  progress,
  layout = 'page',
  className,
}: {
  progress: Progress;
  layout?: 'page' | 'aside';
  className?: string;
}) {
  const view = freeDeliveryView(progress);
  if (view.status === 'off') return null;
  const reached = view.status === 'reached';
  const aside = layout === 'aside';

  // Drawer: the message centred over a thin bar, no icon tile (one row less of chrome in a narrow panel).
  if (aside) {
    return (
      <div
        className={cn('border-b border-line px-4 py-3 text-center', className)}
      >
        <p role="status" className="text-sm font-semibold text-fg">
          {view.message}
        </p>
        <ProgressBar
          className="mt-2"
          size="sm"
          value={view.percent}
          label="Progress to free delivery"
          valueText={view.message}
          tone={reached ? 'success' : 'red'}
        />
      </div>
    );
  }

  const body = (
    <>
      <div className="flex items-center gap-3">
        <span
          className={cn(
            'flex shrink-0 items-center justify-center',
            'size-11 rounded-choice',
            reached ? 'bg-success-solid text-white' : 'bg-paper text-fg',
          )}
        >
          <TruckIcon className="size-6" />
        </span>
        <p
          role="status"
          className="min-w-0 flex-1 text-base font-bold text-fg md:text-lg"
        >
          {view.message}
        </p>
        {!reached ? (
          <span className="hidden shrink-0 text-caption font-semibold text-fg-muted md:inline">
            Free over {view.threshold}
          </span>
        ) : null}
      </div>
      <ProgressBar
        className="mt-3 md:mt-4"
        value={view.percent}
        label="Progress to free delivery"
        valueText={view.message}
        tone={reached ? 'success' : 'red'}
      />
    </>
  );

  return <Card className={className}>{body}</Card>;
}
