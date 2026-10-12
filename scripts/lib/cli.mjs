// Small helpers shared by the command-line tools: strict flag parsing, plain-text tables and the
// "was this file run directly" check. Only node: builtins.

import { parseArgs } from 'node:util';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const EXIT_OK = 0;
export const EXIT_FAILED = 1; // validation errors, drift, failed writes
export const EXIT_USAGE = 2; // bad flags, unreadable input
export const EXIT_REFUSED = 3; // allow-list or --live guard said no

/**
 * Strict parsing: unknown flags are an error, not silently ignored.
 * @param {readonly string[]} argv
 * @param {Record<string, { type: 'boolean' | 'string', multiple?: boolean }>} options
 * @param {{ allowPositionals?: boolean }} [settings]
 * @returns {{ ok: true, values: Record<string, string | boolean | (string | boolean)[] | undefined>, positionals: string[] } | { ok: false, message: string }}
 */
export function parseFlags(argv, options, { allowPositionals = false } = {}) {
  try {
    const parsed = parseArgs({ args: [...argv], options, allowPositionals, strict: true });
    return { ok: true, values: parsed.values, positionals: parsed.positionals };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * @param {string} metaUrl import.meta.url of the calling module
 * @param {string | undefined} [argv1] defaults to process.argv[1]
 */
export function isMainModule(metaUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  try {
    const self = realpathSync(fileURLToPath(metaUrl));
    const entry = realpathSync(path.resolve(argv1));
    return process.platform === 'win32' ? self.toLowerCase() === entry.toLowerCase() : self === entry;
  } catch {
    return false;
  }
}

/**
 * Fixed-width plain-text table. Cells are single-lined and truncated so a hostile value cannot
 * break the layout or smuggle control characters into the terminal.
 * @param {readonly string[]} headers
 * @param {readonly (readonly unknown[])[]} rows
 * @param {{ maxCellWidth?: number }} [options]
 * @returns {string}
 */
export function renderTable(headers, rows, { maxCellWidth = 60 } = {}) {
  /** @param {unknown} value */
  const clean = (value) => {
    // eslint-disable-next-line no-control-regex
    const text = String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
    return text.length > maxCellWidth ? `${text.slice(0, maxCellWidth - 1)}…` : text;
  };
  const table = [headers.map(clean), ...rows.map((row) => row.map(clean))];
  const widths = headers.map((_, column) => Math.max(...table.map((row) => (row[column] ?? '').length)));
  /** @param {string[]} row */
  const line = (row) => widths.map((width, column) => (row[column] ?? '').padEnd(width)).join('  ').trimEnd();
  const rule = widths.map((width) => '-'.repeat(width)).join('  ');
  const [head, ...body] = table;
  return [line(head), rule, ...body.map(line)].join('\n');
}
