#!/usr/bin/env node
// Product sheet validator (REQ-CAT-001, REQ-CAT-003, T-14).
// Library: validateSheet(csvText, options) -> report. CLI: node scripts/catalog/validate.mjs <sheet.csv>.
// No import may run on failing data: import.mjs calls validateSheet itself and refuses when report.ok is false.

import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { EXIT_FAILED, EXIT_OK, EXIT_USAGE, isMainModule, parseFlags, renderTable } from '../lib/cli.mjs';
import { parseCsv } from './csv.mjs';
import { escapeMarkdownCell, sanitizeCell } from './sanitize.mjs';
import {
  ATTRIBUTE_REQUIRED_FOR,
  COLUMNS,
  DEFAULT_PRODUCT_TYPE,
  FALSE_WORDS,
  HANDLE_PATTERN,
  IMAGE_EXTENSIONS,
  LIMITS,
  LIST_SEPARATOR,
  SIZES,
  SKU_PATTERN,
  TRUE_WORDS,
  canonicalValue,
} from './schema.mjs';

/**
 * Every code the validator can emit, with its severity. The invalid sample sheet is tested to trigger
 * each error code, so a new rule without a failing example breaks the build.
 * @type {Readonly<Record<string, 'error' | 'warning'>>}
 */
export const ISSUE_CODES = Object.freeze({
  E_FILE_EMPTY: 'error',
  E_FILE_TOO_LARGE: 'error',
  E_CSV_PARSE: 'error',
  E_HEADER_MISSING: 'error',
  E_HEADER_DUPLICATE: 'error',
  E_ROW_TOO_MANY_CELLS: 'error',
  E_REQUIRED: 'error',
  E_FORMULA: 'error',
  E_HTML: 'error',
  E_CONTROL_CHARS: 'error',
  E_TOO_LONG: 'error',
  E_BAD_HANDLE: 'error',
  E_BAD_SKU: 'error',
  E_UNKNOWN_VALUE: 'error',
  E_BAD_PRICE: 'error',
  E_SALE_NOT_LOWER: 'error',
  E_BAD_NUMBER: 'error',
  E_BAD_BOOLEAN: 'error',
  E_DUPLICATE_SKU: 'error',
  E_DUPLICATE_SIZE: 'error',
  E_DUPLICATE_MODEL: 'error',
  E_INCONSISTENT_ATTRIBUTE: 'error',
  E_BAD_IMAGE_NAME: 'error',
  E_DUPLICATE_IMAGE: 'error',
  E_MISSING_IMAGE: 'error',
  E_BAD_SPEC: 'error',
  E_TOO_MANY_ITEMS: 'error',
  E_BAD_RELATED_HANDLE: 'error',
  E_APPROVED_WITHOUT_COPY: 'error',
  W_HEADER_UNKNOWN: 'warning',
  W_ROW_TOO_FEW_CELLS: 'warning',
  W_VALUE_NORMALISED: 'warning',
  W_SIZE_ORDER: 'warning',
  W_PRICE_SIZE_ORDER: 'warning',
  W_PRICE_UNUSUAL: 'warning',
  W_DEEP_DISCOUNT: 'warning',
  W_SEO_TITLE_LONG: 'warning',
  W_SEO_DESCRIPTION_LONG: 'warning',
  W_BULLETS_MANY: 'warning',
  W_MISSING_COPY: 'warning',
  W_MISSING_DIMENSIONS: 'warning',
  W_MISSING_HEIGHT: 'warning',
  W_UNAPPROVED_COPY: 'warning',
  W_IMAGES_NOT_CHECKED: 'warning',
  W_UNREFERENCED_IMAGE: 'warning',
  W_IMAGE_SHARED: 'warning',
  W_ROWS_NOT_GROUPED: 'warning',
  W_OVER_MODEL_LIMIT: 'warning',
});

/**
 * @typedef {keyof typeof ISSUE_CODES} IssueCode
 * @typedef {{ severity: 'error' | 'warning', code: IssueCode, row: number | null, column: string | null, handle: string | null, message: string, value?: string }} Issue
 * @typedef {{ size: string, dimensions: string | null, sku: string, priceCents: number, salePriceCents: number | null, row: number }} Variant
 * @typedef {object} Product
 * @property {string} handle
 * @property {string} model
 * @property {string} brand
 * @property {string | null} productLine
 * @property {string} productType
 * @property {string | null} description
 * @property {string[]} bullets
 * @property {{ label: string, value: string }[]} specifications
 * @property {string | null} seoTitle
 * @property {string | null} seoDescription
 * @property {string | null} comfortLevel
 * @property {string | null} mattressType
 * @property {string[]} sleepPositions
 * @property {string[]} benefits
 * @property {string | null} heightInches
 * @property {string | null} deliveryType
 * @property {string[]} images
 * @property {string | null} extendCategory
 * @property {string[]} relatedFoundations
 * @property {string[]} relatedProtectors
 * @property {string[]} relatedBedding
 * @property {string | null} compareGroup
 * @property {boolean} copyApproved
 * @property {number} firstRow
 * @property {Variant[]} variants
 * @typedef {object} ValidationReport
 * @property {boolean} ok            true when there are no errors (and no warnings in strict mode)
 * @property {{ rows: number, models: number, variants: number, errors: number, warnings: number, approvedModels: number, unapprovedModels: number, imagesChecked: boolean }} summary
 * @property {Issue[]} issues
 * @property {Product[]} products    only meaningful when ok is true
 */

const MAX_ISSUE_VALUE = 80;

/** @param {string} a @param {string} b */
function editDistance(a, b) {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  /** @type {number[]} */
  let previous = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= y.length; j += 1) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[y.length];
}

/** @param {readonly string[]} values @param {string} input */
function suggest(values, input) {
  let best = null;
  let bestDistance = 4;
  for (const value of values) {
    const distance = editDistance(value, input);
    if (distance < bestDistance) {
      best = value;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * "1299", "1,299.00", "$1299.5" -> cents. Anything else (negative, three decimals, words) -> null.
 * @param {string} text
 * @returns {number | null}
 */
export function parseMoneyToCents(text) {
  const cleaned = text.replace(/^\$\s*/, '');
  if (!/^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, fraction = ''] = cleaned.replace(/,/g, '').split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}

/** @param {string[]} items */
function dedupe(items) {
  return [...new Set(items)];
}

/** @param {string} text */
function splitList(text) {
  return text
    .split(LIST_SEPARATOR)
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

/** @param {import('./schema.mjs').Column} column @returns {number} cell-level cap before item-level checks */
function cellMaxLength(column) {
  switch (column.kind) {
    case 'list':
      return (LIMITS.bullet + 2) * LIMITS.maxBullets * 2;
    case 'specs':
      return (LIMITS.specKey + LIMITS.specValue + 3) * LIMITS.maxSpecs;
    case 'images':
      return (LIMITS.imageName + 2) * LIMITS.maxImages;
    case 'handleList':
      return (LIMITS.handle + 2) * LIMITS.maxRelated;
    case 'enumList':
      return 200;
    default:
      return column.maxLength ?? 1000;
  }
}

const IMAGE_NAME_PATTERN = new RegExp(`^[A-Za-z0-9][A-Za-z0-9 ._()-]*(?:${IMAGE_EXTENSIONS.map((ext) => ext.replace('.', '\\.')).join('|')})$`, 'i');

/**
 * Parse a cell of a given column. Returns the normalised value; pushes issues through `report`.
 * @typedef {(code: IssueCode, message: string, value?: string) => void} Reporter
 */

/**
 * @param {import('./schema.mjs').Column} column
 * @param {string} text sanitised cell
 * @param {Reporter} report
 * @returns {unknown} '' | string | string[] | number | boolean | {label,value}[] ; null when invalid
 */
function parseCell(column, text, report) {
  // A blank cell means "inherit from the model's other rows" for product-level columns, including yes/no ones.
  if (text === '') return emptyFor(column);
  switch (column.kind) {
    case 'text':
      return text;
    case 'handle':
      if (!HANDLE_PATTERN.test(text) || text.length > LIMITS.handle) {
        report('E_BAD_HANDLE', `"${text}" is not a valid handle. Use lowercase letters, digits and single hyphens (no spaces), up to ${LIMITS.handle} characters.`, text);
        return null;
      }
      return text;
    case 'sku':
      if (!SKU_PATTERN.test(text)) {
        report('E_BAD_SKU', `"${text}" is not a valid SKU. Use letters, digits, dot, dash, underscore or slash, with no spaces.`, text);
        return null;
      }
      return text;
    case 'enum': {
      const canonical = column.values ? canonicalValue(column.values, text) : null;
      if (!canonical) return unknownValue(column, text, report);
      if (canonical !== text) report('W_VALUE_NORMALISED', `"${text}" was read as "${canonical}".`, text);
      return canonical;
    }
    case 'enumList': {
      /** @type {string[]} */
      const out = [];
      for (const item of splitList(text)) {
        const canonical = column.values ? canonicalValue(column.values, item) : null;
        if (!canonical) {
          unknownValue(column, item, report);
          continue;
        }
        if (canonical !== item) report('W_VALUE_NORMALISED', `"${item}" was read as "${canonical}".`, item);
        out.push(canonical);
      }
      return dedupe(out);
    }
    case 'money': {
      const cents = parseMoneyToCents(text);
      if (cents === null || cents <= 0 || cents > LIMITS.maxPriceCentsHard) {
        report('E_BAD_PRICE', `"${text}" is not a valid price. Use a positive amount in US dollars such as 1299 or 1299.00.`, text);
        return null;
      }
      return cents;
    }
    case 'number': {
      if (!/^\d{1,2}(?:\.\d{1,2})?$/.test(text) || Number(text) <= 0 || Number(text) > LIMITS.heightInchesMax) {
        report('E_BAD_NUMBER', `"${text}" is not a valid number of inches. Use a positive number such as 12 or 12.5.`, text);
        return null;
      }
      return String(Number(text));
    }
    case 'bool': {
      const lowered = text.toLowerCase();
      if (TRUE_WORDS.includes(lowered)) return true;
      if (FALSE_WORDS.includes(lowered)) return false;
      report('E_BAD_BOOLEAN', `"${text}" is not yes or no.`, text);
      return null;
    }
    case 'list': {
      const items = dedupe(splitList(text));
      for (const item of items) {
        if ([...item].length > LIMITS.bullet) report('E_TOO_LONG', `A bullet has ${[...item].length} characters; the limit is ${LIMITS.bullet}.`, item);
      }
      if (items.length > LIMITS.maxBullets) report('E_TOO_MANY_ITEMS', `${items.length} bullets; the limit is ${LIMITS.maxBullets}.`);
      else if (items.length > LIMITS.softBullets) report('W_BULLETS_MANY', `${items.length} bullets; ${LIMITS.softBullets} or fewer reads better on a phone.`);
      return items;
    }
    case 'specs':
      return parseSpecs(text, report);
    case 'images':
      return parseImages(text, report);
    case 'handleList': {
      const items = dedupe(splitList(text));
      let valid = true;
      for (const item of items) {
        if (!HANDLE_PATTERN.test(item)) {
          report('E_BAD_RELATED_HANDLE', `"${item}" is not a valid product handle.`, item);
          valid = false;
        }
      }
      if (items.length > LIMITS.maxRelated) {
        report('E_TOO_MANY_ITEMS', `${items.length} related products; the limit is ${LIMITS.maxRelated}.`);
        valid = false;
      }
      return valid ? items : null;
    }
    default:
      return text;
  }
}

/** @param {import('./schema.mjs').Column} column */
function emptyFor(column) {
  return ['list', 'enumList', 'handleList', 'images', 'specs'].includes(column.kind) ? [] : '';
}

/** @param {import('./schema.mjs').Column} column @param {string} text @param {Reporter} report */
function unknownValue(column, text, report) {
  const values = column.values ?? [];
  const hint = suggest(values, text);
  report('E_UNKNOWN_VALUE', `"${text}" is not an allowed ${column.name}. Allowed: ${values.join(', ')}.${hint ? ` Did you mean "${hint}"?` : ''}`, text);
  return null;
}

/** @param {string} text @param {Reporter} report */
function parseSpecs(text, report) {
  /** @type {{ label: string, value: string }[]} */
  const specs = [];
  const seen = new Set();
  let valid = true;
  for (const item of splitList(text)) {
    const at = item.indexOf('=');
    const label = at > 0 ? item.slice(0, at).trim() : '';
    const value = at > 0 ? item.slice(at + 1).trim() : '';
    if (!label || !value) {
      report('E_BAD_SPEC', `"${item}" is not a label=value pair (for example Thickness=12 in).`, item);
      valid = false;
    } else if ([...label].length > LIMITS.specKey || [...value].length > LIMITS.specValue) {
      report('E_BAD_SPEC', `The specification "${label}" is too long (label up to ${LIMITS.specKey}, value up to ${LIMITS.specValue} characters).`, item);
      valid = false;
    } else if (seen.has(label.toLowerCase())) {
      report('E_BAD_SPEC', `The specification label "${label}" appears twice.`, label);
      valid = false;
    } else {
      seen.add(label.toLowerCase());
      specs.push({ label, value });
    }
  }
  if (specs.length > LIMITS.maxSpecs) {
    report('E_TOO_MANY_ITEMS', `${specs.length} specifications; the limit is ${LIMITS.maxSpecs}.`);
    valid = false;
  }
  return valid ? specs : null;
}

/** @param {string} text @param {Reporter} report */
function parseImages(text, report) {
  const names = splitList(text);
  /** @type {string[]} */
  const out = [];
  let valid = true;
  for (const name of names) {
    if (name.length > LIMITS.imageName || name.includes('..') || !IMAGE_NAME_PATTERN.test(name)) {
      report('E_BAD_IMAGE_NAME', `"${name}" is not a valid image file name. Use a plain file name ending in ${IMAGE_EXTENSIONS.join(', ')} with no folders.`, name);
      valid = false;
    } else if (out.includes(name)) {
      report('E_DUPLICATE_IMAGE', `The image "${name}" is listed twice for this product.`, name);
      valid = false;
    } else {
      out.push(name);
    }
  }
  if (out.length > LIMITS.maxImages) {
    report('E_TOO_MANY_ITEMS', `${out.length} images; the limit is ${LIMITS.maxImages}.`);
    valid = false;
  }
  return valid ? out : null;
}

/** @param {string} header */
function normaliseHeader(header) {
  return header.replace(/^﻿/, '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

/** @param {unknown} value */
function isEmptyValue(value) {
  return value === '' || value === null || value === undefined || (Array.isArray(value) && value.length === 0);
}

/**
 * @param {string} csvText
 * @param {{ availableImages?: ReadonlySet<string> | null, strict?: boolean }} [options]
 *   availableImages: file names present in the images folder; null skips the existence check (warned).
 * @returns {ValidationReport}
 */
export function validateSheet(csvText, { availableImages = null, strict = false } = {}) {
  /** @type {Issue[]} */
  const issues = [];
  /** @type {Product[]} */
  const products = [];

  /**
   * @param {IssueCode} code
   * @param {{ row?: number | null, column?: string | null, handle?: string | null }} where
   * @param {string} message
   * @param {string} [value]
   */
  const add = (code, where, message, value) => {
    issues.push({
      severity: ISSUE_CODES[code],
      code,
      row: where.row ?? null,
      column: where.column ?? null,
      handle: where.handle ?? null,
      message,
      ...(value !== undefined ? { value: value.length > MAX_ISSUE_VALUE ? `${value.slice(0, MAX_ISSUE_VALUE)}...` : value } : {}),
    });
  };

  const finish = (/** @type {number} */ rowCount, /** @type {boolean} */ imagesChecked) => {
    issues.sort((a, b) => (a.row ?? 0) - (b.row ?? 0) || (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
    const errors = issues.filter((issue) => issue.severity === 'error').length;
    const warnings = issues.length - errors;
    const approved = products.filter((product) => product.copyApproved).length;
    return {
      ok: errors === 0 && (!strict || warnings === 0),
      summary: {
        rows: rowCount,
        models: products.length,
        variants: products.reduce((sum, product) => sum + product.variants.length, 0),
        errors,
        warnings,
        approvedModels: approved,
        unapprovedModels: products.length - approved,
        imagesChecked,
      },
      issues,
      products: errors === 0 ? products : [],
    };
  };

  if (Buffer.byteLength(csvText, 'utf8') > LIMITS.maxFileBytes) {
    add('E_FILE_TOO_LARGE', {}, `The file is larger than ${LIMITS.maxFileBytes / (1024 * 1024)} MB. Split it or remove unused columns.`);
    return finish(0, false);
  }
  const parsed = parseCsv(csvText);
  if (!parsed.ok) {
    add('E_CSV_PARSE', { row: parsed.error.row }, parsed.error.message);
    return finish(0, false);
  }
  const [headerRecord, ...dataRecords] = parsed.records;
  if (!headerRecord) {
    add('E_FILE_EMPTY', {}, 'The file has no rows. Start from scripts/catalog/template/products.csv.');
    return finish(0, false);
  }
  if (dataRecords.length > LIMITS.maxRecords) {
    add('E_FILE_TOO_LARGE', {}, `The file has ${dataRecords.length} rows; the limit is ${LIMITS.maxRecords}.`);
    return finish(dataRecords.length, false);
  }

  // ---- header ----------------------------------------------------------------------------------
  const headers = headerRecord.fields.map(normaliseHeader);
  if (headers.length === 1 && /[;\t]/.test(headerRecord.fields[0])) {
    add('E_HEADER_MISSING', { row: 1 }, 'The header is not comma separated. In Excel choose "CSV UTF-8 (Comma delimited)" when saving.');
    return finish(dataRecords.length, false);
  }
  /** @type {Map<string, number>} */
  const columnIndex = new Map();
  headers.forEach((name, index) => {
    if (name === '') return;
    if (columnIndex.has(name)) add('E_HEADER_DUPLICATE', { row: 1, column: name }, `The column "${name}" appears more than once.`);
    else columnIndex.set(name, index);
  });
  const known = new Set(COLUMNS.map((column) => column.name));
  for (const name of columnIndex.keys()) {
    if (!known.has(name)) add('W_HEADER_UNKNOWN', { row: 1, column: name }, `The column "${name}" is not part of the template and is ignored.`);
  }
  let headerOk = !issues.some((issue) => issue.code === 'E_HEADER_DUPLICATE');
  for (const column of COLUMNS) {
    if (column.required && !columnIndex.has(column.name)) {
      add('E_HEADER_MISSING', { row: 1, column: column.name }, `The required column "${column.name}" is missing from the header.`);
      headerOk = false;
    }
  }
  if (!headerOk) return finish(dataRecords.length, false);

  // ---- rows ------------------------------------------------------------------------------------
  /** @typedef {{ row: number, values: Record<string, unknown>, handle: string | null }} ParsedRow */
  /** @type {ParsedRow[]} */
  const rows = [];
  for (const record of dataRecords) {
    if (record.fields.every((cell) => cell.trim() === '')) continue;
    if (record.fields.length > headers.length && record.fields.slice(headers.length).some((cell) => cell.trim() !== '')) {
      add('E_ROW_TOO_MANY_CELLS', { row: record.row }, `The row has ${record.fields.length} cells but the header has ${headers.length}. A comma inside text must be wrapped in quotes.`);
      continue;
    }
    if (record.fields.length < headers.length) {
      add('W_ROW_TOO_FEW_CELLS', { row: record.row }, `The row has ${record.fields.length} cells but the header has ${headers.length}; missing cells are treated as blank.`);
    }
    /** @type {Record<string, unknown>} */
    const values = {};
    const handleCell = (record.fields[columnIndex.get('handle') ?? -1] ?? '').trim();
    for (const column of COLUMNS) {
      const index = columnIndex.get(column.name);
      if (index === undefined) {
        values[column.name] = emptyFor(column);
        continue;
      }
      const raw = record.fields[index] ?? '';
      /** @type {Reporter} */
      const report = (code, message, value) => add(code, { row: record.row, column: column.name, handle: handleCell || null }, message, value);
      const clean = sanitizeCell(raw, {
        maxLength: cellMaxLength(column),
        allowNewlines: column.name === 'description',
        checkFormula: column.kind !== 'money' && column.kind !== 'number',
      });
      if (!clean.ok) {
        const code = { formula: 'E_FORMULA', html: 'E_HTML', control_chars: 'E_CONTROL_CHARS', too_long: 'E_TOO_LONG' }[clean.code];
        report(/** @type {IssueCode} */ (code), clean.message, raw);
        values[column.name] = null;
        continue;
      }
      values[column.name] = parseCell(column, clean.value, report);
    }
    rows.push({ row: record.row, values, handle: typeof values.handle === 'string' && values.handle !== '' ? values.handle : null });
  }

  // ---- row-level rules that need only the row --------------------------------------------------
  for (const row of rows) {
    const where = { row: row.row, handle: row.handle };
    if (row.values.handle === '') add('E_REQUIRED', { ...where, column: 'handle' }, 'The handle is required on every row; it groups the sizes of one model.');
    for (const column of COLUMNS) {
      if (column.level === 'variant' && column.required && row.values[column.name] === '') {
        add('E_REQUIRED', { ...where, column: column.name }, `"${column.name}" is required on every row.`);
      }
    }
    const price = row.values.price;
    const sale = row.values.sale_price;
    if (typeof price === 'number') {
      if (price < LIMITS.minPriceCents || price > LIMITS.maxPriceCents) {
        add('W_PRICE_UNUSUAL', { ...where, column: 'price' }, `The price $${(price / 100).toFixed(2)} is outside the usual range ($${LIMITS.minPriceCents / 100} to $${LIMITS.maxPriceCents / 100}). Check for a typo.`);
      }
      if (typeof sale === 'number') {
        if (sale >= price) {
          add('E_SALE_NOT_LOWER', { ...where, column: 'sale_price' }, `The sale price $${(sale / 100).toFixed(2)} must be lower than the price $${(price / 100).toFixed(2)}. Leave it blank if there is no sale.`);
        } else if (sale < price * (1 - LIMITS.deepDiscountRatio)) {
          add('W_DEEP_DISCOUNT', { ...where, column: 'sale_price' }, `The sale price is more than ${Math.round(LIMITS.deepDiscountRatio * 100)}% below the price. Check for a typo.`);
        }
      }
    } else if (typeof sale === 'number' && price === '') {
      add('E_BAD_PRICE', { ...where, column: 'sale_price' }, 'A sale price needs a regular price on the same row.');
    }
  }

  // ---- group by handle -------------------------------------------------------------------------
  /** @type {Map<string, ParsedRow[]>} */
  const groups = new Map();
  /** @type {string | null} */
  let previousHandle = null;
  const closedHandles = new Set();
  for (const row of rows) {
    if (!row.handle) continue;
    if (row.handle !== previousHandle) {
      if (previousHandle) closedHandles.add(previousHandle);
      if (closedHandles.has(row.handle)) {
        add('W_ROWS_NOT_GROUPED', { row: row.row, handle: row.handle }, `Rows for "${row.handle}" are not next to each other. They are still treated as one product.`);
      }
      previousHandle = row.handle;
    }
    const list = groups.get(row.handle) ?? [];
    list.push(row);
    groups.set(row.handle, list);
  }

  // ---- duplicates across the sheet -------------------------------------------------------------
  /** @type {Map<string, number>} */
  const skuRows = new Map();
  for (const row of rows) {
    const sku = row.values.sku;
    if (typeof sku !== 'string' || sku === '') continue;
    const key = sku.toLowerCase();
    const first = skuRows.get(key);
    if (first !== undefined) add('E_DUPLICATE_SKU', { row: row.row, column: 'sku', handle: row.handle }, `The SKU "${sku}" is already used on row ${first}. SKUs must be unique.`, sku);
    else skuRows.set(key, row.row);
  }

  // ---- per-product rules -----------------------------------------------------------------------
  /** @type {Map<string, string>} brand+model -> handle */
  const modelOwner = new Map();
  /** @type {Map<string, string>} image -> handle that first used it */
  const imageOwner = new Map();
  /** @type {Set<string>} */
  const referencedImages = new Set();
  const productColumns = COLUMNS.filter((column) => column.level === 'product');
  /** @type {string[]} */
  const unapprovedHandles = [];

  for (const [handle, group] of groups) {
    const firstRow = group[0].row;
    /** @type {Record<string, unknown>} */
    const effective = {};
    for (const column of productColumns) {
      const reference = group.find((row) => !isEmptyValue(row.values[column.name]) && row.values[column.name] !== null);
      effective[column.name] = reference ? reference.values[column.name] : emptyFor(column);
      if (!reference) continue;
      const referenceJson = JSON.stringify(reference.values[column.name]);
      for (const row of group) {
        const value = row.values[column.name];
        if (row === reference || isEmptyValue(value) || value === null) continue;
        if (JSON.stringify(value) !== referenceJson) {
          add('E_INCONSISTENT_ATTRIBUTE', { row: row.row, column: column.name, handle }, `"${column.name}" differs from row ${reference.row} for the same product (${handle}). Every size of a model must share this value (leave it blank to inherit).`, String(Array.isArray(value) ? value.join('|') : typeof value === 'object' ? JSON.stringify(value) : value));
        }
      }
    }

    const productType = typeof effective.product_type === 'string' && effective.product_type !== '' ? effective.product_type : DEFAULT_PRODUCT_TYPE;
    const isMattress = productType.toLowerCase() === ATTRIBUTE_REQUIRED_FOR.toLowerCase();
    for (const column of productColumns) {
      const missing = isEmptyValue(effective[column.name]);
      const needed = (column.required && column.name !== 'handle') || (column.requiredForMattress && isMattress);
      if (missing && needed && !group.some((row) => row.values[column.name] === null)) {
        add('E_REQUIRED', { row: firstRow, column: column.name, handle }, `"${column.name}" is required${column.requiredForMattress ? ` for ${ATTRIBUTE_REQUIRED_FOR} products` : ''} (give it on the first row of this model).`);
      }
    }

    const model = String(effective.model ?? '');
    const brand = String(effective.brand ?? '');
    if (model && brand) {
      const key = `${brand.toLowerCase()}\u0000${model.toLowerCase()}`;
      const owner = modelOwner.get(key);
      if (owner && owner !== handle) {
        add('E_DUPLICATE_MODEL', { row: firstRow, column: 'model', handle }, `The model "${model}" by ${brand} is already listed under the handle "${owner}". One model must have one handle.`);
      } else {
        modelOwner.set(key, handle);
      }
    }

    // variants: size uniqueness and ordering
    /** @type {Variant[]} */
    const variants = [];
    const sizesSeen = new Map();
    for (const row of group) {
      const size = row.values.size;
      if (typeof size === 'string' && size !== '') {
        const earlier = sizesSeen.get(size);
        if (earlier !== undefined) {
          add('E_DUPLICATE_SIZE', { row: row.row, column: 'size', handle }, `The size "${size}" is already listed for this product on row ${earlier}.`, size);
          continue;
        }
        sizesSeen.set(size, row.row);
      }
      if (typeof size === 'string' && size !== '' && typeof row.values.sku === 'string' && row.values.sku !== '' && typeof row.values.price === 'number') {
        const sale = row.values.sale_price;
        variants.push({
          size,
          dimensions: typeof row.values.dimensions === 'string' && row.values.dimensions !== '' ? row.values.dimensions : null,
          sku: row.values.sku,
          priceCents: row.values.price,
          salePriceCents: typeof sale === 'number' && sale < row.values.price ? sale : null,
          row: row.row,
        });
      }
      if (isMattress && !row.values.dimensions) {
        add('W_MISSING_DIMENSIONS', { row: row.row, column: 'dimensions', handle }, 'Dimensions are blank; the size selector shows them.');
      }
    }
    const order = variants.map((variant) => SIZES.indexOf(variant.size));
    if (order.some((position, index) => index > 0 && position < order[index - 1])) {
      add('W_SIZE_ORDER', { row: firstRow, column: 'size', handle }, `Sizes are not in the usual order (${SIZES.join(', ')}). The sizes are created in that order regardless.`);
    }
    variants.sort((a, b) => SIZES.indexOf(a.size) - SIZES.indexOf(b.size));
    for (let i = 1; i < variants.length; i += 1) {
      if (variants[i].priceCents < variants[i - 1].priceCents) {
        add('W_PRICE_SIZE_ORDER', { row: variants[i].row, column: 'price', handle }, `${variants[i].size} costs less than ${variants[i - 1].size}. Larger sizes normally cost the same or more. Check for a typo.`);
      }
    }

    // text rules
    const copyApproved = effective.copy_approved === true;
    const description = typeof effective.description === 'string' ? effective.description : '';
    const bullets = Array.isArray(effective.overview_bullets) ? effective.overview_bullets : [];
    const seoTitle = typeof effective.seo_title === 'string' ? effective.seo_title : '';
    const seoDescription = typeof effective.seo_description === 'string' ? effective.seo_description : '';
    // A cell that was rejected (formula, HTML, too long) already has an error; do not also call it "blank".
    const rejected = (/** @type {string} */ column) => group.some((groupRow) => groupRow.values[column] === null);
    const missingCopy = [
      description === '' && !rejected('description') && 'description',
      bullets.length === 0 && !rejected('overview_bullets') && 'overview_bullets',
      seoTitle === '' && !rejected('seo_title') && 'seo_title',
      seoDescription === '' && !rejected('seo_description') && 'seo_description',
    ].filter(Boolean);
    if (copyApproved && missingCopy.length > 0) {
      add('E_APPROVED_WITHOUT_COPY', { row: firstRow, column: 'copy_approved', handle }, `Marked approved but these are blank: ${missingCopy.join(', ')}. Only approved copy is published (CLR-017).`);
    } else if (missingCopy.length > 0) {
      add('W_MISSING_COPY', { row: firstRow, column: String(missingCopy[0]), handle }, `Copy still to be drafted: ${missingCopy.join(', ')}.`);
    }
    if (!copyApproved) unapprovedHandles.push(handle);
    if ([...seoTitle].length > LIMITS.seoTitleSoft) add('W_SEO_TITLE_LONG', { row: firstRow, column: 'seo_title', handle }, `The SEO title has ${[...seoTitle].length} characters; search results cut it off after about ${LIMITS.seoTitleSoft}.`);
    if ([...seoDescription].length > LIMITS.seoDescriptionSoft) add('W_SEO_DESCRIPTION_LONG', { row: firstRow, column: 'seo_description', handle }, `The SEO description has ${[...seoDescription].length} characters; search results cut it off after about ${LIMITS.seoDescriptionSoft}.`);
    if (isMattress && isEmptyValue(effective.height_inches) && !rejected('height_inches')) add('W_MISSING_HEIGHT', { row: firstRow, column: 'height_inches', handle }, 'Height is blank; the comparison table shows it.');

    // related add-ons must not point at themselves
    for (const key of ['related_foundations', 'related_protectors', 'related_bedding']) {
      const list = effective[key];
      if (Array.isArray(list) && list.includes(handle)) {
        add('E_BAD_RELATED_HANDLE', { row: firstRow, column: key, handle }, 'A product cannot list itself as a related product.', handle);
      }
    }

    // images
    const images = Array.isArray(effective.images) ? /** @type {string[]} */ (effective.images) : [];
    for (const name of images) {
      referencedImages.add(name);
      const owner = imageOwner.get(name);
      if (owner && owner !== handle) add('W_IMAGE_SHARED', { row: firstRow, column: 'images', handle }, `The image "${name}" is also used by "${owner}".`, name);
      else imageOwner.set(name, handle);
      if (availableImages && !availableImages.has(name)) {
        const lowered = [...availableImages].find((candidate) => candidate.toLowerCase() === name.toLowerCase());
        add('E_MISSING_IMAGE', { row: firstRow, column: 'images', handle }, `The image "${name}" was not found in the images folder.${lowered ? ` A file named "${lowered}" exists; file names are case-sensitive.` : ''}`, name);
      }
    }

    products.push({
      handle,
      model,
      brand,
      productLine: textOrNull(effective.product_line),
      productType,
      description: description === '' ? null : description,
      bullets: /** @type {string[]} */ (bullets),
      specifications: Array.isArray(effective.specifications) ? /** @type {{label: string, value: string}[]} */ (effective.specifications) : [],
      seoTitle: seoTitle === '' ? null : seoTitle,
      seoDescription: seoDescription === '' ? null : seoDescription,
      comfortLevel: textOrNull(effective.comfort_level),
      mattressType: textOrNull(effective.mattress_type),
      sleepPositions: listOrEmpty(effective.sleep_positions),
      benefits: listOrEmpty(effective.benefits),
      heightInches: textOrNull(effective.height_inches),
      deliveryType: textOrNull(effective.delivery_type),
      images,
      extendCategory: textOrNull(effective.extend_category),
      relatedFoundations: listOrEmpty(effective.related_foundations),
      relatedProtectors: listOrEmpty(effective.related_protectors),
      relatedBedding: listOrEmpty(effective.related_bedding),
      compareGroup: textOrNull(effective.compare_group),
      copyApproved,
      firstRow,
      variants,
    });
  }

  if (unapprovedHandles.length > 0) {
    const shown = unapprovedHandles.slice(0, 5).join(', ');
    add('W_UNAPPROVED_COPY', { column: 'copy_approved' }, `${unapprovedHandles.length} product(s) have copy that is not approved yet and import as drafts (not published): ${shown}${unapprovedHandles.length > 5 ? ', ...' : ''}.`);
  }
  if (availableImages) {
    const unreferenced = [...availableImages].filter((name) => !referencedImages.has(name)).sort();
    if (unreferenced.length > 0) {
      const shown = unreferenced.slice(0, 10).join(', ');
      add('W_UNREFERENCED_IMAGE', {}, `${unreferenced.length} file(s) in the images folder are not used by any product: ${shown}${unreferenced.length > 10 ? ', ...' : ''}.`);
    }
  } else {
    add('W_IMAGES_NOT_CHECKED', {}, 'No images folder was given, so image file names were checked for format only. Pass --images <folder> to check they exist.');
  }
  if (products.length > LIMITS.maxModels) {
    add('W_OVER_MODEL_LIMIT', {}, `${products.length} models exceeds the ${LIMITS.maxModels} products in the agreed scope; more are added by change request.`);
  }
  return finish(rows.length, availableImages !== null);
}

/** @param {unknown} value @returns {string | null} */
function textOrNull(value) {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** @param {unknown} value @returns {string[]} */
function listOrEmpty(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

// ---- reports -----------------------------------------------------------------------------------

/**
 * @param {ValidationReport} report
 * @param {{ source?: string, maxRowsPerSection?: number }} [options]
 * @returns {string}
 */
export function renderMarkdownReport(report, { source = 'product sheet', maxRowsPerSection = 500 } = {}) {
  const { summary } = report;
  const lines = [];
  lines.push('# Product sheet validation report', '');
  lines.push(`Source: ${escapeMarkdownCell(source)}`, '');
  lines.push(`**Result: ${report.ok ? 'PASSED' : 'FAILED'}** (${summary.errors} errors, ${summary.warnings} warnings)`, '');
  lines.push('| Rows read | Models | Sizes (variants) | Copy approved | Copy not approved | Images checked |', '|---|---|---|---|---|---|');
  lines.push(`| ${summary.rows} | ${summary.models} | ${summary.variants} | ${summary.approvedModels} | ${summary.unapprovedModels} | ${summary.imagesChecked ? 'yes' : 'no'} |`, '');
  lines.push(
    '## How to read this report',
    '',
    '- **Errors** must be fixed before anything can be imported. The import tool refuses to run while any error remains.',
    '- **Warnings** do not block the import. They point at things that are probably unintended (for example a price typo) or work still to do (copy not approved).',
    '- **Row** is the row number you see in Excel or Google Sheets (the header is row 1).',
    '',
  );
  /** @param {string} title @param {Issue[]} list */
  const section = (title, list) => {
    lines.push(`## ${title} (${list.length})`, '');
    if (list.length === 0) {
      lines.push('None.', '');
      return;
    }
    lines.push('| Row | Column | Code | Problem |', '|---|---|---|---|');
    for (const issue of list.slice(0, maxRowsPerSection)) {
      lines.push(`| ${issue.row ?? ''} | ${escapeMarkdownCell(issue.column ?? '')} | ${issue.code} | ${escapeMarkdownCell(issue.message)} |`);
    }
    if (list.length > maxRowsPerSection) lines.push('', `Only the first ${maxRowsPerSection} are shown here; the JSON report has all ${list.length}.`);
    lines.push('');
  };
  section('Errors', report.issues.filter((issue) => issue.severity === 'error'));
  section('Warnings', report.issues.filter((issue) => issue.severity === 'warning'));
  if (report.products.length > 0) {
    lines.push('## Models', '', '| Handle | Model | Brand | Sizes | Images | Copy approved |', '|---|---|---|---|---|---|');
    for (const product of report.products.slice(0, maxRowsPerSection)) {
      lines.push(`| ${escapeMarkdownCell(product.handle)} | ${escapeMarkdownCell(product.model)} | ${escapeMarkdownCell(product.brand)} | ${escapeMarkdownCell(product.variants.map((variant) => variant.size).join(', '))} | ${product.images.length} | ${product.copyApproved ? 'yes' : 'no'} |`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

/**
 * @param {ValidationReport} report
 * @returns {string} compact console summary
 */
export function renderConsoleSummary(report) {
  const { summary } = report;
  const head = `${report.ok ? 'PASSED' : 'FAILED'}: ${summary.rows} rows, ${summary.models} models, ${summary.variants} sizes, ${summary.errors} errors, ${summary.warnings} warnings`;
  const shown = report.issues.slice(0, 40);
  if (shown.length === 0) return head;
  const table = renderTable(['row', 'severity', 'column', 'code', 'problem'], shown.map((issue) => [issue.row ?? '', issue.severity, issue.column ?? '', issue.code, issue.message]), { maxCellWidth: 110 });
  return `${head}\n${table}${report.issues.length > shown.length ? `\n... ${report.issues.length - shown.length} more (see --report or --json)` : ''}`;
}

// ---- images folder -----------------------------------------------------------------------------

/**
 * A folder of image files, or a .txt file with one file name per line (handy for reviews without the files).
 * @param {string} target
 * @returns {Promise<Set<string>>}
 */
export async function loadAvailableImages(target) {
  const info = await stat(target);
  if (info.isDirectory()) {
    const entries = await readdir(target, { withFileTypes: true });
    return new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
  }
  const text = await readFile(target, 'utf8');
  return new Set(text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '' && !line.startsWith('#')));
}

// ---- CLI ---------------------------------------------------------------------------------------

const USAGE = `Usage: node scripts/catalog/validate.mjs <sheet.csv> [options]

  --images <folder|list.txt>  check that every image named in the sheet exists
  --json <file>               write the full report as JSON
  --report <file>             write the report as Markdown
  --strict                    treat warnings as errors
Exit code: 0 passed, 1 errors found, 2 usage or file problem.`;

/**
 * @param {readonly string[]} argv
 * @param {{ out?: (text: string) => void, err?: (text: string) => void }} [io]
 * @returns {Promise<number>}
 */
export async function main(argv, { out = (text) => console.log(text), err = (text) => console.error(text) } = {}) {
  const flags = parseFlags(argv, { images: { type: 'string' }, json: { type: 'string' }, report: { type: 'string' }, strict: { type: 'boolean' }, help: { type: 'boolean' } }, { allowPositionals: true });
  if (!flags.ok || flags.values.help || flags.positionals.length !== 1) {
    err(flags.ok ? USAGE : `${flags.message}\n${USAGE}`);
    return EXIT_USAGE;
  }
  const file = flags.positionals[0];
  try {
    const text = await readFile(file, 'utf8');
    const images = typeof flags.values.images === 'string' ? await loadAvailableImages(flags.values.images) : null;
    const report = validateSheet(text, { availableImages: images, strict: flags.values.strict === true });
    out(renderConsoleSummary(report));
    if (typeof flags.values.json === 'string') await writeFile(flags.values.json, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    if (typeof flags.values.report === 'string') await writeFile(flags.values.report, renderMarkdownReport(report, { source: path.basename(file) }), 'utf8');
    return report.ok ? EXIT_OK : EXIT_FAILED;
  } catch (error) {
    err(`Could not read or write a file: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT_USAGE;
  }
}

if (isMainModule(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
