#!/usr/bin/env node
// Delivery-zone parity check (ADR-0007, REQ-DEL-001, REQ-DEL-002).
// The postal-code list lives twice: in the delivery_zone metaobject (read by the storefront) and in
// Shopify Local delivery (enforced at checkout). This compares what each one COVERS, wildcard-aware, so
// "100*" and the hundred explicit codes 10000-10099 are the same, and "10001" missing on one side is drift.
//
//   node scripts/shopify/check-delivery-parity.mjs --zone zone-export.json --local local-delivery-export.json
//
// Offline by design: it reads two JSON files, so it needs no credentials and is safe in CI.
// UNVERIFIED(V-06c): whether the Admin API can read Local delivery postal codes is open, so the Local
// delivery side is a JSON export that a person (or a later script) produces. The reader therefore accepts
// several shapes: an array of codes, a text value, { postal_codes }, { postalCodes }, a metaobject node
// { fields: [{ key, value }] }, or those nested anywhere inside an export.
// Local delivery rules (F-28): postal codes up to 3,000 characters, "*" prefixes allowed.

import { readFile } from 'node:fs/promises';
import { EXIT_FAILED, EXIT_OK, EXIT_USAGE, isMainModule, parseFlags } from '../lib/cli.mjs';

export const LOCAL_DELIVERY_MAX_CHARACTERS = 3000;
const KEY_NAMES = new Set(['postal_codes', 'postalcodes', 'postal_code_list', 'postal_codes_list', 'zip_codes', 'zipcodes', 'zip_list']);
const MAX_DEPTH = 8;
const TOTAL_CODES = 100_000;

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Finds every value stored under a postal-code key, however the export nests it.
 * @param {unknown} node
 * @param {number} [depth]
 * @returns {unknown[]}
 */
export function findPostalCodeValues(node, depth = 0) {
  if (depth > MAX_DEPTH) return [];
  if (Array.isArray(node)) {
    // A bare array of strings is itself the list (top level only; deeper arrays are containers).
    if (depth === 0 && node.length > 0 && node.every((item) => typeof item === 'string')) return [node];
    return node.flatMap((item) => findPostalCodeValues(item, depth + 1));
  }
  if (!isRecord(node)) return [];
  /** @type {unknown[]} */
  const found = [];
  for (const [key, value] of Object.entries(node)) {
    if (KEY_NAMES.has(key.toLowerCase())) found.push(value);
    else if (key === 'fields' && Array.isArray(value)) {
      for (const field of value) {
        if (isRecord(field) && typeof field.key === 'string' && KEY_NAMES.has(field.key.toLowerCase())) found.push(field.value);
        else found.push(...findPostalCodeValues(field, depth + 1));
      }
    } else if (typeof value === 'object' && value !== null) found.push(...findPostalCodeValues(value, depth + 1));
  }
  return found;
}

/**
 * @param {unknown} value a string (comma, space or line separated, or a JSON array) or an array
 * @returns {{ items: string[], characters: number }}
 */
export function flattenValue(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          const items = parsed.filter((item) => typeof item === 'string').flatMap((item) => item.split(/[\s,;]+/));
          return { items: items.filter(Boolean), characters: parsed.filter((item) => typeof item === 'string').join(', ').length };
        }
      } catch {
        // not JSON; fall through to plain text
      }
    }
    return { items: trimmed.split(/[\s,;]+/).filter(Boolean), characters: trimmed.length };
  }
  if (Array.isArray(value)) {
    const strings = value.filter((item) => typeof item === 'string');
    return { items: strings.flatMap((item) => item.split(/[\s,;]+/)).filter(Boolean), characters: strings.join(', ').length };
  }
  return { items: [], characters: 0 };
}

/**
 * @typedef {{ kind: 'exact', code: number, text: string } | { kind: 'prefix', prefix: string, from: number, to: number, text: string }} Token
 */

/**
 * @param {string[]} items
 * @returns {{ tokens: Token[], invalid: string[] }}
 */
export function parseTokens(items) {
  /** @type {Token[]} */
  const tokens = [];
  /** @type {string[]} */
  const invalid = [];
  for (const raw of items) {
    const item = raw.trim().toUpperCase();
    const zip = /^(\d{5})(?:-\d{4})?$/.exec(item);
    const wildcard = /^(\d{1,4})\*$/.exec(item);
    if (zip) {
      tokens.push({ kind: 'exact', code: Number(zip[1]), text: zip[1] });
    } else if (wildcard) {
      const prefix = wildcard[1];
      const span = 10 ** (5 - prefix.length);
      const from = Number(prefix) * span;
      tokens.push({ kind: 'prefix', prefix, from, to: from + span - 1, text: `${prefix}*` });
    } else {
      invalid.push(raw.length > 20 ? `${raw.slice(0, 20)}...` : raw);
    }
  }
  return { tokens, invalid };
}

/**
 * @param {Token[]} tokens
 * @returns {Uint8Array} one flag per possible 5-digit ZIP
 */
export function expandCoverage(tokens) {
  const covered = new Uint8Array(TOTAL_CODES);
  for (const token of tokens) {
    if (token.kind === 'exact') covered[token.code] = 1;
    else covered.fill(1, token.from, token.to + 1);
  }
  return covered;
}

/**
 * @param {Uint8Array} left
 * @param {Uint8Array} right
 * @returns {number[]} codes covered by left and not by right
 */
export function difference(left, right) {
  const out = [];
  for (let code = 0; code < TOTAL_CODES; code += 1) if (left[code] === 1 && right[code] === 0) out.push(code);
  return out;
}

const pad = (/** @type {number} */ code) => String(code).padStart(5, '0');

/**
 * 10001, 10002, 10003, 10010 -> ["10001-10003", "10010"]
 * @param {number[]} codes ascending
 * @returns {string[]}
 */
export function compressRanges(codes) {
  /** @type {string[]} */
  const out = [];
  let start = 0;
  while (start < codes.length) {
    let end = start;
    while (end + 1 < codes.length && codes[end + 1] === codes[end] + 1) end += 1;
    out.push(end === start ? pad(codes[start]) : `${pad(codes[start])}-${pad(codes[end])}`);
    start = end + 1;
  }
  return out;
}

/**
 * Tokens that are not completely covered by the other side: the actionable part of a drift report.
 * @param {Token[]} tokens
 * @param {Uint8Array} other
 * @returns {string[]}
 */
function tokensNotCovered(tokens, other) {
  return tokens
    .filter((token) => {
      if (token.kind === 'exact') return other[token.code] === 0;
      for (let code = token.from; code <= token.to; code += 1) if (other[code] === 0) return true;
      return false;
    })
    .map((token) => token.text);
}

/**
 * @typedef {object} SideReport
 * @property {string[]} errors
 * @property {Token[]} tokens
 * @property {number} characters
 * @property {number} covered   how many 5-digit ZIPs the list covers
 * @typedef {object} ParityReport
 * @property {boolean} ok
 * @property {string[]} errors       unreadable input or invalid tokens
 * @property {string[]} notes
 * @property {{ zone: SideReport, local: SideReport }} sides
 * @property {string[]} onlyInZone   compressed ranges
 * @property {string[]} onlyInLocal
 * @property {string[]} zoneTokensNotInLocal
 * @property {string[]} localTokensNotInZone
 */

/**
 * @param {string} name
 * @param {unknown} json
 * @param {boolean} expectSingle the metaobject side must hold exactly one list (ADR-0007: one zone)
 * @returns {SideReport}
 */
function readSide(name, json, expectSingle) {
  /** @type {SideReport} */
  const side = { errors: [], tokens: [], characters: 0, covered: 0 };
  const values = findPostalCodeValues(json);
  if (values.length === 0) {
    side.errors.push(`${name}: no postal code list found. Expected an array of codes, a text value, or a field named postal_codes.`);
    return side;
  }
  if (expectSingle && values.length > 1) {
    side.errors.push(`${name}: found ${values.length} postal code lists but exactly one delivery zone is expected (ADR-0007). Export a single entry.`);
    return side;
  }
  const items = [];
  for (const value of values) {
    const flat = flattenValue(value);
    items.push(...flat.items);
    side.characters += flat.characters;
  }
  const parsed = parseTokens(items);
  for (const bad of parsed.invalid.slice(0, 20)) {
    side.errors.push(`${name}: "${bad}" is not a 5-digit ZIP or a prefix wildcard such as 100*.${/^\d{4}$/.test(bad) ? ' A leading zero may have been lost in a spreadsheet.' : ''}`);
  }
  if (parsed.invalid.length > 20) side.errors.push(`${name}: ${parsed.invalid.length - 20} more invalid entries.`);
  side.tokens = parsed.tokens;
  return side;
}

/**
 * @param {{ zoneJson: unknown, localJson: unknown }} args
 * @returns {ParityReport}
 */
export function checkParity({ zoneJson, localJson }) {
  const zone = readSide('delivery zone', zoneJson, true);
  const local = readSide('Local delivery', localJson, false);
  /** @type {ParityReport} */
  const report = { ok: false, errors: [...zone.errors, ...local.errors], notes: [], sides: { zone, local }, onlyInZone: [], onlyInLocal: [], zoneTokensNotInLocal: [], localTokensNotInZone: [] };
  if (report.errors.length > 0) return report;

  const zoneCoverage = expandCoverage(zone.tokens);
  const localCoverage = expandCoverage(local.tokens);
  zone.covered = zoneCoverage.reduce((sum, flag) => sum + flag, 0);
  local.covered = localCoverage.reduce((sum, flag) => sum + flag, 0);
  const onlyZone = difference(zoneCoverage, localCoverage);
  const onlyLocal = difference(localCoverage, zoneCoverage);
  report.onlyInZone = compressRanges(onlyZone);
  report.onlyInLocal = compressRanges(onlyLocal);
  report.zoneTokensNotInLocal = tokensNotCovered(zone.tokens, localCoverage);
  report.localTokensNotInZone = tokensNotCovered(local.tokens, zoneCoverage);

  if (local.characters > LOCAL_DELIVERY_MAX_CHARACTERS) {
    report.errors.push(`Local delivery list is ${local.characters} characters; Shopify allows ${LOCAL_DELIVERY_MAX_CHARACTERS} (F-28). Use wildcard prefixes to shorten it.`);
  }
  if (zone.covered === TOTAL_CODES || local.covered === TOTAL_CODES) report.notes.push('One list covers every ZIP in the country; check for an over-broad wildcard.');
  if (zone.covered === 0) report.notes.push('The delivery zone covers no ZIP codes.');
  const sameCoverage = onlyZone.length === 0 && onlyLocal.length === 0;
  const sameNotation = JSON.stringify(zone.tokens.map((t) => t.text).sort()) === JSON.stringify(local.tokens.map((t) => t.text).sort());
  if (sameCoverage && !sameNotation) report.notes.push('Both lists cover the same ZIP codes but are written differently (for example a wildcard versus explicit codes). That is not drift.');
  report.ok = sameCoverage && report.errors.length === 0;
  return report;
}

/**
 * @param {ParityReport} report
 * @returns {string}
 */
export function renderParityReport(report) {
  const lines = [];
  lines.push(report.ok ? 'PARITY OK: the delivery zone and Local delivery cover the same ZIP codes.' : 'PARITY FAILED');
  const { zone, local } = report.sides;
  lines.push(`Delivery zone: ${zone.tokens.length} entries covering ${zone.covered} ZIP codes. Local delivery: ${local.tokens.length} entries covering ${local.covered} ZIP codes (${local.characters} characters).`);
  for (const error of report.errors) lines.push(`ERROR ${error}`);
  if (report.onlyInZone.length > 0) lines.push(`Only in the delivery zone (add to Local delivery): ${truncate(report.onlyInZone)}`);
  if (report.onlyInLocal.length > 0) lines.push(`Only in Local delivery (add to the delivery zone): ${truncate(report.onlyInLocal)}`);
  if (report.zoneTokensNotInLocal.length > 0) lines.push(`Zone entries not fully covered by Local delivery: ${truncate(report.zoneTokensNotInLocal)}`);
  if (report.localTokensNotInZone.length > 0) lines.push(`Local delivery entries not fully covered by the zone: ${truncate(report.localTokensNotInZone)}`);
  for (const note of report.notes) lines.push(`note ${note}`);
  return lines.join('\n');
}

/** @param {string[]} list */
function truncate(list, limit = 40) {
  return list.length <= limit ? list.join(', ') : `${list.slice(0, limit).join(', ')} ... (${list.length - limit} more)`;
}

const USAGE = `Usage: node scripts/shopify/check-delivery-parity.mjs --zone <metaobject-export.json> --local <local-delivery-export.json>

Compares the ZIP codes covered by the delivery_zone metaobject with those in Shopify Local delivery.
Exit code: 0 same coverage, 1 drift or invalid entries, 2 usage or unreadable file.`;

/**
 * @param {readonly string[]} argv
 * @param {{ out?: (text: string) => void, err?: (text: string) => void }} [io]
 * @returns {Promise<number>}
 */
export async function main(argv, { out = (text) => console.log(text), err = (text) => console.error(text) } = {}) {
  const flags = parseFlags(argv, { zone: { type: 'string' }, local: { type: 'string' }, help: { type: 'boolean' } });
  if (!flags.ok || flags.values.help || typeof flags.values.zone !== 'string' || typeof flags.values.local !== 'string') {
    err(flags.ok ? USAGE : `${flags.message}\n${USAGE}`);
    return EXIT_USAGE;
  }
  try {
    const [zoneText, localText] = await Promise.all([readFile(flags.values.zone, 'utf8'), readFile(flags.values.local, 'utf8')]);
    const report = checkParity({ zoneJson: JSON.parse(zoneText), localJson: JSON.parse(localText) });
    out(renderParityReport(report));
    return report.ok ? EXIT_OK : EXIT_FAILED;
  } catch (error) {
    err(`Could not read the export files: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT_USAGE;
  }
}

if (isMainModule(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
