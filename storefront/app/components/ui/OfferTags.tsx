import {cn} from '~/components/ui/cn';
import {OFFER_TAG_LABELS, type OfferTag} from '~/lib/offers/card-tags';

// The red outlined tags under a product's title and on its card (owner request 2026-11-11: "Save $200 Today!", "Free Adjustable
// Base!!", "Free Gift with Purchase!!"). Red text on white is primary-700 (7.83 : 4.5), so it passes at this size. The owner asked
// for red here, so these do not follow the amber sale-badge rule of Badge.tsx. Whether a tag shows is decided from Shopify
// data by the caller (a sale needs compare-at above price; a gift needs an active Shopify discount).

export type OfferTagItem = {readonly key: string; readonly label: string};

/** The sale tag first, then the gift and base tags, from the labels already decided by the caller. */
export function offerTagItems(
  saleLabel: string | null,
  offerTags: readonly OfferTag[],
): OfferTagItem[] {
  return [
    ...(saleLabel ? [{key: 'sale', label: saleLabel}] : []),
    ...offerTags.map((tag) => ({key: tag, label: OFFER_TAG_LABELS[tag]})),
  ];
}

export function OfferTags({
  items,
  className,
}: {
  items: readonly OfferTagItem[];
  className?: string;
}) {
  if (items.length === 0) return null;
  return (
    <ul className={cn('flex flex-wrap gap-2', className)}>
      {items.map((item) => (
        <li
          key={item.key}
          className="rounded-sm border border-primary-600 px-3 py-1 text-base leading-6 font-extrabold text-primary-700"
        >
          {item.label}
        </li>
      ))}
    </ul>
  );
}
