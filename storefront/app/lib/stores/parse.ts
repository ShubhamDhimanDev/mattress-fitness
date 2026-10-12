// Turns a `store` metaobject record (loosely typed JSON as the Storefront API
// returns it) into a validated Store (REQ-LOC-002). A store with a missing or
// unusable core field is skipped with a reason; optional fields that are wrong
// (phone, hours, coordinates, photo) are dropped with a warning, so one typo in
// admin cannot hide a store or break the locator.

import {toSlug} from '~/lib/catalog/attributes';
import {cleanText} from '~/lib/catalog/text';
import {normalizeUsPhone} from '~/lib/stores/directions';
import {isValidTimeZone, parseWeeklyHours} from '~/lib/stores/hours';
import type {Store, UsStateCode} from '~/lib/stores/types';
import {US_STATES} from '~/lib/stores/types';

const MAX_NAME = 120;
const MAX_ADDRESS = 120;
const MAX_ID = 255;

export type StoreRejectReason =
  | 'not_an_object'
  | 'missing_id'
  | 'missing_name'
  | 'missing_address'
  | 'missing_city'
  | 'invalid_state'
  | 'invalid_postal_code'
  | 'duplicate_id';

export type StoreParseResult =
  | {
      readonly status: 'ok';
      readonly store: Store;
      readonly warnings: readonly string[];
    }
  | {readonly status: 'rejected'; readonly reason: StoreRejectReason};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pick(
  record: Record<string, unknown>,
  names: readonly string[],
): unknown {
  for (const name of names) {
    const value = record[name];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function text(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = cleanText(value);
  return cleaned !== '' && cleaned.length <= maxLength ? cleaned : null;
}

function toBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return null;
  const lower = value.trim().toLowerCase();
  if (lower === 'true' || lower === 'yes' || lower === '1') return true;
  if (lower === 'false' || lower === 'no' || lower === '0') return false;
  return null;
}

/** Narrowing helper: true only for the keys of US_STATES, so no cast is needed. */
function isStateCode(value: string): value is UsStateCode {
  return Object.hasOwn(US_STATES, value);
}

const STATE_CODES: readonly UsStateCode[] =
  Object.keys(US_STATES).filter(isStateCode);

/** "ny", "NY" or "New York" to "NY"; null for anything else. */
export function resolveState(raw: unknown): UsStateCode | null {
  if (typeof raw !== 'string' || raw.length > 40) return null;
  const upper = raw.trim().toUpperCase();
  const byCode = STATE_CODES.find((code) => code === upper);
  if (byCode) return byCode;
  const slug = toSlug(raw);
  return STATE_CODES.find((code) => toSlug(US_STATES[code]) === slug) ?? null;
}

function parseCoordinate(value: unknown, limit: number): number | null {
  const number =
    typeof value === 'number'
      ? value
      : typeof value === 'string' &&
          /^-?\d{1,3}(?:\.\d{1,10})?$/.test(value.trim())
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(number) && Math.abs(number) <= limit ? number : null;
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2000) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function parseCoordinates(
  record: Record<string, unknown>,
  warnings: string[],
): {latitude: number | null; longitude: number | null} {
  const latRaw = pick(record, ['latitude', 'lat']);
  const lngRaw = pick(record, ['longitude', 'lng', 'lon']);
  if (latRaw === undefined && lngRaw === undefined) {
    return {latitude: null, longitude: null};
  }
  const latitude = parseCoordinate(latRaw, 90);
  const longitude = parseCoordinate(lngRaw, 180);
  // 0,0 is the usual result of an empty geocode, never a real store.
  if (
    latitude === null ||
    longitude === null ||
    (latitude === 0 && longitude === 0)
  ) {
    warnings.push(
      'The coordinates are missing or invalid; the map will use the address.',
    );
    return {latitude: null, longitude: null};
  }
  return {latitude, longitude};
}

/** Validates one store record. Never throws. */
export function parseStoreRecord(raw: unknown): StoreParseResult {
  if (!isRecord(raw)) return {status: 'rejected', reason: 'not_an_object'};
  try {
    return parseRecord(raw);
  } catch {
    return {status: 'rejected', reason: 'not_an_object'};
  }
}

function parseRecord(record: Record<string, unknown>): StoreParseResult {
  const rawId = pick(record, ['id', 'handle']);
  if (
    typeof rawId !== 'string' ||
    rawId.length === 0 ||
    rawId.length > MAX_ID
  ) {
    return {status: 'rejected', reason: 'missing_id'};
  }
  const name = text(pick(record, ['name', 'title']), MAX_NAME);
  if (!name) return {status: 'rejected', reason: 'missing_name'};
  const addressLine1 = text(
    pick(record, [
      'address_line1',
      'address_line_1',
      'address1',
      'address',
      'street',
    ]),
    MAX_ADDRESS,
  );
  if (!addressLine1) return {status: 'rejected', reason: 'missing_address'};
  const city = text(pick(record, ['city']), 80);
  if (!city) return {status: 'rejected', reason: 'missing_city'};
  const state = resolveState(pick(record, ['state', 'province', 'region']));
  if (!state) return {status: 'rejected', reason: 'invalid_state'};
  const postalRaw = pick(record, [
    'postal_code',
    'postalCode',
    'zip',
    'zip_code',
  ]);
  const postalCode = typeof postalRaw === 'string' ? postalRaw.trim() : '';
  if (!/^\d{5}(?:-\d{4})?$/.test(postalCode)) {
    return {status: 'rejected', reason: 'invalid_postal_code'};
  }

  const warnings: string[] = [];

  const phoneRaw = pick(record, ['phone', 'telephone']);
  const phone = phoneRaw === undefined ? null : normalizeUsPhone(phoneRaw);
  if (phoneRaw !== undefined && !phone) {
    warnings.push(
      'The phone number is not a valid US number; it was left out.',
    );
  }

  const hoursRaw = pick(record, ['hours', 'opening_hours']);
  const parsedHours = parseWeeklyHours(hoursRaw);
  warnings.push(...parsedHours.warnings);

  const zoneRaw = pick(record, ['time_zone', 'timezone', 'timeZone']);
  const zone = typeof zoneRaw === 'string' ? zoneRaw.trim() : null;
  if (zoneRaw !== undefined && (zone === null || !isValidTimeZone(zone))) {
    warnings.push('The time zone is not recognised; it was left out.');
  }

  const photoRaw = pick(record, ['photo_url', 'photo', 'image']);
  const photoUrl = httpsUrl(photoRaw);
  if (photoRaw !== undefined && !photoUrl) {
    warnings.push(
      'The photo address is not a valid https URL; it was left out.',
    );
  }

  const pickupRaw = pick(record, ['pickup_enabled', 'pickupEnabled', 'pickup']);
  const pickupEnabled = pickupRaw === undefined ? false : toBoolean(pickupRaw);
  if (pickupEnabled === null)
    warnings.push('The pickup flag is not true or false; pickup is off.');

  const locationRaw = pick(record, ['location_handle', 'locationHandle']);
  const locationHandle =
    typeof locationRaw === 'string' &&
    /^[a-z0-9][a-z0-9_-]{0,127}$/i.test(locationRaw.trim())
      ? locationRaw.trim()
      : null;
  if (locationRaw !== undefined && !locationHandle) {
    warnings.push(
      'The location handle is not valid; pickup availability cannot use it.',
    );
  }
  if (pickupEnabled === true && !locationHandle) {
    warnings.push('Pickup is on but no Shopify location is mapped.');
  }

  const slugSource = text(pick(record, ['slug']), 120) ?? name;
  return {
    status: 'ok',
    warnings,
    store: {
      id: rawId,
      name,
      slug: toSlug(slugSource).slice(0, 80).replace(/-+$/, '') || 'store',
      addressLine1,
      addressLine2: text(
        pick(record, ['address_line2', 'address_line_2', 'address2']),
        MAX_ADDRESS,
      ),
      city,
      state,
      postalCode,
      phone: phone?.display ?? null,
      hours: parsedHours.hours,
      timeZone: zone !== null && isValidTimeZone(zone) ? zone : null,
      ...parseCoordinates(record, warnings),
      pickupEnabled: pickupEnabled === true,
      locationHandle,
      photoUrl,
    },
  };
}

export type StoreListResult = {
  readonly stores: readonly Store[];
  /** One line per problem, with the position of the record (never its content). */
  readonly warnings: readonly string[];
};

/** Validates a list of records; invalid stores are skipped and reported. */
export function parseStoreRecords(raw: unknown): StoreListResult {
  if (!Array.isArray(raw)) {
    return {stores: [], warnings: ['The store list is not a list.']};
  }
  const stores: Store[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  raw.forEach((item: unknown, position) => {
    const result = parseStoreRecord(item);
    if (result.status === 'rejected') {
      warnings.push(`stores[${position}] skipped: ${result.reason}.`);
      return;
    }
    if (seen.has(result.store.id)) {
      warnings.push(`stores[${position}] skipped: duplicate_id.`);
      return;
    }
    seen.add(result.store.id);
    stores.push(result.store);
    for (const warning of result.warnings)
      warnings.push(`stores[${position}]: ${warning}`);
  });
  return {stores, warnings};
}
