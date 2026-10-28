// Store sheet validator (REQ-LOC-001, REQ-LOC-002, P3B-16). Pure: text in, report out, no files and no network.
// It reports ALL problems with the spreadsheet row number (header = row 1) so the client can fix them in one pass.
// The rules mirror what the website's own store reader accepts (storefront/app/lib/stores/parse.ts and hours.ts), so a
// sheet that passes here does not lose a store or a field on the site. Where this validator is stricter (ZIP+4, time
// zone names) it says so in the message.

import { parseCsv } from '../catalog/csv.mjs';
import { isValidTimeZone, parseWeeklyHours, splitTextLine } from './hours.mjs';
import { COLUMNS, COLUMN_KEYS, LIMITS } from './schema.mjs';

/**
 * @typedef {{ row: number, column: string | null, message: string }} Issue
 * @typedef {{ row: number, handle: string, fields: Record<string, string> }} StoreRecord
 *   fields holds only the cells that are filled, already in the form Shopify stores (booleans "true"/"false", hours as JSON)
 * @typedef {{ ok: boolean, errors: Issue[], warnings: Issue[], stores: StoreRecord[] }} ValidationReport
 */

// Same list as US_STATES in storefront/app/lib/stores/types.ts (50 states and DC; territories are not accepted there).
export const US_STATES = Object.freeze({
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
  DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
  PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
});

/** @param {string} value */
const toSlug = (value) => value.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * "il", "IL" or "Illinois" to "IL"; null for anything else.
 * @param {string} raw
 * @returns {string | null}
 */
export function resolveState(raw) {
  if (raw.length > 40) return null;
  const upper = raw.trim().toUpperCase();
  if (Object.hasOwn(US_STATES, upper)) return upper;
  const slug = toSlug(raw);
  return Object.keys(US_STATES).find((code) => toSlug(US_STATES[code]) === slug) ?? null;
}

/**
 * Port of normalizeUsPhone (storefront/app/lib/stores/directions.ts).
 * @param {string} raw
 * @returns {string | null} display form "(212) 555-0100"
 */
export function normalizeUsPhone(raw) {
  if (raw.length > 30 || !/^[\d\s().+-]+$/.test(raw)) return null;
  if (raw.includes('+') && !/^\s*\+1(?!\d)/.test(raw)) return null;
  let digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (digits.length !== 10) return null;
  if (/^[01]/.test(digits) || /^[01]/.test(digits.slice(3))) return null;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/**
 * @param {string} raw
 * @param {number} limit
 * @returns {number | null}
 */
function parseCoordinate(raw, limit) {
  if (!/^-?\d{1,3}(?:\.\d{1,10})?$/.test(raw)) return null;
  const number = Number(raw);
  return Number.isFinite(number) && Math.abs(number) <= limit ? number : null;
}

/** @param {string} raw @returns {boolean | null} */
function parseBoolean(raw) {
  const lower = raw.trim().toLowerCase();
  if (['true', 'yes', '1'].includes(lower)) return true;
  if (['false', 'no', '0'].includes(lower)) return false;
  return null;
}

/**
 * The hours cell as the JSON object the Opening hours field stores. Plain text ("Mon-Fri 10am-8pm; Sat 10am-6pm; Sun
 * Closed", one entry per line or separated by ; or |) becomes {"Mon-Fri": "10am-8pm", ...}, which the site reads through
 * its object form. A cell that already is JSON is kept (compacted). Either way the result is parsed again with the site's
 * rules, so what is written is what was checked.
 * @param {string} cell
 * @returns {{ json: string | null, problems: string[], notes: string[] }}
 */
export function normalizeHours(cell) {
  const text = cell.trim();
  if (text.length > LIMITS.hours) return { json: null, problems: ['The hours text is too long.'], notes: [] };
  /** @type {string[]} */
  const problems = [];
  let json;
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      json = JSON.stringify(JSON.parse(text));
    } catch {
      return { json: null, problems: ['The hours look like JSON but could not be read.'], notes: [] };
    }
  } else {
    /** @type {Record<string, string>} */
    const byDays = Object.create(null);
    for (const line of text.split(/[\n\r;|]+/).map((entry) => entry.trim()).filter(Boolean)) {
      const parts = splitTextLine(line);
      if (!parts) {
        problems.push(`"${line.replace(/\s+/g, ' ').slice(0, 30)}" has no hours (write for example Mon-Fri 10:00 AM - 9:00 PM or Sun Closed).`);
        continue;
      }
      if (parts.dayPart === '') {
        problems.push(`"${line.slice(0, 30)}" has no day before the hours.`);
        continue;
      }
      if (Object.hasOwn(byDays, parts.dayPart)) {
        problems.push(`"${parts.dayPart.slice(0, 30)}" is written twice.`);
        continue;
      }
      byDays[parts.dayPart] = parts.hoursPart;
    }
    if (problems.length > 0) return { json: null, problems, notes: [] };
    json = JSON.stringify(byDays);
  }
  const parsed = parseWeeklyHours(json);
  if (parsed.problems.length > 0 || parsed.hours === null) {
    // "No readable hours" only repeats the specific problem that caused it.
    const specific = parsed.problems.filter((problem) => problem !== 'No readable opening hours were found.');
    return { json: null, problems: specific.length > 0 ? [...new Set(specific)] : ['No readable opening hours were found.'], notes: [] };
  }
  // Guard for the text-to-JSON step: the website must read the stored JSON exactly as it would read the typed text.
  if (!text.startsWith('{') && !text.startsWith('[')) {
    const direct = parseWeeklyHours(text);
    if (JSON.stringify(direct.hours) !== JSON.stringify(parsed.hours)) {
      return { json: null, problems: ['These hours would be read differently once stored; write one entry per day group.'], notes: [] };
    }
  }
  return { json, problems: [], notes: parsed.missingDays.length > 0 ? [`No hours given for ${parsed.missingDays.join(', ')}; the site shows them as closed.`] : [] };
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// Same pattern as parse.ts: the location's name as shown in Settings > Locations (spaces allowed, the site compares
// it as a slug), or its numeric id.
const LOCATION = /^[a-z0-9][a-z0-9 _&'.-]{0,127}$/i;

/**
 * @param {string} csvText
 * @returns {ValidationReport}
 */
export function validateStoreSheet(csvText) {
  /** @type {Issue[]} */
  const errors = [];
  /** @type {Issue[]} */
  const warnings = [];
  /** @type {StoreRecord[]} */
  const stores = [];
  /** @param {number} row @param {string | null} column @param {string} message */
  const error = (row, column, message) => errors.push({ row, column, message });
  /** @param {number} row @param {string | null} column @param {string} message */
  const warn = (row, column, message) => warnings.push({ row, column, message });
  const done = () => ({ ok: errors.length === 0, errors, warnings, stores });

  if (typeof csvText !== 'string' || csvText.trim() === '') {
    error(1, null, 'The sheet is empty. Start from scripts/stores/template/stores.csv.');
    return done();
  }
  const parsed = parseCsv(csvText);
  if (!parsed.ok) {
    error(parsed.error.row, null, `The file is not a valid CSV: ${parsed.error.message}`);
    return done();
  }
  const [headerRecord, ...records] = parsed.records;
  if (!headerRecord) {
    error(1, null, 'The sheet has no header row.');
    return done();
  }

  // ---- header ----
  /** @type {Map<string, number>} */
  const index = new Map();
  headerRecord.fields.forEach((cell, position) => {
    const name = cell.trim().toLowerCase();
    if (name === '') return;
    if (!COLUMN_KEYS.includes(name)) {
      error(headerRecord.row, name.slice(0, 40), `Unknown column "${name.slice(0, 40)}". Allowed: ${COLUMN_KEYS.join(', ')}. (The photo is added in Shopify admin, not from the sheet.)`);
      return;
    }
    if (index.has(name)) {
      error(headerRecord.row, name, `Column "${name}" appears twice.`);
      return;
    }
    index.set(name, position);
  });
  for (const column of COLUMNS) {
    if (column.required && !index.has(column.key)) error(headerRecord.row, column.key, `Missing required column "${column.key}".`);
  }
  if (errors.length > 0) return done();
  if (records.length === 0) {
    error(1, null, 'The sheet has a header but no store rows.');
    return done();
  }
  if (records.length > LIMITS.maxStores) {
    error(1, null, `The sheet has ${records.length} rows; the limit is ${LIMITS.maxStores}.`);
    return done();
  }

  /** @type {Map<string, number>} slug -> first row */
  const seenSlugs = new Map();
  /** @type {Map<string, number>} address key -> first row */
  const seenAddresses = new Map();

  for (const record of records) {
    const row = record.row;
    const extra = record.fields.slice(headerRecord.fields.length).some((cell) => cell.trim() !== '');
    if (extra) error(row, null, 'This row has more cells than the header has columns.');
    /** @param {string} key */
    const cell = (key) => (record.fields[index.get(key) ?? -1] ?? '').trim();
    if (COLUMN_KEYS.every((key) => cell(key) === '')) continue;
    const before = errors.length;
    /** @type {Record<string, string>} */
    const fields = {};

    for (const column of COLUMNS) {
      const value = cell(column.key);
      if (column.key !== 'hours' && CONTROL.test(value)) error(row, column.key, 'Contains a control character (paste the text again as plain text).');
      if (column.required && value === '') error(row, column.key, `"${column.key}" is required.`);
    }

    // slug (also the entry handle)
    const slug = cell('slug');
    if (slug !== '') {
      if (slug.length > LIMITS.slug || !SLUG.test(slug)) error(row, 'slug', 'Use lowercase letters, digits and single hyphens only, up to 80 characters (for example chicago-loop).');
      else if (slug.startsWith('example-')) error(row, 'slug', 'This is the template\'s example row (slug starts with "example-"). Delete it or replace it with a real store.');
      else if (seenSlugs.has(slug)) error(row, 'slug', `Duplicate slug "${slug}": already used on row ${seenSlugs.get(slug)}. Each store needs its own slug.`);
      else {
        seenSlugs.set(slug, row);
        fields.slug = slug;
      }
    }

    // free text
    /** @type {[string, number][]} */
    const textColumns = [['name', LIMITS.name], ['address_line_1', LIMITS.address], ['address_line_2', LIMITS.address], ['city', LIMITS.city]];
    for (const [key, max] of textColumns) {
      const value = cell(key);
      if (value === '') continue;
      if (value.length > max) error(row, key, `Too long (${value.length} characters; the limit is ${max}).`);
      else if (/[<>]/.test(value)) error(row, key, 'Remove the < and > characters; the site shows plain text only.');
      else if (/^[=@]/.test(value)) error(row, key, 'Starts with = or @, which a spreadsheet treats as a formula. Remove it.');
      else fields[key] = value.replace(/\s+/g, ' ');
    }

    // state and ZIP
    const stateCell = cell('state');
    if (stateCell !== '') {
      const code = resolveState(stateCell);
      if (code) fields.state = code;
      else error(row, 'state', `"${stateCell.slice(0, 30)}" is not a US state or DC. Use the two-letter code (IL) or the full name (Illinois).`);
    }
    const zip = cell('postal_code');
    if (zip !== '') {
      if (/^\d{5}$/.test(zip)) fields.postal_code = zip;
      else if (/^\d{4}$/.test(zip)) error(row, 'postal_code', `"${zip}" has 4 digits: a leading 0 was probably lost by the spreadsheet. Format the column as text and type it again (for example 0${zip}).`);
      else if (/^\d{5}-\d{4}$/.test(zip)) error(row, 'postal_code', 'Use the 5-digit ZIP code without the +4 extension.');
      else error(row, 'postal_code', `"${zip.slice(0, 15)}" is not a 5-digit ZIP code.`);
    }

    // coordinates: both or neither
    const lat = cell('latitude');
    const lng = cell('longitude');
    if (lat !== '' || lng !== '') {
      const latitude = lat === '' ? null : parseCoordinate(lat, 90);
      const longitude = lng === '' ? null : parseCoordinate(lng, 180);
      if (lat === '' || lng === '') error(row, lat === '' ? 'latitude' : 'longitude', 'Give both latitude and longitude, or neither.');
      else if (latitude === null) error(row, 'latitude', `"${lat.slice(0, 20)}" is not a latitude (a decimal between -90 and 90, at most 10 decimals).`);
      else if (longitude === null) error(row, 'longitude', `"${lng.slice(0, 20)}" is not a longitude (a decimal between -180 and 180, at most 10 decimals).`);
      else if (latitude === 0 && longitude === 0) error(row, 'latitude', '0, 0 is the result of an empty geocode, not a store. Look the coordinates up again.');
      else {
        fields.latitude = String(latitude);
        fields.longitude = String(longitude);
      }
    } else {
      warn(row, 'latitude', 'No coordinates: the map will have to use the address.');
    }

    // phone
    const phone = cell('phone');
    if (phone !== '') {
      const display = normalizeUsPhone(phone);
      if (display) fields.phone = display;
      else error(row, 'phone', `"${phone.slice(0, 30)}" is not a valid US phone number (10 digits, no extension, for example (212) 555-0100).`);
    } else {
      warn(row, 'phone', 'No phone number.');
    }

    // time zone
    const timeZone = cell('time_zone');
    if (timeZone !== '') {
      if (isValidTimeZone(timeZone)) fields.time_zone = timeZone;
      else error(row, 'time_zone', `"${timeZone.slice(0, 40)}" is not an IANA time zone name. Use a name such as America/New_York, America/Chicago, America/Denver or America/Los_Angeles (not EST or Central).`);
    }

    // hours
    const hoursCell = cell('hours');
    if (hoursCell !== '') {
      const hours = normalizeHours(hoursCell);
      if (hours.json) {
        fields.hours = hours.json;
        for (const note of hours.notes) warn(row, 'hours', note);
        if (timeZone === '') warn(row, 'time_zone', 'Hours without a time zone: the hours are listed but the site cannot say "Open now".');
      } else {
        for (const problem of hours.problems) error(row, 'hours', problem);
      }
    } else {
      warn(row, 'hours', 'No opening hours: the store page shows "hours not available".');
    }

    // pickup
    const pickupCell = cell('pickup_enabled');
    let pickup = null;
    if (pickupCell !== '') {
      pickup = parseBoolean(pickupCell);
      if (pickup === null) error(row, 'pickup_enabled', `"${pickupCell.slice(0, 20)}" is not true or false.`);
      else fields.pickup_enabled = String(pickup);
    }
    const location = cell('location_handle');
    if (location !== '') {
      if (LOCATION.test(location)) fields.location_handle = location;
      else error(row, 'location_handle', `"${location.slice(0, 40)}" cannot be used: write the Shopify location's name as shown in Settings > Locations (letters, digits, spaces and - _ & ' . only), or its numeric id.`);
    }
    if (pickup === true && location === '') warn(row, 'location_handle', 'Pickup is on but no Shopify location is mapped, so pickup availability cannot be shown.');

    // same place twice
    if (fields.address_line_1 && fields.postal_code) {
      const key = `${fields.address_line_1.toLowerCase()}|${fields.address_line_2?.toLowerCase() ?? ''}|${fields.postal_code}`;
      if (seenAddresses.has(key)) warn(row, 'address_line_1', `Same address and ZIP as row ${seenAddresses.get(key)}.`);
      else seenAddresses.set(key, row);
    }

    if (errors.length === before && fields.slug) stores.push({ row, handle: fields.slug, fields });
  }

  if (errors.length === 0 && stores.length === 0) error(1, null, 'The sheet has no store rows.');
  return done();
}

/**
 * Plain-text report, one line per problem, grouped errors first.
 * @param {ValidationReport} report
 * @returns {string}
 */
export function renderReport(report) {
  /** @param {Issue} issue */
  const line = (issue) => `  row ${issue.row}${issue.column ? ` [${issue.column}]` : ''}: ${issue.message}`;
  const out = [];
  if (report.errors.length > 0) out.push(`${report.errors.length} error(s):`, ...report.errors.map(line));
  if (report.warnings.length > 0) out.push(`${report.warnings.length} note(s):`, ...report.warnings.map(line));
  out.push(report.ok ? `OK: ${report.stores.length} store(s) are ready to import.` : 'Not ready: fix the errors above and run again. Nothing was sent.');
  return out.join('\n');
}
