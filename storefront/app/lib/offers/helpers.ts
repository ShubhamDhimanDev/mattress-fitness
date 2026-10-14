// Small, dependency-free helpers shared by the offer rules. Shopify and CMS values are untrusted strings,
// so lookups never touch the prototype chain and sizes are compared in one normalised form.

/** "  Cal   King " and "cal king" are the same size. Empty or non-string input has no size. */
export function normalizeSize(size: unknown): string | null {
  if (typeof size !== 'string') return null;
  const normalized = size.trim().replace(/\s+/g, ' ').toLowerCase();
  return normalized === '' ? null : normalized;
}

/**
 * Size -> id map keyed by the normalised size, keeping the first entry for a repeated size. A Map (not an
 * object lookup) so a size such as "constructor" or "__proto__" can never resolve to an inherited member.
 */
export function sizeMap(
  record: Readonly<Record<string, string>>,
): Map<string, {readonly size: string; readonly id: string}> {
  const map = new Map<string, {readonly size: string; readonly id: string}>();
  for (const [size, id] of Object.entries(record)) {
    const key = normalizeSize(size);
    if (key === null || typeof id !== 'string' || id === '') continue;
    if (!map.has(key)) map.set(key, {size: size.trim(), id});
  }
  return map;
}

/** A usable line quantity is a positive safe integer; anything else makes the cart malformed. */
export function isValidQuantity(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

/** A usable limit is a non-negative safe integer; anything else reads as "none allowed". */
export function limitOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}
