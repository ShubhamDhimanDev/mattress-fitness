// Merging a discount code from a /discount/:code link into the codes the cart already has (P-L4).
// Shopify's `cartDiscountCodesUpdate` replaces the whole list, so sending only the new code would silently
// remove a code the shopper had applied. Pure, so it is unit-tested.

/** Shopify allows several codes on a cart; we keep the same cap as the cart action (`validateDiscountCodes`). */
export const MAX_DISCOUNT_CODES = 5;

/**
 * The existing codes in order, then the new one, without repeats (codes are case-insensitive in Shopify,
 * the first spelling wins). Over the cap, the oldest codes are dropped so the code the shopper just
 * followed a link for is always applied.
 */
export function mergeDiscountCodes(
  existing: readonly string[],
  incoming: string,
): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const code of [...existing, incoming]) {
    const key = code.trim().toLowerCase();
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    merged.push(code.trim());
  }
  return merged.slice(-MAX_DISCOUNT_CODES);
}
