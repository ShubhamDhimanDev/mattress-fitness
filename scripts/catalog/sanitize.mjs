// Treats every spreadsheet cell as untrusted (T-14, T-15, security.md "Trust boundaries").
// Imports REJECT unsafe cells with a clear message rather than silently rewriting copy that the client
// has to approve. Outputs that a spreadsheet application may open again (reports, exports) NEUTRALISE.

/**
 * Characters that make Excel, Sheets and LibreOffice evaluate a cell as a formula (OWASP CSV injection):
 * = + - @ plus tab and carriage return.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

// An opening or closing tag, a comment, a doctype or an XML processing instruction.
// Browsers treat "< b" as text, so no whitespace is allowed between "<" and the tag name.
const HTML_TAG = /<\/?[a-zA-Z!?][^>]*>?/;

/**
 * @param {string} value
 * @returns {boolean}
 */
export function looksLikeFormula(value) {
  return FORMULA_START.test(value);
}

/**
 * For output files: prefix a single quote so a spreadsheet shows the text instead of running it.
 * @param {string} value
 * @returns {string}
 */
export function neutralizeFormula(value) {
  return looksLikeFormula(value) ? `'${value}` : value;
}

/**
 * @param {string} value
 * @returns {boolean}
 */
export function containsHtml(value) {
  return HTML_TAG.test(value);
}

/**
 * For the rare caller that must keep going with markup removed (the importer does not use it).
 * Removes tags and comments only; entities are left for the output encoder.
 * @param {string} value
 * @returns {string}
 */
export function stripHtml(value) {
  return value.replace(/<!--[\s\S]*?-->/g, '').replace(/<\/?[a-zA-Z!?][^>]*>?/g, '');
}

/**
 * Output encoding for the one place the importer builds HTML (descriptionHtml).
 * @param {string} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escapes text for a Markdown table cell in the validation report so a cell value cannot break the
 * table, inject HTML or add links.
 * @param {unknown} value
 * @returns {string}
 */
export function escapeMarkdownCell(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .replace(/[\\`*_{}[\]<>()#+!|~]/g, (char) => `\\${char}`)
    .trim();
}

/**
 * @typedef {'formula' | 'html' | 'control_chars' | 'too_long'} SanitizeCode
 * @typedef {{ ok: true, value: string, changed: boolean } | { ok: false, code: SanitizeCode, message: string }} SanitizeResult
 */

/**
 * @param {string} raw
 * @param {{ maxLength?: number, allowNewlines?: boolean, checkFormula?: boolean }} [options]
 *   checkFormula is false for numeric columns, which have their own strict parsers.
 * @returns {SanitizeResult}
 */
export function sanitizeCell(raw, { maxLength = 1000, allowNewlines = false, checkFormula = true } = {}) {
  const normalised = raw.normalize('NFC').replace(/\r\n?/g, '\n');
  const trimmed = normalised.trim();
  if (CONTROL_CHARS.test(trimmed)) {
    return { ok: false, code: 'control_chars', message: 'The cell contains an invisible control character. Retype the text.' };
  }
  if (!allowNewlines && trimmed.includes('\n')) {
    return { ok: false, code: 'control_chars', message: 'The cell contains a line break, which is not allowed in this column.' };
  }
  if (checkFormula && looksLikeFormula(trimmed)) {
    return {
      ok: false,
      code: 'formula',
      message: `The cell starts with "${trimmed[0] === '\t' ? 'a tab' : trimmed[0]}", which spreadsheets treat as a formula. Remove it or rephrase.`,
    };
  }
  if (containsHtml(trimmed)) {
    return { ok: false, code: 'html', message: 'The cell contains HTML tags. Use plain text only.' };
  }
  if ([...trimmed].length > maxLength) {
    return { ok: false, code: 'too_long', message: `The cell has ${[...trimmed].length} characters; the limit is ${maxLength}.` };
  }
  return { ok: true, value: trimmed, changed: trimmed !== raw };
}
