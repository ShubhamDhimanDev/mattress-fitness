import {useId} from 'react';
import {OrderStatusChip} from '~/components/orders/OrderStatusChip';
import {Card} from '~/components/ui/Card';
import type {GuestOrderView} from '~/lib/orders/guest-lookup';

/**
 * Date only, in UTC, so the server render and the browser agree. An order placed late in the evening in the store's
 * own time zone can show the next day; the order email carries the exact time.
 */
export function formatPlacedDate(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'long',
    timeZone: 'UTC',
  }).format(parsed);
}

/** Stable keys for lists that can repeat a value: the value plus how many times it has appeared. */
function withKeys<T>(
  list: readonly T[],
  describe: (item: T) => string,
): {key: string; item: T}[] {
  const seen = new Map<string, number>();
  return list.map((item) => {
    const base = describe(item);
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return {key: `${base}#${count}`, item};
  });
}

/**
 * What a guest sees after a match: the order name, date, status, items and tracking. All text was cleaned by the
 * lookup library and is rendered as text; the only link is an https tracking URL, opened without sending the page
 * address on (it can carry nothing personal, but the carrier needs none of it).
 */
export function GuestOrderSummary({order}: {order: GuestOrderView}) {
  const headingId = useId();
  const placed = formatPlacedDate(order.placedAt);
  return (
    <Card
      as="section"
      variant="raised"
      aria-labelledby={headingId}
      className="flex flex-col gap-4"
    >
      <h2 id={headingId} className="type-display text-title">
        Order {order.orderName}
      </h2>
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-base">
        {placed !== '' ? (
          <>
            <dt className="font-bold">Placed</dt>
            <dd>{placed}</dd>
          </>
        ) : null}
        <dt className="font-bold">Status</dt>
        <dd>
          <OrderStatusChip status={order.status} label={order.statusLabel} />
        </dd>
      </dl>

      <div className="flex flex-col gap-1">
        <h3 className="text-lg font-extrabold">Items</h3>
        <ul className="list-disc pl-5">
          {withKeys(order.items, (item) => item.title).map(({key, item}) => (
            <li key={key}>
              {item.title} (quantity {item.quantity})
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-lg font-extrabold">Shipping</h3>
        {order.shipments.length === 0 ? (
          <p className="text-fg-muted">
            No tracking details yet. They appear here once your order has
            shipped.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {withKeys(order.shipments, (s) => s.trackingNumber ?? '').map(
              ({key, item: shipment}) => (
                <li
                  key={key}
                  className="flex flex-col gap-0.5 rounded-choice bg-paper p-3"
                >
                  {shipment.statusLabel !== null ? (
                    <span className="font-bold">{shipment.statusLabel}</span>
                  ) : null}
                  {shipment.trackingCompany !== null ||
                  shipment.trackingNumber !== null ? (
                    <span>
                      {[shipment.trackingCompany, shipment.trackingNumber]
                        .filter((part): part is string => part !== null)
                        .join(' ')}
                    </span>
                  ) : null}
                  {shipment.trackingUrl !== null ? (
                    <a
                      href={shipment.trackingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-touch items-center font-bold text-primary-700 underline underline-offset-2"
                    >
                      Track this package
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  ) : null}
                </li>
              ),
            )}
          </ul>
        )}
      </div>
    </Card>
  );
}
