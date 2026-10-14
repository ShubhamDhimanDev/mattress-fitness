// The single home of every attribute value list the storefront knows about
// (SOW section 4 and 8, SHOPIFY_DATA_MODEL "Product"). Filters, the quiz, the
// comparison table and the fixtures all read these lists, so adding a value is a
// one-file change. The Shopify metafield definitions and the variant option must
// use exactly these labels (import checklist, V-04).

import {hasControlCharacter} from '~/lib/catalog/text';

export const SIZES = [
  'Twin',
  'Twin XL',
  'Full',
  'Queen',
  'King',
  'California King',
  'Split California King',
] as const;

export const COMFORT_LEVELS = [
  'Ultra Plush',
  'Plush',
  'Medium',
  'Firm',
  'Extra Firm',
] as const;

export const MATTRESS_TYPES = [
  'Memory Foam',
  'Hybrid',
  'Innerspring',
  'Foam',
  'Latex',
] as const;

export const BENEFITS = [
  'Cooling',
  'Pressure Relief',
  'Motion Separation',
  'Back Support',
  'Eco-Friendly',
] as const;

export const SLEEP_POSITIONS = ['Back', 'Side', 'Stomach'] as const;

export type Size = (typeof SIZES)[number];
export type ComfortLevel = (typeof COMFORT_LEVELS)[number];
export type MattressType = (typeof MATTRESS_TYPES)[number];
export type Benefit = (typeof BENEFITS)[number];
export type SleepPosition = (typeof SLEEP_POSITIONS)[number];

/** The variant option name the size selector and the size filter use. */
export const SIZE_OPTION_NAME = 'Size';

/** Product metafield namespace and keys (SHOPIFY_DATA_MODEL "Product"). */
export const PRODUCT_METAFIELD_NAMESPACE = 'custom';
export const PRODUCT_METAFIELD_KEYS = {
  comfortLevel: 'comfort_level',
  mattressType: 'mattress_type',
  sleepPositions: 'sleep_positions',
  benefits: 'benefits',
  productLine: 'product_line',
  heightInches: 'height_inches',
  compareGroup: 'compare_group',
} as const;

/**
 * Lowercase, hyphenated form used to compare labels and to put fixed values in
 * URLs ("Ultra Plush" and "ultra-plush" and "Ultra  plush" all match).
 */
export function toSlug(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Type guard that works for any readonly list of string literals. */
export function isOneOf<T extends string>(
  list: readonly T[],
  value: unknown,
): value is T {
  return list.some((item) => item === value);
}

/**
 * Maps loosely written input ("memory foam", "Memory-Foam") to the canonical
 * label, or null when it is not in the list. Used for every value that arrives
 * from a URL, a metafield or admin-managed configuration.
 */
export function matchCanonical<T extends string>(
  list: readonly T[],
  raw: unknown,
): T | null {
  if (typeof raw !== 'string' || raw.length > 80) return null;
  // Punctuation and spacing are forgiven, control characters are not.
  if (hasControlCharacter(raw)) return null;
  const slug = toSlug(raw);
  if (slug === '') return null;
  return list.find((item) => toSlug(item) === slug) ?? null;
}

export function isSize(value: unknown): value is Size {
  return isOneOf(SIZES, value);
}

export function sizeIndex(size: Size): number {
  return SIZES.indexOf(size);
}

/** Position in a list, for stable ordering; unknown values sort last. */
export function indexIn(list: readonly string[], value: string): number {
  const index = list.indexOf(value);
  return index === -1 ? list.length : index;
}
