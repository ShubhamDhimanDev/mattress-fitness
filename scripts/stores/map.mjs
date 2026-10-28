// Mapping between a validated sheet row and the `store` metaobject: which fields to send and whether an entry that
// already exists in Shopify differs. Pure functions, no network.

import { COLUMN_KEYS } from './schema.mjs';

/** Stable text for JSON so key order or spacing differences added by Shopify do not look like a change. @param {unknown} value @returns {string} */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(/** @type {Record<string, unknown>} */ (value)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Whether the value Shopify holds is the value the sheet wants. Shopify may format numbers ("41.80") and JSON differently
 * from what was sent, so those compare by meaning.
 * @param {string} key
 * @param {string} wanted
 * @param {string | undefined} existing
 */
export function sameFieldValue(key, wanted, existing) {
  if (existing === undefined) return false;
  switch (key) {
    case 'latitude':
    case 'longitude':
      return Number(wanted) === Number(existing) && existing.trim() !== '';
    case 'pickup_enabled':
      return wanted.toLowerCase() === existing.trim().toLowerCase();
    case 'hours':
      try {
        return canonicalJson(JSON.parse(wanted)) === canonicalJson(JSON.parse(existing));
      } catch {
        return false;
      }
    default:
      return wanted === existing.trim();
  }
}

/**
 * The fields to send for one store: all of them for a new entry, only the different ones for an existing entry.
 * A blank cell in the sheet is never sent (it is not in `desired`), so it cannot erase a value someone typed in Shopify
 * admin; `leftAlone` lists those so the report can say so.
 * @param {Record<string, string>} desired validated sheet fields
 * @param {Record<string, string> | null} existing fields of the entry in Shopify, or null when there is none
 * @returns {{ send: { key: string, value: string }[], changed: string[], leftAlone: string[] }}
 */
export function diffStore(desired, existing) {
  /** @type {{ key: string, value: string }[]} */
  const send = [];
  /** @type {string[]} */
  const leftAlone = [];
  for (const key of COLUMN_KEYS) {
    const value = desired[key];
    if (value === undefined) {
      if (existing && existing[key] !== undefined && existing[key].trim() !== '') leftAlone.push(key);
      continue;
    }
    if (!existing || !sameFieldValue(key, value, existing[key])) send.push({ key, value });
  }
  return { send, changed: send.map((field) => field.key), leftAlone };
}
