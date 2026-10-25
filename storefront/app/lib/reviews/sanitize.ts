// Review text is untrusted third-party data (T-07, T-15). Everything a provider returns is reduced to plain text with length
// caps before it leaves the server; React escapes it again on render, and nothing is ever inserted as HTML.

export const MAX_BODY_LENGTH = 2000;
export const MAX_TITLE_LENGTH = 120;
const MAX_NAME_PART = 24;

// Control characters (except tab and newline, kept as whitespace below) and bidirectional overrides that can reorder text.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/g;
const TAGS = /<[^>]*>/g;

function stripMarkup(value: string): string {
  // Applied twice: removing one tag can leave the pieces of another.
  return value.replace(TAGS, ' ').replace(TAGS, ' ').replace(/[<>]/g, '');
}

/** Plain text, collapsed whitespace, cut at `max` characters (on a code point boundary) with an ellipsis. */
export function plainText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const text = stripMarkup(value.replace(CONTROL, ''))
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const points = Array.from(text);
  return points.length <= max ? text : `${points.slice(0, max - 1).join('')}…`;
}

/**
 * "Sam B." from "Sam Brown", "Sam" from "Sam", "Customer" when nothing usable. Only a first name and an initial ever
 * leave the server, so a provider that returns full names (or an email) does not publish them (T-05).
 */
export function displayAuthor(value: unknown): string {
  const name = plainText(value, 80);
  if (name === '' || name.includes('@')) return 'Customer';
  const parts = name.split(/\s+/).filter((part) => part !== '');
  const first = Array.from(parts[0] ?? '')
    .slice(0, MAX_NAME_PART)
    .join('');
  if (first === '') return 'Customer';
  const last = parts.length > 1 ? parts[parts.length - 1] : undefined;
  const initial = last === undefined ? '' : (Array.from(last)[0] ?? '');
  return /^[\p{L}\p{N}]$/u.test(initial)
    ? `${first} ${initial.toUpperCase()}.`
    : first;
}

/** YYYY-MM-DD from a provider timestamp, or null. */
export function isoDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return new Date(time).toISOString().slice(0, 10);
}
