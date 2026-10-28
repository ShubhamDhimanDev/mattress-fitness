import {cn} from '~/components/ui/cn';
import {AlertIcon, CheckIcon, InfoIcon} from '~/components/ui/Icons';

export type OrderStatusTone = 'success' | 'warning' | 'error';

const SUCCESS = new Set(['PAID', 'SUCCESS', 'FULFILLED', 'DELIVERED']);
const ERROR = new Set([
  'FAILURE',
  'ERROR',
  'CANCELLED',
  'VOIDED',
  'EXPIRED',
  'REFUNDED',
]);

/** Which colour family a Shopify status enum belongs to. Anything not known to be good or bad is "in progress". */
export function orderStatusTone(status: string): OrderStatusTone {
  const key = status.trim().toUpperCase();
  if (SUCCESS.has(key)) return 'success';
  if (ERROR.has(key)) return 'error';
  return 'warning';
}

/** "PARTIALLY_REFUNDED" becomes "Partially refunded". Display only; the enum itself is untouched. */
export function orderStatusLabel(status: string): string {
  const words = status.trim().toLowerCase().replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const TONE: Record<OrderStatusTone, string> = {
  success: 'bg-success-bg text-success-fg',
  warning: 'bg-warning-bg text-warning-fg',
  error: 'bg-error-bg text-error-fg',
};

/**
 * A status as a chip with an icon and the words, so colour is never the only cue (WCAG 1.4.1). The icon is
 * decorative; the label carries the meaning.
 */
export function OrderStatusChip({
  status,
  label,
  className,
}: {
  status: string;
  /** Text to show when the caller already has a readable label (the guest lookup does). */
  label?: string;
  className?: string;
}) {
  const tone = orderStatusTone(status);
  const Icon =
    tone === 'success' ? CheckIcon : tone === 'error' ? AlertIcon : InfoIcon;
  return (
    <span
      className={cn(
        'inline-flex w-fit items-center gap-1.5 rounded-pill px-3 py-1 text-caption font-bold',
        TONE[tone],
        className,
      )}
    >
      <Icon className="size-4" />
      {label ?? orderStatusLabel(status)}
    </span>
  );
}
