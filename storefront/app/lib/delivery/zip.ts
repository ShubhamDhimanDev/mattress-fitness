// US ZIP code parsing for the header ZIP check, the product-page promise and the haul-away step
// (REQ-DEL-001, REQ-DEL-002). Pure and runtime-neutral: it runs in the browser, in workers and on Node.
// The ZIP is untrusted input (query string, cookie, cart attribute), so nothing here throws.

export type ZipParseResult =
  | {ok: true; zip: string}
  | {ok: false; reason: 'not-a-string' | 'empty' | 'invalid-format'};

// Longest legitimate input is "12345 - 6789" padded by a little whitespace; anything longer is not a ZIP
// and is rejected before any pattern work.
const MAX_ZIP_INPUT_LENGTH = 32;

// ASCII digits only (not \d with a Unicode flag), exactly one hyphen or space before the +4.
// A single space is allowed because shoppers type "60601 1234"; tabs and newlines inside are not.
const ZIP_PATTERN = /^([0-9]{5})(?:[- ][0-9]{4})?$/;

/** Parses a ZIP or ZIP+4 and returns the 5-digit ZIP, or the reason it was rejected. */
export function parseZip(input: unknown): ZipParseResult {
  // Numbers are rejected on purpose: a numeric 2134 has already lost the leading zero of 02134.
  if (typeof input !== 'string') return {ok: false, reason: 'not-a-string'};
  if (input.length > MAX_ZIP_INPUT_LENGTH) {
    return {ok: false, reason: 'invalid-format'};
  }
  const trimmed = input.trim();
  if (trimmed === '') return {ok: false, reason: 'empty'};
  const match = ZIP_PATTERN.exec(trimmed);
  if (!match) return {ok: false, reason: 'invalid-format'};
  const zip = match[1];
  // The capture group always exists when the pattern matches; the check keeps the type honest without a cast.
  if (zip === undefined) return {ok: false, reason: 'invalid-format'};
  return {ok: true, zip};
}

/** The 5-digit ZIP for a valid ZIP or ZIP+4, otherwise null. */
export function normalizeZip(input: unknown): string | null {
  const result = parseZip(input);
  return result.ok ? result.zip : null;
}

export function isValidZip(input: unknown): boolean {
  return parseZip(input).ok;
}
