// Product comparison (REQ-CMP-001): the table model, the selection rules and the
// "similar products" chooser. Pure functions over catalog products; the route
// and components only render what these return. Prices are integer cents read
// from Shopify data, never from the browser.

import type {Size} from '~/lib/catalog/attributes';
import {sizeIndex} from '~/lib/catalog/attributes';
import {
  availableVariants,
  isOnSale,
  isSoldOut,
  lowestAvailablePriceCents,
  variantForSize,
} from '~/lib/catalog/pricing';
import type {CatalogProduct, ProductImage} from '~/lib/catalog/types';
import {formatCents} from '~/lib/money';

export const COMPARE_MAX_PRODUCTS = 4;
export const COMPARE_STORAGE_KEY = 'compare.selection';
export const SIMILAR_PRODUCTS_DEFAULT_LIMIT = 4;

// --- Selection rules ---

export type AddToComparisonResult =
  | {readonly status: 'ok'; readonly selection: readonly CatalogProduct[]}
  | {
      readonly status: 'rejected';
      readonly reason: 'full' | 'duplicate' | 'different_category';
      readonly selection: readonly CatalogProduct[];
    };

/** Products are the same category when their product type matches (case-insensitive). */
function sameCategory(a: CatalogProduct, b: CatalogProduct): boolean {
  return (
    a.productType.trim().toLowerCase() === b.productType.trim().toLowerCase()
  );
}

/**
 * Adds a product when the rules allow: at most four, no duplicates, and the same
 * category as what is already selected (a mattress and a bed frame have no
 * attributes in common worth comparing). A rejection says why so the UI can show
 * a specific message; the selection is returned unchanged.
 */
export function addToComparison(
  selection: readonly CatalogProduct[],
  candidate: CatalogProduct,
): AddToComparisonResult {
  if (selection.some((item) => item.handle === candidate.handle)) {
    return {status: 'rejected', reason: 'duplicate', selection};
  }
  if (selection.length >= COMPARE_MAX_PRODUCTS) {
    return {status: 'rejected', reason: 'full', selection};
  }
  const first = selection[0];
  if (first && !sameCategory(first, candidate)) {
    return {status: 'rejected', reason: 'different_category', selection};
  }
  return {status: 'ok', selection: [...selection, candidate]};
}

export function removeFromComparison(
  selection: readonly CatalogProduct[],
  handle: string,
): readonly CatalogProduct[] {
  return selection.filter((item) => item.handle !== handle);
}

// --- Persisting the selection for the session (handles only) ---

const HANDLE_PATTERN = /^[a-z0-9][a-z0-9-]{0,254}$/;
const MAX_SERIALIZED_LENGTH = 2000;

/** Handles only: details are read again from Shopify, so a stale price is impossible. */
export function serializeComparison(
  selection: readonly CatalogProduct[],
): string {
  return JSON.stringify(selection.map((item) => item.handle));
}

/**
 * Reads stored handles. Anything malformed is dropped, duplicates removed and
 * the list is capped; never throws. The stored value is untrusted.
 */
export function parseComparisonHandles(raw: unknown): readonly string[] {
  if (typeof raw !== 'string' || raw.length > MAX_SERIALIZED_LENGTH) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const handles = new Set<string>();
  for (const item of parsed) {
    if (typeof item === 'string' && HANDLE_PATTERN.test(item))
      handles.add(item);
    if (handles.size >= COMPARE_MAX_PRODUCTS) break;
  }
  return [...handles];
}

/**
 * Turns stored handles and freshly loaded catalog products into a valid
 * selection: unknown handles are dropped (a product may have been unpublished)
 * and the same rules as `addToComparison` apply in order.
 */
export function resolveComparison(
  handles: readonly string[],
  catalog: readonly CatalogProduct[],
): readonly CatalogProduct[] {
  const byHandle = new Map(catalog.map((product) => [product.handle, product]));
  let selection: readonly CatalogProduct[] = [];
  for (const handle of handles) {
    const product = byHandle.get(handle);
    if (!product) continue;
    const result = addToComparison(selection, product);
    if (result.status === 'ok') selection = result.selection;
  }
  return selection;
}

// --- Table model ---

export const COMPARISON_ROW_KEYS = [
  'rating',
  'price',
  'comfort',
  'type',
  'height',
  'benefits',
] as const;
export type ComparisonRowKey = (typeof COMPARISON_ROW_KEYS)[number];

const ROW_LABELS: Readonly<Record<ComparisonRowKey, string>> = {
  rating: 'Rating',
  price: 'Price',
  comfort: 'Comfort level',
  type: 'Mattress type',
  height: 'Height',
  benefits: 'Benefits',
};

export type ComparisonCell =
  | {readonly kind: 'text'; readonly text: string}
  | {readonly kind: 'list'; readonly items: readonly string[]}
  | {
      readonly kind: 'rating';
      readonly average: number;
      readonly count: number;
      readonly text: string;
    }
  | {
      readonly kind: 'price';
      readonly cents: number;
      readonly compareAtCents: number | null;
      /** True for a "From $" price (no size was chosen). */
      readonly from: boolean;
      readonly size: Size | null;
      readonly text: string;
    }
  | {readonly kind: 'unavailable'; readonly text: string}
  | {readonly kind: 'missing'; readonly text: string};

export type ComparisonRow = {
  readonly key: ComparisonRowKey;
  readonly label: string;
  /** One cell per product, in the same order as `columns`. */
  readonly cells: readonly ComparisonCell[];
  /** False when every cell is equal; lets the UI offer "show differences only". */
  readonly differs: boolean;
};

export type ComparisonColumn = {
  readonly handle: string;
  readonly title: string;
  readonly brand: string;
  readonly image: ProductImage | null;
};

export type ComparisonTable = {
  readonly columns: readonly ComparisonColumn[];
  readonly rows: readonly ComparisonRow[];
  readonly size: Size | null;
};

function priceCell(product: CatalogProduct, size: Size | null): ComparisonCell {
  if (size !== null) {
    const variant = variantForSize(product, size);
    if (!variant || !variant.available) {
      return {kind: 'unavailable', text: `Not available in ${size}`};
    }
    return {
      kind: 'price',
      cents: variant.priceCents,
      compareAtCents: isOnSale(variant) ? variant.compareAtCents : null,
      from: false,
      size,
      text: formatCents(variant.priceCents, {compact: true}),
    };
  }
  const lowest = lowestAvailablePriceCents(product);
  if (lowest === null) return {kind: 'unavailable', text: 'Sold out'};
  // Sale information is shown only when the cheapest available size is on sale.
  const cheapest = availableVariants(product).find(
    (v) => v.priceCents === lowest,
  );
  return {
    kind: 'price',
    cents: lowest,
    compareAtCents:
      cheapest && isOnSale(cheapest) ? cheapest.compareAtCents : null,
    from: true,
    size: null,
    text: `From ${formatCents(lowest, {compact: true})}`,
  };
}

function ratingCell(product: CatalogProduct): ComparisonCell {
  const rating = product.rating;
  if (!rating) return {kind: 'missing', text: 'No reviews yet'};
  return {
    kind: 'rating',
    average: rating.average,
    count: rating.count,
    text: `${rating.average.toFixed(1)} out of 5 (${rating.count} reviews)`,
  };
}

function textOrMissing(value: string | null): ComparisonCell {
  return value === null
    ? {kind: 'missing', text: 'Not specified'}
    : {kind: 'text', text: value};
}

function heightCell(product: CatalogProduct): ComparisonCell {
  const height = product.heightInches;
  if (height === null || !Number.isFinite(height) || height <= 0) {
    return {kind: 'missing', text: 'Not specified'};
  }
  // Whole inches print without a decimal point: 11", 11.5".
  return {
    kind: 'text',
    text: `${Number.isInteger(height) ? height : height.toFixed(1)}"`,
  };
}

function cellFor(
  key: ComparisonRowKey,
  product: CatalogProduct,
  size: Size | null,
): ComparisonCell {
  switch (key) {
    case 'rating':
      return ratingCell(product);
    case 'price':
      return priceCell(product, size);
    case 'comfort':
      return textOrMissing(product.comfortLevel);
    case 'type':
      return textOrMissing(product.mattressType);
    case 'height':
      return heightCell(product);
    case 'benefits':
      return product.benefits.length === 0
        ? {kind: 'missing', text: 'None listed'}
        : {kind: 'list', items: product.benefits};
    default: {
      const unreachable: never = key;
      return unreachable;
    }
  }
}

function differs(cells: readonly ComparisonCell[]): boolean {
  const first = JSON.stringify(cells[0]);
  return cells.some((cell) => JSON.stringify(cell) !== first);
}

/**
 * The comparison table for a selection. Rows follow the SOW order (rating,
 * price, comfort, type, height, benefits). The rating row is left out entirely
 * when no product has a rating, which is the state while there is no reviews
 * source (Q-011). `size` shows each product's price in that size; without it the
 * price row shows "From $" the lowest available size.
 */
export function buildComparisonTable(
  products: readonly CatalogProduct[],
  options: {readonly size?: Size | null} = {},
): ComparisonTable {
  const size = options.size ?? null;
  const hasAnyRating = products.some((product) => product.rating !== null);
  const rows = COMPARISON_ROW_KEYS.filter(
    (key) => key !== 'rating' || hasAnyRating,
  ).map((key): ComparisonRow => {
    const cells = products.map((product) => cellFor(key, product, size));
    return {key, label: ROW_LABELS[key], cells, differs: differs(cells)};
  });
  return {
    columns: products.map((product) => ({
      handle: product.handle,
      title: product.title,
      brand: product.brand,
      image: product.images[0] ?? null,
    })),
    rows,
    size,
  };
}

/** Sizes every selected product is sold in, in the standard order; offered as the table's size picker. */
export function commonSizes(
  products: readonly CatalogProduct[],
): readonly Size[] {
  const [first, ...rest] = products;
  if (!first) return [];
  return first.variants
    .map((variant) => variant.size)
    .filter((size) => rest.every((product) => variantForSize(product, size)))
    .sort((a, b) => sizeIndex(a) - sizeIndex(b));
}

// --- Similar products ---

/** The price used to rank closeness: the chosen size when sold, otherwise the lowest available. */
function referencePriceCents(
  product: CatalogProduct,
  size: Size | null,
): number | null {
  if (size !== null) {
    const variant = variantForSize(product, size);
    if (variant?.available) return variant.priceCents;
  }
  return lowestAvailablePriceCents(product);
}

function sharedAttributeCount(a: CatalogProduct, b: CatalogProduct): number {
  let count = 0;
  if (a.mattressType !== null && a.mattressType === b.mattressType) count += 1;
  if (a.comfortLevel !== null && a.comfortLevel === b.comfortLevel) count += 1;
  if (a.compareGroup !== null && a.compareGroup === b.compareGroup) count += 1;
  return count;
}

/**
 * Products worth comparing with `target`: same category, in stock, and sharing
 * the mattress type, the comfort level or the client's compare group
 * (`custom.compare_group`). Ordered by nearest price to the target, then by how
 * much they share, then by handle, so the list is stable. The target itself and
 * anything already `exclude`d (for example the current selection) are left out.
 */
export function similarProducts(
  target: CatalogProduct,
  catalog: readonly CatalogProduct[],
  options: {
    readonly size?: Size | null;
    readonly limit?: number;
    readonly exclude?: readonly string[];
  } = {},
): readonly CatalogProduct[] {
  const size = options.size ?? null;
  const limit = Math.max(
    0,
    Math.floor(options.limit ?? SIMILAR_PRODUCTS_DEFAULT_LIMIT),
  );
  const targetPrice = referencePriceCents(target, size);
  if (limit === 0) return [];
  const excluded = new Set(options.exclude ?? []);

  const ranked = catalog.flatMap((product) => {
    if (product.handle === target.handle || excluded.has(product.handle))
      return [];
    if (!sameCategory(product, target) || isSoldOut(product)) return [];
    const shared = sharedAttributeCount(target, product);
    if (shared === 0) return [];
    const price = referencePriceCents(product, size);
    if (price === null) return [];
    const distance = targetPrice === null ? 0 : Math.abs(price - targetPrice);
    return [{product, shared, distance}];
  });

  ranked.sort((a, b) => {
    if (a.distance !== b.distance) return a.distance - b.distance;
    if (a.shared !== b.shared) return b.shared - a.shared;
    if (a.product.handle === b.product.handle) return 0;
    return a.product.handle < b.product.handle ? -1 : 1;
  });
  return ranked.slice(0, limit).map((entry) => entry.product);
}
