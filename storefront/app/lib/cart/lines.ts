// Display helpers for cart lines. Line attributes ("properties") are shown to the shopper except those
// whose key starts with an underscore, the Shopify convention for hidden properties; the offer engine and
// the Extend link attributes use that convention so they never clutter the cart.

import {cleanText} from '~/lib/catalog/text';
import {formatCents, toCents} from '~/lib/money';

export type LineProperty = {readonly label: string; readonly value: string};

type AttributeSource = {readonly key: string; readonly value?: string | null};

const MAX_PROPERTIES = 10;

export function visibleLineProperties(
  attributes: readonly AttributeSource[] | null | undefined,
): LineProperty[] {
  const properties: LineProperty[] = [];
  for (const attribute of attributes ?? []) {
    if (attribute.key.startsWith('_')) continue;
    const label = cleanText(attribute.key).slice(0, 60);
    const value = cleanText(attribute.value ?? '').slice(0, 200);
    if (label !== '' && value !== '') properties.push({label, value});
  }
  return properties.slice(0, MAX_PROPERTIES);
}

/** Options that carry information: a lone "Default Title" option says nothing and is hidden. */
export function visibleOptions<T extends {name: string; value: string}>(
  options: readonly T[],
): T[] {
  return options.filter(
    (option) => !(option.name === 'Title' && option.value === 'Default Title'),
  );
}

export type LinePromotion = {
  /** The name of the discount Shopify applied to this line (an automatic discount's title). */
  readonly title: string;
  /** What Shopify took off the line, formatted as US dollars. */
  readonly amount: string;
};

type AllocationSource = {
  readonly targetType?: string;
  readonly discountedAmount?: {readonly amount: string} | null;
  readonly title?: string | null;
};

/**
 * Promotions Shopify applied to a line, for display (REQ-PROMO-001, REQ-PROMO-002: "gift at $0 labelled with the
 * promotion name", "saving shown as a discount on the items"). Only line-level allocations that carry a name and take
 * something off are listed; the amounts are Shopify's, shown as returned. An optimistic line has no allocations.
 */
export function linePromotions(
  allocations: readonly AllocationSource[] | null | undefined,
): LinePromotion[] {
  // One entry per title (the amounts of equal titles are added), so the title is a unique list key.
  const centsByTitle = new Map<string, number>();
  for (const allocation of allocations ?? []) {
    if (allocation.targetType !== 'LINE_ITEM') continue;
    const title = cleanText(allocation.title ?? '').slice(0, 120);
    const amount = allocation.discountedAmount?.amount;
    if (title === '' || amount === undefined) continue;
    try {
      const cents = toCents(amount);
      if (cents > 0)
        centsByTitle.set(title, (centsByTitle.get(title) ?? 0) + cents);
    } catch {
      // An amount that is not a plain USD figure is dropped, not shown wrong.
      continue;
    }
  }
  return [...centsByTitle]
    .slice(0, 5)
    .map(([title, cents]) => ({title, amount: formatCents(cents)}));
}
