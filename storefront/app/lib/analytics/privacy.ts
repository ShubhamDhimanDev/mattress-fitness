// What may leave the browser (threat T-05, REQ-ANL-002 "no PII"). Every event parameter passes through these checks
// on its way to a provider, so a careless call site cannot send a name, an email, a phone number, a ZIP code or an
// order number as a parameter. Allow-lists first, patterns second: a value is sent because it is known to be safe,
// and a pattern only catches the mistakes the allow-list cannot see. What the providers' own scripts read from the
// page (address, title, referrer) is handled in `page-context.ts`.

import type {AnalyticsParamValue} from '~/lib/analytics';

export const MAX_PARAM_VALUE_LENGTH = 100;
export const MAX_PARAM_COUNT = 25;
const MAX_SEARCH_TERM_LENGTH = 100;

// GA4 parameter names: lower-case letters, digits and underscores, starting with a letter, at most 40 characters.
const PARAM_NAME = /^[a-z][a-z0-9_]{0,39}$/;
// A parameter whose name suggests personal data is dropped even if a caller tries to send it.
const PII_PARAM_NAME =
  /email|e_mail|phone|mobile|zip|postal|postcode|address|street|first_?name|last_?name|full_?name|customer|order_?(id|number|name)|card|password|token|secret/;
// In a page address a bare `name` key (or one ending in `_name`) carries a person's name; event parameters such as
// `item_name` are product names, so this applies to address keys only.
const URL_NAME_KEY = /(?:^|[_.-])name$/;
export const EMAIL = /[^\s@]+@[^\s@]+/;
// Seven or more digits in a row (allowing the usual separators) looks like a phone number, card or order number.
const LONG_DIGITS = /(?:\d[\s().-]*){7,}/;

export function looksPersonal(value: string): boolean {
  return EMAIL.test(value) || LONG_DIGITS.test(value);
}

// Ten or more digits in a row (allowing separators): a US phone number, a card, a long account number.
export const PHONE_LIKE = /(?:\d[\s().-]*){10,}/;
// A value that is, as a whole, a US phone number (with or without +1, spaces, dots, dashes or brackets).
const PHONE_WHOLE = /^\+?1?[\s().-]*\d{3}[\s().-]*\d{3}[\s().-]*\d{4}$/;
// A date written as a whole value: 2026-10-23 or 20261023.
const DATE_WHOLE = /^(?:\d{4}-\d{2}-\d{2}|\d{8})$/;
const SHOPIFY_GID = /^gid:\/\/shopify\/[A-Za-z]+\/\d{1,20}$/;
const PLAIN_ID = /^\d{1,20}$/;

/**
 * Query keys whose values are opaque tokens (ad-click ids and email-tool ids) that hold long digit runs by design.
 * They are exempt from the digit rules only: they are still checked for an email.
 */
export const OPAQUE_QUERY_KEYS: ReadonlySet<string> = new Set([
  'gclid',
  'gbraid',
  'wbraid',
  'dclid',
  'fbclid',
  'msclkid',
  'srsltid',
  '_kx',
  'mc_eid',
  'mc_cid',
]);

/** The value as typed, once decoded and twice decoded (a double-encoded "%2540" is still an @ after two rounds). */
function decodedForms(value: string): string[] {
  const forms = [value];
  let current = value;
  for (let round = 0; round < 2; round += 1) {
    try {
      const next = decodeURIComponent(current);
      if (next === current) break;
      forms.push(next);
      current = next;
    } catch {
      break;
    }
  }
  return forms;
}

export function containsEmail(value: string): boolean {
  return decodedForms(value).some((form) => EMAIL.test(form));
}

/**
 * Whether a query value in a page address looks like personal data. Every value is checked for an email, after up
 * to two rounds of decoding. Then, by key:
 *  - a key that names personal data (email, phone, zip, name, address, token...) with any value is personal;
 *  - an ad-click or email-tool id (OPAQUE_QUERY_KEYS) may hold any digits;
 *  - `utm_*` campaign tags may hold long id-like digit runs, but a value that is, as a whole, a phone number is personal;
 *  - `variant` is a Shopify id: digits or a gid pass, any other shape is judged like an ordinary value;
 *  - every other value is personal at seven or more digits (a phone number, a card, an order number), except a date
 *    written as the whole value (`2026-10-23`, `20261023`).
 */
export function queryValueLooksPersonal(key: string, value: string): boolean {
  const name = key.toLowerCase();
  if (containsEmail(value)) return true;
  if (
    value.trim() !== '' &&
    (PII_PARAM_NAME.test(name) || URL_NAME_KEY.test(name))
  ) {
    return true;
  }
  if (OPAQUE_QUERY_KEYS.has(name)) return false;
  const trimmed = value.trim();
  if (name.startsWith('utm_')) return PHONE_WHOLE.test(trimmed);
  if (
    name === 'variant' &&
    (PLAIN_ID.test(trimmed) || SHOPIFY_GID.test(trimmed))
  ) {
    return false;
  }
  if (DATE_WHOLE.test(trimmed)) return false;
  return LONG_DIGITS.test(value);
}

/** The URL fragment is never sent, but it is judged: an email or a phone-like run of digits makes the page unsafe. */
export function fragmentLooksPersonal(hash: string): boolean {
  const fragment = hash.startsWith('#') ? hash.slice(1) : hash;
  return (
    containsEmail(fragment) ||
    decodedForms(fragment).some((form) => PHONE_LIKE.test(form))
  );
}

/**
 * The flat parameters of an event, reduced to what is safe: a valid name, a finite number or a short string that
 * does not look like an email or a long number. Strings are cut at 100 characters (the GA4 limit).
 */
export function sanitizeParams(
  params: Readonly<Record<string, AnalyticsParamValue>>,
): Record<string, AnalyticsParamValue> {
  const safe: Record<string, AnalyticsParamValue> = {};
  let count = 0;
  for (const [key, value] of Object.entries(params)) {
    if (count >= MAX_PARAM_COUNT) break;
    if (!PARAM_NAME.test(key) || PII_PARAM_NAME.test(key)) continue;
    if (key === 'page_location') {
      // Reduced again here and exempt from the digit rule: paths legitimately hold digits.
      const location = sanitizePageLocation(value);
      if (location !== null) {
        safe[key] = location;
        count += 1;
      }
      continue;
    }
    if (typeof value === 'number') {
      if (Number.isFinite(value)) {
        safe[key] = value;
        count += 1;
      }
      continue;
    }
    if (typeof value !== 'string' || looksPersonal(value)) continue;
    safe[key] = value.slice(0, MAX_PARAM_VALUE_LENGTH);
    count += 1;
  }
  return safe;
}

/** A shopper's search words, or null when empty or when they look like personal data. */
export function sanitizeSearchTerm(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const term = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_SEARCH_TERM_LENGTH);
  if (term === '' || looksPersonal(term)) return null;
  return term;
}

// The only query parameters in the address we report: campaign tags and ad-click ids, which attribution needs.
// Everything else (search words, filters, a ZIP) stays out of it.
const ALLOWED_QUERY_KEYS: ReadonlySet<string> = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'gclid',
  'fbclid',
]);

// Pages that show or collect a person's data, or whose address holds a secret: the order and account area, the
// guest order lookup, the delivery ZIP form, the pre-checkout steps and discount links. Nothing is sent from them
// (see `evaluatePage`), and as a referrer or a reported address they are cut to the section (T-05, T-10).
export const PRIVATE_PATH_PREFIXES: readonly string[] = [
  '/account',
  '/track-order',
  '/delivery',
  '/checkout-steps',
  '/discount',
];

/** The path as the router would match it: decoded, lower-cased, repeated slashes collapsed. */
function normalizedPath(pathname: string): string {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // A malformed escape is compared as written.
  }
  return decoded.toLowerCase().replace(/\/{2,}/g, '/');
}

/** The private prefix a path falls under, or null. `/account` and `/account/orders/1`, not `/accounting`. */
export function privatePathSection(pathname: string): string | null {
  const path = normalizedPath(pathname);
  for (const prefix of PRIVATE_PATH_PREFIXES) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return prefix;
  }
  return null;
}

export function isPrivatePath(pathname: string): boolean {
  return privatePathSection(pathname) !== null;
}

/**
 * The page address to report: origin and path, plus campaign parameters only. Search words, filters and every other
 * query value are dropped; private paths are cut to their section; the fragment is dropped. Returns null for anything
 * that is not an http(s) URL. This is the address WE choose to send (the `page_location` parameter and the GA4
 * `set`); it cannot change what a provider's own script reads from the document, which is why `evaluatePage` also
 * stops events from pages that fail the safety check.
 */
export function sanitizePageLocation(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const kept = new URLSearchParams();
  for (const [key, value] of url.searchParams) {
    if (
      ALLOWED_QUERY_KEYS.has(key) &&
      value.length <= MAX_PARAM_VALUE_LENGTH &&
      !queryValueLooksPersonal(key, value)
    ) {
      kept.append(key, value);
    }
  }
  const query = kept.toString();
  const path = privatePathSection(url.pathname) ?? url.pathname;
  return `${url.origin}${path}${query ? `?${query}` : ''}`;
}
