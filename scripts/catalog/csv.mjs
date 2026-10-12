// RFC 4180 CSV reader and writer with no dependencies.
// Accepts: UTF-8 BOM, CRLF / LF / lone CR record ends, quoted fields with embedded commas, quotes
// ("") and newlines, and a missing final newline. Rejects: unterminated quotes and text after a
// closing quote. A bare quote inside an unquoted field is kept literally (spreadsheet exports do this).
// Rows are returned with the spreadsheet row number (header = 1) so reports match what the client sees.

/**
 * @typedef {{ row: number, fields: string[] }} CsvRecord
 * @typedef {{ ok: true, records: CsvRecord[] } | { ok: false, error: { row: number, message: string } }} CsvParseResult
 */

/**
 * @param {string} input
 * @returns {CsvParseResult}
 */
export function parseCsv(input) {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  /** @type {CsvRecord[]} */
  const records = [];
  /** @type {string[]} */
  let fields = [];
  let field = '';
  let inQuotes = false;
  let afterClosingQuote = false;
  let fieldStarted = false;
  let recordNumber = 1;
  let recordHasContent = false;

  const endField = () => {
    fields.push(field);
    field = '';
    fieldStarted = false;
    afterClosingQuote = false;
  };
  const endRecord = () => {
    endField();
    // A completely empty line (one empty field) is a spreadsheet artefact, not a record.
    if (recordHasContent || fields.length > 1 || fields[0] !== '') records.push({ row: recordNumber, fields });
    fields = [];
    recordNumber += 1;
    recordHasContent = false;
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
          afterClosingQuote = true;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === ',') {
      endField();
      recordHasContent = true;
      continue;
    }
    if (char === '\r' || char === '\n') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      endRecord();
      continue;
    }
    if (afterClosingQuote) {
      return { ok: false, error: { row: recordNumber, message: 'Text found after a closing quote. Quotes inside a quoted cell must be doubled ("").' } };
    }
    if (char === '"' && !fieldStarted) {
      inQuotes = true;
      fieldStarted = true;
      recordHasContent = true;
      continue;
    }
    fieldStarted = true;
    recordHasContent = true;
    field += char;
  }
  if (inQuotes) {
    return { ok: false, error: { row: recordNumber, message: 'A quoted cell is never closed (missing closing quote).' } };
  }
  if (fieldStarted || field !== '' || fields.length > 0 || afterClosingQuote) endRecord();
  return { ok: true, records };
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function quoteField(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]|^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * @param {readonly (readonly unknown[])[]} rows
 * @param {{ eol?: string, bom?: boolean }} [options] eol defaults to CRLF as RFC 4180 says
 * @returns {string}
 */
export function stringifyCsv(rows, { eol = '\r\n', bom = false } = {}) {
  const body = rows.map((row) => row.map(quoteField).join(',')).join(eol);
  return `${bom ? '﻿' : ''}${body}${rows.length > 0 ? eol : ''}`;
}
