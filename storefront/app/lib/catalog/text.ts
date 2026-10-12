// Small text hygiene helpers for untrusted strings (URLs, admin-managed
// configuration, spreadsheet-derived store data). React escapes text on render;
// these keep stray control and invisible characters out of stored and logged
// values and out of attribute comparisons (threats T-07, T-15).

/** True for C0/C1 control characters, including NUL, tab and newline. */
export function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

/**
 * Fast non-cryptographic 53-bit hash (cyrb53) as a hex string. Good for change
 * detection and for keeping raw values out of in-memory keys; it is NOT a
 * security primitive and must never protect a secret.
 */
export function hashString(value: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

// Zero-width and bidirectional-override characters used to disguise text.
// Written as code point ranges so this file holds no invisible characters itself.
const INVISIBLE_RANGES: readonly (readonly [number, number])[] = [
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x2064],
  [0xfeff, 0xfeff],
];
const HTML_TAG = /<\/?[a-zA-Z!][^>]*>/g;

/** Removes zero-width and bidirectional-override characters, nothing else. */
export function removeInvisibleCharacters(value: string): string {
  let result = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    const invisible = INVISIBLE_RANGES.some(
      ([first, last]) => code >= first && code <= last,
    );
    if (!invisible) result += char;
  }
  return result;
}

/**
 * Plain single-line text: control and invisible characters become spaces or are
 * removed, HTML tags are stripped, whitespace is collapsed and trimmed.
 */
export function cleanText(value: string): string {
  let result = '';
  for (const char of value.normalize('NFC')) {
    result += hasControlCharacter(char) ? ' ' : char;
  }
  return removeInvisibleCharacters(result)
    .replace(HTML_TAG, '')
    .replace(/\s+/g, ' ')
    .trim();
}
