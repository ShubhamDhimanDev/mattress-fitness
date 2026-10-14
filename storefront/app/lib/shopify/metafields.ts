// Reading Shopify metafield values safely. Every value is untrusted text from the admin (threat T-07, T-15):
// single choices are matched against the canonical lists in catalog/attributes.ts, free text is cleaned,
// and malformed JSON becomes "no data" instead of an error. A product with no metafields (or a store that
// has not defined them, like the mock stores) therefore yields empty results and the UI omits the section.

import {indexIn, matchCanonical} from '~/lib/catalog/attributes';
import {cleanText} from '~/lib/catalog/text';

export type RawMetafield = {
  readonly key: string;
  readonly value: string;
} | null;

export type MetafieldValues = ReadonlyMap<string, string>;

const MAX_JSON_LENGTH = 20_000;
const MAX_TEXT_LENGTH = 300;
const MAX_LIST_ITEMS = 30;

/** Metafield lookup by key. Missing metafields arrive as null in the API's identifier lookups. */
export function indexMetafields(
  list: readonly RawMetafield[] | null | undefined,
): MetafieldValues {
  const values = new Map<string, string>();
  for (const entry of list ?? []) {
    if (entry && entry.value.trim() !== '') values.set(entry.key, entry.value);
  }
  return values;
}

function parseJson(raw: string): unknown {
  if (raw.length > MAX_JSON_LENGTH) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function readText(values: MetafieldValues, key: string): string | null {
  const raw = values.get(key);
  if (raw === undefined) return null;
  const text = cleanText(raw).slice(0, MAX_TEXT_LENGTH);
  return text === '' ? null : text;
}

export function readChoice<T extends string>(
  values: MetafieldValues,
  key: string,
  list: readonly T[],
): T | null {
  const raw = values.get(key);
  return raw === undefined ? null : matchCanonical(list, raw.trim());
}

function rawItems(raw: string): unknown[] {
  const parsed = parseJson(raw);
  if (Array.isArray(parsed)) return parsed;
  // A single-line text metafield may hold "Cooling, Pressure Relief" instead of a JSON list.
  return raw.split(',');
}

/** A list metafield mapped to canonical labels, de-duplicated, in the standard order; unknown values dropped. */
export function readChoices<T extends string>(
  values: MetafieldValues,
  key: string,
  list: readonly T[],
): T[] {
  const raw = values.get(key);
  if (raw === undefined) return [];
  const found = new Set<T>();
  for (const item of rawItems(raw).slice(0, MAX_LIST_ITEMS)) {
    const match = matchCanonical(list, typeof item === 'string' ? item : null);
    if (match !== null) found.add(match);
  }
  return [...found].sort((a, b) => indexIn(list, a) - indexIn(list, b));
}

export function readTextList(values: MetafieldValues, key: string): string[] {
  const raw = values.get(key);
  if (raw === undefined) return [];
  const parsed = parseJson(raw);
  const items = Array.isArray(parsed) ? parsed : raw.split('\n');
  const texts: string[] = [];
  for (const item of items.slice(0, MAX_LIST_ITEMS)) {
    if (typeof item !== 'string') continue;
    const text = cleanText(item).slice(0, MAX_TEXT_LENGTH);
    if (text !== '') texts.push(text);
  }
  return texts;
}

/** A positive decimal such as the mattress height in inches; anything else is "no data". */
export function readPositiveNumber(
  values: MetafieldValues,
  key: string,
): number | null {
  const raw = values.get(key);
  if (raw === undefined || !/^\d{1,4}(\.\d{1,2})?$/.test(raw.trim())) {
    return null;
  }
  const value = Number(raw.trim());
  return value > 0 ? value : null;
}

export type SpecRow = {readonly label: string; readonly value: string};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function specRow(label: unknown, value: unknown): SpecRow | null {
  if (typeof label !== 'string') return null;
  const text =
    typeof value === 'string' || typeof value === 'number'
      ? cleanText(String(value))
      : '';
  const cleanLabel = cleanText(label).slice(0, 80);
  if (cleanLabel === '' || text === '') return null;
  return {label: cleanLabel, value: text.slice(0, MAX_TEXT_LENGTH)};
}

/**
 * `custom.specifications` as label and value rows. Accepts the documented list of `{label, value}` pairs
 * and, because the admin may paste either, a plain object of label to value.
 */
export function readSpecifications(
  values: MetafieldValues,
  key: string,
): SpecRow[] {
  const raw = values.get(key);
  if (raw === undefined) return [];
  const parsed = parseJson(raw);
  const rows: SpecRow[] = [];
  if (Array.isArray(parsed)) {
    for (const item of parsed.slice(0, MAX_LIST_ITEMS)) {
      if (!isRecord(item)) continue;
      const row = specRow(item.label, item.value);
      if (row) rows.push(row);
    }
  } else if (isRecord(parsed)) {
    for (const [label, value] of Object.entries(parsed).slice(
      0,
      MAX_LIST_ITEMS,
    )) {
      const row = specRow(label, value);
      if (row) rows.push(row);
    }
  }
  return rows;
}
