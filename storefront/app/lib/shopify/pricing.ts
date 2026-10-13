// Display-only price text derived from Shopify's own price and compare-at price (integer cents).

import {centsOf} from '~/lib/shopify/common';
import {formatCents, type MoneyV2Like} from '~/lib/money';

/** "Save $200 (20%)" when compare-at is above price, otherwise null. */
export function savingsLabel(
  price: MoneyV2Like,
  compareAt: MoneyV2Like | null,
): string | null {
  const priceCents = centsOf(price);
  const compareCents = centsOf(compareAt);
  if (priceCents === null || compareCents === null) return null;
  if (compareCents <= priceCents) return null;
  const saved = compareCents - priceCents;
  const percent = Math.round((saved * 100) / compareCents);
  return `Save ${formatCents(saved, {compact: true})} (${percent}%)`;
}
