import {freeDeliveryMessage} from '~/lib/offers/free-delivery';
import type {FreeDeliveryProgress as Progress} from '~/lib/offers/types';

/**
 * Free-delivery progress (REQ-CART-004, CLR-009). The numbers come from the offer engine (Shopify's subtotal
 * against the admin threshold); this only draws them. Renders nothing when the message is switched off. The
 * text is the accessible value of the bar and is announced politely when it changes.
 */
export function FreeDeliveryProgress({progress}: {progress: Progress}) {
  const message = freeDeliveryMessage(progress);
  if (!progress.enabled || message === null) return null;

  return (
    <div className="flex flex-col gap-2">
      <p role="status" className="text-sm font-bold text-fg">
        {message}
      </p>
      <div
        role="progressbar"
        aria-label="Progress to free delivery"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress.percent}
        aria-valuetext={message}
        className="h-2 w-full overflow-hidden rounded-pill bg-ink-200"
      >
        <div
          className="h-full rounded-pill bg-primary-700 motion-safe:transition-[width]"
          style={{width: `${progress.percent}%`}}
        />
      </div>
    </div>
  );
}
