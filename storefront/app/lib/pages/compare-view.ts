// View-model helpers for the comparison page (REQ-CMP-001). The selection lives
// in the URL as `?handles=a,b` so it is shareable and survives a reload; the
// device copy (compare.ts storage format) only restores it on a bare /compare.
// Every handle read from the URL or the device is validated and capped, then the
// catalog decides which still exist and which pass the selection rules.

import {isSize, type Size} from '~/lib/catalog/attributes';
import type {CatalogProduct} from '~/lib/catalog/types';
import {
  COMPARE_MAX_PRODUCTS,
  COMPARE_STORAGE_KEY,
  addToComparison,
  parseComparisonHandles,
  type AddToComparisonResult,
} from '~/lib/compare';
import type {KeyValueStorage} from '~/lib/quiz/storage';

export const COMPARE_PATH = '/compare';
export const HANDLES_PARAM = 'handles';
export const SIZE_PARAM = 'size';

const HANDLE_PATTERN = /^[a-z0-9][a-z0-9-]{0,254}$/;
/** Reads at most this many raw entries, so a hostile URL costs nothing. */
const MAX_RAW_HANDLES = 20;
/**
 * Valid handles kept from the URL. More than the limit of four on purpose: the extras are then refused with
 * a reason (resolveSelection) instead of vanishing silently.
 */
const MAX_PARSED_HANDLES = COMPARE_MAX_PRODUCTS * 2;

/**
 * Handles from `?handles=a,b` (and repeated `handles=a&handles=b`, which is what
 * a plain form submit sends). Invalid entries and duplicates are dropped.
 */
export function parseHandlesParam(params: URLSearchParams): readonly string[] {
  const handles = new Set<string>();
  const raw = params
    .getAll(HANDLES_PARAM)
    .flatMap((value) => value.split(','))
    .slice(0, MAX_RAW_HANDLES);
  for (const entry of raw) {
    const handle = entry.trim().toLowerCase();
    if (HANDLE_PATTERN.test(handle)) handles.add(handle);
    if (handles.size >= MAX_PARSED_HANDLES) break;
  }
  return [...handles];
}

export function parseSizeParam(params: URLSearchParams): Size | null {
  const raw = params.get(SIZE_PARAM);
  return isSize(raw) ? raw : null;
}

export function comparePath(
  handles: readonly string[],
  size: Size | null = null,
): string {
  const params = new URLSearchParams();
  if (handles.length > 0) params.set(HANDLES_PARAM, handles.join(','));
  if (size !== null && handles.length > 0) params.set(SIZE_PARAM, size);
  const query = params.toString().replace(/%2C/g, ',');
  return query === '' ? COMPARE_PATH : `${COMPARE_PATH}?${query}`;
}

export type Rejection = 'full' | 'duplicate' | 'different_category';

const REJECTION_TEXT: Readonly<Record<Rejection, string>> = {
  full: `You can compare up to ${COMPARE_MAX_PRODUCTS} products. Remove one to add another.`,
  duplicate: 'That product is already in your comparison.',
  different_category:
    'You can only compare products of the same type. Remove the current selection to start a different comparison.',
};

export function rejectionMessage(reason: Rejection, title: string): string {
  return `${title} was not added. ${REJECTION_TEXT[reason]}`;
}

export type ResolvedSelection = {
  readonly selection: readonly CatalogProduct[];
  readonly notices: readonly string[];
};

/**
 * Applies the selection rules to the handles in order, like resolveComparison,
 * but also says why a product was left out so the page can explain it (a form
 * submitted without JavaScript can send an invalid mix). Unknown handles are
 * skipped silently: the product may have been unpublished.
 */
export function resolveSelection(
  handles: readonly string[],
  catalog: readonly CatalogProduct[],
): ResolvedSelection {
  const byHandle = new Map(catalog.map((product) => [product.handle, product]));
  let selection: readonly CatalogProduct[] = [];
  const notices: string[] = [];
  for (const handle of handles) {
    const product = byHandle.get(handle);
    if (!product) continue;
    const result: AddToComparisonResult = addToComparison(selection, product);
    if (result.status === 'ok') {
      selection = result.selection;
    } else {
      notices.push(rejectionMessage(result.reason, product.title));
    }
  }
  return {selection, notices};
}

export type PickerItem = {
  readonly handle: string;
  readonly title: string;
  readonly brand: string;
  readonly checked: boolean;
  /** Why an unchecked item cannot be added right now; null when it can. */
  readonly blocked: Rejection | null;
};

/** The picker list: each candidate with whether it is selected or blocked by a rule. */
export function pickerItems(
  selection: readonly CatalogProduct[],
  candidates: readonly CatalogProduct[],
): readonly PickerItem[] {
  return candidates.map((product) => {
    const checked = selection.some((item) => item.handle === product.handle);
    const result = checked ? null : addToComparison(selection, product);
    return {
      handle: product.handle,
      title: product.title,
      brand: product.brand,
      checked,
      blocked: result && result.status === 'rejected' ? result.reason : null,
    };
  });
}

export function handlesOf(selection: readonly CatalogProduct[]): string[] {
  return selection.map((product) => product.handle);
}

export function withHandle(
  handles: readonly string[],
  handle: string,
): readonly string[] {
  return handles.includes(handle) ? handles : [...handles, handle];
}

export function withoutHandle(
  handles: readonly string[],
  handle: string,
): readonly string[] {
  return handles.filter((entry) => entry !== handle);
}

// --- Device copy (restores the selection on a bare /compare) ---

/** Handles only; prices are always read again from Shopify. Never throws. */
export function saveHandlesToDevice(
  storage: KeyValueStorage,
  handles: readonly string[],
): void {
  try {
    if (handles.length === 0) storage.removeItem(COMPARE_STORAGE_KEY);
    else storage.setItem(COMPARE_STORAGE_KEY, JSON.stringify(handles));
  } catch {
    // Private mode or a full quota: the comparison still works from the URL.
  }
}

export function loadHandlesFromDevice(
  storage: KeyValueStorage,
): readonly string[] {
  try {
    return parseComparisonHandles(storage.getItem(COMPARE_STORAGE_KEY));
  } catch {
    return [];
  }
}

// --- "Add to compare" on product cards and the product page ---

export type CompareAddPlan =
  | {readonly status: 'added'; readonly handles: readonly string[]}
  | {readonly status: 'present'; readonly handles: readonly string[]}
  | {readonly status: 'rejected'; readonly reason: 'full'}
  | {readonly status: 'invalid'};

/**
 * What adding one product to the device's saved selection would do. A card only knows its own handle, so
 * the rules that need handles alone are applied here (duplicate, at most four, as `addToComparison`); the
 * same-category rule needs the catalog and is applied by /compare, which explains it on the page.
 */
export function planCompareAdd(
  stored: readonly string[],
  handle: string,
): CompareAddPlan {
  const clean = handle.trim().toLowerCase();
  if (!HANDLE_PATTERN.test(clean)) return {status: 'invalid'};
  if (stored.includes(clean)) return {status: 'present', handles: stored};
  if (stored.length >= COMPARE_MAX_PRODUCTS) {
    return {status: 'rejected', reason: 'full'};
  }
  return {status: 'added', handles: [...stored, clean]};
}
