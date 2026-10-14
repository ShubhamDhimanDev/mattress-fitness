// Integer-cents guards shared by the delivery and offer modules (NFR-008: USD only, money in minor units).
// Amounts reach this code from Shopify cart cost and CMS settings; anything that is not a plain
// non-negative integer is treated as unusable instead of being rounded into a different price.

export function isValidCents(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Invalid input becomes 0. Use only for amounts where "nothing" is the conservative reading (a subtotal). */
export function safeCents(value: unknown): number {
  return isValidCents(value) ? value : 0;
}
