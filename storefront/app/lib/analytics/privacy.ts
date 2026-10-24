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
export const EMAIL = /[^\s@]+@[^\s@]+/;
// Seven or more digits in a row (allowing the usual separators) looks like a phone number, card or order number.
const LONG_DIGITS = /(?:\d[\s().-]*){7,}/;

export function looksPersonal(value: string): boolean {
  return EMAIL.test(value) || LONG_DIGITS.test(value);
}

// Ten or more digits in a row (allowing separators): a US phone number, a card, a long account number. Used for the
// values in a page address, where ordinary things (dates, product and variant ids, campaign names) hold digits too.
export const PHONE_LIKE = /(?:\d[\s().-]*){10,}/;

/**
 * Whether a query value in a page address looks like personal data. Stricter than free text would be if it used the
 * seven-digit rule: campaign tags (`utm_*`) are blocked only on an email, `variant` is a Shopify id and never checked
 * (a 14-digit variant id is normal), and everything else needs an email or a phone-like run of ten digits. Dates
 * (`2026-10-23`, `20261023`) have eight digits and pass.
 */
export function queryValueLooksPersonal(key: string, value: string): boolean {
  const name = key.toLowerCase();
  if (name === 'variant') return false;
  if (EMAIL.test(value)) return true;
  if (name.startsWith('utm_')) return false;
  return PHONE_LIKE.test(value);
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
 * query value are dropped; private paths are cut to their section. Returns null for anything that is not an
 * http(s) URL. This is the address WE choose to send (the `page_location` parameter and the GA4 `set`); it cannot
 * change what a provider's own script reads from the document, which is why `evaluatePage` also stops events
 * from pages that fail the safety check.
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
    // Click ids are opaque tokens whose letters and digits can look like a long number; only free-text campaign
    // tags are checked, and only for an email (a campaign named after a date is normal).
    const free = key.startsWith('utm_');
    if (
      ALLOWED_QUERY_KEYS.has(key) &&
      value.length <= MAX_PARAM_VALUE_LENGTH &&
      !(free && EMAIL.test(value))
    ) {
      kept.append(key, value);
    }
  }
  const query = kept.toString();
  const path = privatePathSection(url.pathname) ?? url.pathname;
  return `${url.origin}${path}${query ? `?${query}` : ''}`;
}
