// The single delivery zone (ADR-0007, REQ-DEL-001, REQ-DEL-002): ZIP to eligibility, fee and promise.
// One definition of "which ZIPs does a list cover" is shared by eligibility checks and by the parity diff
// against Shopify Local delivery, so the storefront and checkout cannot disagree because of parsing.
// Pure and runtime-neutral (no node:* imports, no I/O).

import {isValidCents, safeCents} from './cents';
import {parseZip} from './zip';

export type DeliveryType = 'in-home' | 'parcel' | 'pickup';

export type DeliveryZone = {
  readonly name: string;
  /** Exact 5-digit codes or prefix wildcards such as "606*" (1 to 4 digits before the star). */
  readonly postalCodes: readonly string[];
  readonly feeCents: number;
  /** Subtotal at or above which in-home delivery is free; null means it is never free. */
  readonly freeOverCents: number | null;
  /** Client-approved wording per delivery type, plain text (render it escaped, never as HTML). */
  readonly promise: {
    readonly inHome: string;
    readonly parcel: string;
    readonly pickup: string;
  };
};

/** Shopify Local delivery accepts at most this many characters in one postal-code zone (F-18). */
export const SHOPIFY_POSTAL_CODE_LIST_LIMIT = 3000;

// Anything larger is not a postal-code list. Refusing it (an empty zone, nobody eligible) fails closed
// instead of spending unbounded time on hostile CMS content.
const MAX_PARSE_LENGTH = 100_000;
const MAX_WARNING_ENTRY_LENGTH = 40;

const EXACT_ENTRY = /^[0-9]{5}$/;
const PREFIX_ENTRY = /^([0-9]{1,4})\*$/;

// ---------------------------------------------------------------------------------------------------
// Entries as numeric ranges. "606*" is 60600 to 60699, so a wildcard is never expanded into 100 strings
// and a one-digit prefix (10,000 ZIPs) costs the same as an exact code.
// ---------------------------------------------------------------------------------------------------

type ZipInterval = {readonly lo: number; readonly hi: number};

function entryInterval(entry: unknown): ZipInterval | null {
  if (typeof entry !== 'string') return null;
  if (EXACT_ENTRY.test(entry)) {
    const value = Number(entry);
    return {lo: value, hi: value};
  }
  const digits = PREFIX_ENTRY.exec(entry)?.[1];
  // A bare "*" or "12345*" is rejected on purpose: "*" would silently make every ZIP eligible.
  if (digits === undefined) return null;
  const span = 10 ** (5 - digits.length);
  const lo = Number(digits) * span;
  return {lo, hi: lo + span - 1};
}

function mergeIntervals(intervals: readonly ZipInterval[]): ZipInterval[] {
  const sorted = [...intervals].sort((a, b) => a.lo - b.lo || a.hi - b.hi);
  const merged: ZipInterval[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    // Adjacent ranges (60699 then 60700) merge so the same set always has the same canonical form.
    if (last !== undefined && interval.lo <= last.hi + 1) {
      merged[merged.length - 1] = {
        lo: last.lo,
        hi: Math.max(last.hi, interval.hi),
      };
    } else {
      merged.push(interval);
    }
  }
  return merged;
}

/** a minus b; both inputs must already be merged (sorted and disjoint). */
function subtractIntervals(
  a: readonly ZipInterval[],
  b: readonly ZipInterval[],
): ZipInterval[] {
  const result: ZipInterval[] = [];
  let start = 0;
  for (const interval of a) {
    let lo = interval.lo;
    // Ranges of b that end before this one cannot touch it or any later range of a.
    while (start < b.length && b[start].hi < lo) start++;
    let index = start;
    while (index < b.length && b[index].lo <= interval.hi) {
      if (b[index].lo > lo) result.push({lo, hi: b[index].lo - 1});
      lo = Math.max(lo, b[index].hi + 1);
      index++;
    }
    if (lo <= interval.hi) result.push({lo, hi: interval.hi});
  }
  return result;
}

function listIntervals(entries: readonly unknown[]): ZipInterval[] {
  const intervals: ZipInterval[] = [];
  for (const entry of entries) {
    const interval = entryInterval(entry);
    if (interval !== null) intervals.push(interval);
  }
  return mergeIntervals(intervals);
}

/** Smallest list of exact codes and wildcards (decimal prefixes) that covers the ranges. */
function intervalsToEntries(intervals: readonly ZipInterval[]): string[] {
  const entries: string[] = [];
  for (const {lo, hi} of intervals) {
    let value = lo;
    while (value <= hi) {
      // Largest block that starts here and stays inside the range. k = 4 is a one-digit prefix ("6*").
      let k = 4;
      while (k > 0 && (value % 10 ** k !== 0 || value + 10 ** k - 1 > hi)) k--;
      const span = 10 ** k;
      entries.push(
        k === 0
          ? String(value).padStart(5, '0')
          : `${String(value / span).padStart(5 - k, '0')}*`,
      );
      value += span;
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------------------------------
// Parsing the list the client maintains (metaobject text, or the Shopify Local delivery field).
// ---------------------------------------------------------------------------------------------------

export type ZoneListWarning =
  | {code: 'too-long'; length: number; limit: number}
  | {code: 'too-large-to-parse'; length: number; limit: number}
  | {code: 'invalid-entry'; entry: string}
  | {code: 'duplicate'; entry: string}
  | {code: 'redundant'; entry: string; coveredBy: string};

export type ParsedZoneList = {
  /** Valid entries, de-duplicated, in first-seen order. */
  entries: string[];
  warnings: ZoneListWarning[];
};

function clipForWarning(entry: string): string {
  return entry.length > MAX_WARNING_ENTRY_LENGTH
    ? `${entry.slice(0, MAX_WARNING_ENTRY_LENGTH)}...`
    : entry;
}

function redundancyWarnings(entries: readonly string[]): ZoneListWarning[] {
  const ranked: {entry: string; interval: ZipInterval}[] = [];
  for (const entry of entries) {
    const interval = entryInterval(entry);
    if (interval !== null) ranked.push({entry, interval});
  }
  // Widest range first among entries that start together, so a wildcard is seen before what it covers.
  ranked.sort(
    (a, b) =>
      a.interval.lo - b.interval.lo ||
      b.interval.hi - a.interval.hi ||
      a.entry.localeCompare(b.entry),
  );
  const warnings: ZoneListWarning[] = [];
  let cover: {entry: string; hi: number} | null = null;
  for (const {entry, interval} of ranked) {
    if (cover !== null && interval.hi <= cover.hi) {
      warnings.push({code: 'redundant', entry, coveredBy: cover.entry});
    } else {
      cover = {entry, hi: interval.hi};
    }
  }
  return warnings;
}

/**
 * Parses the postal-code text. Separators are commas (with or without a space) and line breaks.
 * Invalid and duplicate entries are dropped with a warning; the result is never partially trusted:
 * callers should surface the warnings to whoever maintains the list.
 */
export function parseZoneList(text: string | null | undefined): ParsedZoneList {
  if (typeof text !== 'string') return {entries: [], warnings: []};
  if (text.length > MAX_PARSE_LENGTH) {
    return {
      entries: [],
      warnings: [
        {
          code: 'too-large-to-parse',
          length: text.length,
          limit: MAX_PARSE_LENGTH,
        },
      ],
    };
  }

  const warnings: ZoneListWarning[] = [];
  if (text.length > SHOPIFY_POSTAL_CODE_LIST_LIMIT) {
    warnings.push({
      code: 'too-long',
      length: text.length,
      limit: SHOPIFY_POSTAL_CODE_LIST_LIMIT,
    });
  }

  const entries: string[] = [];
  const seen = new Set<string>();
  for (const part of text.split(/[,\r\n]+/)) {
    const entry = part.trim();
    if (entry === '') continue;
    if (entryInterval(entry) === null) {
      warnings.push({code: 'invalid-entry', entry: clipForWarning(entry)});
    } else if (seen.has(entry)) {
      warnings.push({code: 'duplicate', entry});
    } else {
      seen.add(entry);
      entries.push(entry);
    }
  }
  warnings.push(...redundancyWarnings(entries));
  return {entries, warnings};
}

/** Shopify's postal-code format: entries separated by a comma and a space. */
export function serializeZoneList(entries: readonly string[]): string {
  return entries.join(', ');
}

// ---------------------------------------------------------------------------------------------------
// Eligibility, quote and promise.
// ---------------------------------------------------------------------------------------------------

export function isInZone(zone: DeliveryZone, zip: unknown): boolean {
  const parsed = parseZip(zip);
  if (!parsed.ok) return false;
  const value = Number(parsed.zip);
  return zone.postalCodes.some((entry) => {
    const interval = entryInterval(entry);
    return interval !== null && value >= interval.lo && value <= interval.hi;
  });
}

export type DeliveryQuote =
  | {
      eligible: true;
      method: 'in-home';
      feeCents: number;
      free: boolean;
      /** Cents still to spend for free delivery; 0 once reached; null when the zone never gives free delivery. */
      freeDeliveryRemainingCents: number | null;
    }
  | {
      eligible: false;
      method: 'unavailable';
      reason: 'invalid-zip' | 'outside-zone' | 'zone-misconfigured';
      feeCents: 0;
      free: false;
      freeDeliveryRemainingCents: null;
    };

function unavailable(
  reason: 'invalid-zip' | 'outside-zone' | 'zone-misconfigured',
): DeliveryQuote {
  return {
    eligible: false,
    method: 'unavailable',
    reason,
    feeCents: 0,
    free: false,
    freeDeliveryRemainingCents: null,
  };
}

/**
 * Fee and free-delivery status for a ZIP and cart subtotal. Free delivery starts AT the threshold
 * (subtotal >= freeOverCents); this must match the Local delivery price rule (verify at V-06 with a
 * test order exactly on the threshold). The caller passes the same subtotal basis Shopify uses.
 */
export function deliveryQuote(
  zone: DeliveryZone,
  zip: unknown,
  subtotalCents: number,
): DeliveryQuote {
  // A corrupt fee must never read as "free": refuse to quote rather than guess.
  if (
    !isValidCents(zone.feeCents) ||
    (zone.freeOverCents !== null && !isValidCents(zone.freeOverCents))
  ) {
    return unavailable('zone-misconfigured');
  }
  if (!parseZip(zip).ok) return unavailable('invalid-zip');
  if (!isInZone(zone, zip)) return unavailable('outside-zone');

  const subtotal = safeCents(subtotalCents);
  const threshold = zone.freeOverCents;
  const reached = threshold !== null && subtotal >= threshold;
  const feeCents = reached ? 0 : zone.feeCents;
  return {
    eligible: true,
    method: 'in-home',
    feeCents,
    free: feeCents === 0,
    freeDeliveryRemainingCents:
      threshold === null ? null : Math.max(0, threshold - subtotal),
  };
}

export type DeliveryPromise =
  | {status: 'promise'; deliveryType: DeliveryType; text: string}
  | {status: 'needs-zip'}
  | {status: 'invalid-zip'}
  | {status: 'unavailable'; reason: 'outside-zone' | 'no-promise-text'};

/**
 * The client-approved promise for a delivery type (REQ-DEL-002). Only in-home delivery depends on the
 * ZIP; parcel and pickup wording is static per delivery type (no carrier or stock calculation), so it
 * is returned without a ZIP. No text is produced for an ineligible combination.
 */
export function promiseFor(
  zone: DeliveryZone,
  zip: unknown,
  deliveryType: DeliveryType,
): DeliveryPromise {
  switch (deliveryType) {
    case 'in-home': {
      const parsed = parseZip(zip);
      if (!parsed.ok) {
        const missing =
          zip === null || zip === undefined || parsed.reason === 'empty';
        return {status: missing ? 'needs-zip' : 'invalid-zip'};
      }
      if (!isInZone(zone, parsed.zip)) {
        return {status: 'unavailable', reason: 'outside-zone'};
      }
      return promiseText(deliveryType, zone.promise.inHome);
    }
    case 'parcel':
      return promiseText(deliveryType, zone.promise.parcel);
    case 'pickup':
      return promiseText(deliveryType, zone.promise.pickup);
    default: {
      const unreachable: never = deliveryType;
      return unreachable;
    }
  }
}

function promiseText(
  deliveryType: DeliveryType,
  text: unknown,
): DeliveryPromise {
  const trimmed = typeof text === 'string' ? text.trim() : '';
  return trimmed === ''
    ? {status: 'unavailable', reason: 'no-promise-text'}
    : {status: 'promise', deliveryType, text: trimmed};
}

// ---------------------------------------------------------------------------------------------------
// Parity (P5B-02): compares what two lists mean, not how they are written.
// ---------------------------------------------------------------------------------------------------

export type ZoneDiff = {
  /** Smallest equivalent entries (exact codes and wildcards) covered only by list A. */
  onlyInA: string[];
  onlyInB: string[];
  common: string[];
  identical: boolean;
};

/**
 * Semantic comparison of two entry lists. "606*" equals the hundred exact codes 60600 to 60699, so the
 * storefront list "606*" and a Shopify list of 100 exact codes are reported identical. Invalid entries
 * are ignored here; run parseZoneList first and report its warnings separately.
 */
export function diffZoneLists(
  a: readonly string[],
  b: readonly string[],
): ZoneDiff {
  const rangesA = listIntervals(a);
  const rangesB = listIntervals(b);
  const onlyInA = subtractIntervals(rangesA, rangesB);
  const onlyInB = subtractIntervals(rangesB, rangesA);
  // A and B share what is left of A after removing what only A has.
  const common = subtractIntervals(rangesA, onlyInA);
  return {
    onlyInA: intervalsToEntries(onlyInA),
    onlyInB: intervalsToEntries(onlyInB),
    common: intervalsToEntries(common),
    identical: onlyInA.length === 0 && onlyInB.length === 0,
  };
}
