// "Stores in your ZIP area" (REQ-LOC-001, CR31-10). Pure: no framework imports, no network.
//
// There is no geocoding service behind this (none is verified for the client's store), so nothing here is a distance.
// The only data used is each store's own postal code: a store is in the shopper's ZIP area when it has the same ZIP,
// or the same first three digits (the USPS sectional centre, which groups nearby ZIPs). The ZIP typed by the shopper is
// validated, used for this one request and never stored, put in a cookie or logged.

import type {Store} from '~/lib/stores/types';

/** Longest raw value looked at; anything longer is rejected before a pattern runs on it. */
const MAX_RAW_LENGTH = 16;

// Five digits, optionally followed by "-" and four digits (ZIP+4, whose last four digits are ignored).
const ZIP_PATTERN = /^(\d{5})(?:-\d{4})?$/;

export type ZipQuery =
  | {readonly status: 'none'}
  | {readonly status: 'invalid'}
  | {readonly status: 'valid'; readonly zip: string};

/**
 * Reads the `zip` query parameter. Missing or blank is `none`. A valid value gives only its five digits. Anything else
 * is `invalid` and carries nothing from the input, so the page cannot echo it.
 */
export function parseZipQuery(raw: string | null | undefined): ZipQuery {
  if (raw === null || raw === undefined) return {status: 'none'};
  const text = raw.trim();
  if (text === '') return {status: 'none'};
  if (text.length > MAX_RAW_LENGTH) return {status: 'invalid'};
  const match = ZIP_PATTERN.exec(text);
  return match?.[1] ? {status: 'valid', zip: match[1]} : {status: 'invalid'};
}

export type ZipMatches =
  | {
      readonly kind: 'found';
      readonly exact: readonly Store[];
      readonly area: readonly Store[];
    }
  | {readonly kind: 'none'};

function zipDigits(postalCode: string): string | null {
  return ZIP_PATTERN.exec(postalCode.trim())?.[1] ?? null;
}

// City, name, then ID, so the order never depends on how the list arrived.
function byPlace(a: Store, b: Store): number {
  return (
    a.city.localeCompare(b.city, 'en-US') ||
    a.name.localeCompare(b.name, 'en-US') ||
    a.id.localeCompare(b.id, 'en-US')
  );
}

/**
 * Stores with exactly this ZIP, then those sharing its first three digits (the exact ones are not repeated). A store
 * whose postal code is not a US ZIP is never matched. `zip` must come from `parseZipQuery`.
 */
export function matchStoresByZip(
  stores: readonly Store[],
  zip: string,
): ZipMatches {
  const prefix = zip.slice(0, 3);
  const exact: Store[] = [];
  const area: Store[] = [];
  for (const store of stores) {
    const digits = zipDigits(store.postalCode);
    if (digits === null) continue;
    if (digits === zip) exact.push(store);
    else if (digits.startsWith(prefix)) area.push(store);
  }
  if (exact.length === 0 && area.length === 0) return {kind: 'none'};
  return {kind: 'found', exact: exact.sort(byPlace), area: area.sort(byPlace)};
}
