// What may leave the browser (threat T-05, REQ-ANL-002 "no PII"). Every event passes through these checks on its
// way to a provider, so a careless call site cannot send a name, an email, a phone number, a ZIP code or an order
// number. Allow-lists first, patterns second: a value is sent because it is known to be safe, and a pattern only
// catches the mistakes the allow-list cannot see.

import type {AnalyticsParamValue} from '~/lib/analytics';

export const MAX_PARAM_VALUE_LENGTH = 100;
export const MAX_PARAM_COUNT = 25;
const MAX_SEARCH_TERM_LENGTH = 100;

// GA4 parameter names: lower-case letters, digits and underscores, starting with a letter, at most 40 characters.
const PARAM_NAME = /^[a-z][a-z0-9_]{0,39}$/;
// A parameter whose name suggests personal data is dropped even if a caller tries to send it.
const PII_PARAM_NAME =
  /email|e_mail|phone|mobile|zip|postal|postcode|address|street|first_?name|last_?name|full_?name|customer|order_?(id|number|name)|card|password|token|secret/;
const EMAIL = /[^\s@]+@[^\s@]+/;
// Seven or more digits in a row (allowing the usual separators) looks like a phone number, card or order number.
const LONG_DIGITS = /(?:\d[\s().-]*){7,}/;

export function looksPersonal(value: string): boolean {
  return EMAIL.test(value) || LONG_DIGITS.test(value);
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

// The only query parameters that reach a provider: campaign tags and ad-click ids, which attribution needs.
// Everything else (search words, filters, a ZIP) stays out of the page address we report.
const ALLOWED_QUERY_KEYS: ReadonlySet<string> = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'gclid',
  'fbclid',
]);

// Paths whose address names a person's record or a secret: reported as the section only.
const PRIVATE_PATH_PREFIXES = ['/account', '/discount', '/checkout-steps'];

function reportedPath(pathname: string): string {
  for (const prefix of PRIVATE_PATH_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return prefix;
  }
  return pathname;
}

/**
 * The page address to report: origin and path, plus campaign parameters. Account, discount-code and checkout-step
 * paths are cut to their section. Returns null for anything that is not an http(s) URL.
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
    // tags are checked for personal data.
    const free = key.startsWith('utm_');
    if (
      ALLOWED_QUERY_KEYS.has(key) &&
      value.length <= MAX_PARAM_VALUE_LENGTH &&
      !(free && looksPersonal(value))
    ) {
      kept.append(key, value);
    }
  }
  const query = kept.toString();
  return `${url.origin}${reportedPath(url.pathname)}${query ? `?${query}` : ''}`;
}
