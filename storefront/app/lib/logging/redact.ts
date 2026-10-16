// The one redaction layer for everything the server logs (P7-08, NFR-010, threats T-04 and T-05).
//
// Principle: log ids, codes and counts; never names, e-mail addresses, phone numbers, addresses, ZIP codes,
// tokens or cart keys. The rule is kept by the callers, who pass ids and codes only. This layer is a best-effort
// net under it, NOT a guarantee: free text can hold personal data in a shape no pattern knows (a name in a
// sentence, an address without a street suffix, a phone number written in words), so never log such text on the
// strength of this layer. It works two ways on any value:
//   1. By key. A field whose name says it holds personal or secret data (`email`, `zip`, `cartId`, `token`...)
//      is replaced whole, whatever its type (a boolean, null and a small whole number under a counter-style name such
//      as `sessionCount` are the exceptions, see mustRedactValue).
//   2. By content. Strings are scanned for e-mail addresses, phone numbers, card numbers, bearer and vendor
//      tokens, long random-looking tokens, `key=value` pairs with a sensitive key (query strings, cookies and
//      JSON text), checkout and cart URLs, and street addresses.
// Pure and total: it never throws, bounds its own work on hostile input (length caps, depth, breadth, cycles),
// and returns data that is safe to JSON.stringify.

export const REDACTED = '[redacted]';

// Bounds on hostile input: nothing here may take unbounded time or space.
const MAX_SCANNED_CHARS = 4000;
const MAX_OUTPUT_CHARS = 500;
const MAX_DEPTH = 5;
const MAX_KEYS = 40;
const MAX_ITEMS = 25;
const MAX_KEY_CHARS = 60;

// --- By key ------------------------------------------------------------------------------------------------

/** Key names (lower case, letters and digits only) that are sensitive when they are the whole name. */
const SENSITIVE_EXACT_KEYS: ReadonlySet<string> = new Set([
  'key',
  'auth',
  'sid',
  'cart',
  'name',
  'note',
  'card',
  'tel',
  'mobile',
  'mail',
  'pan',
  'ssn',
  'dob',
  'username',
  'customer',
  'buyer',
  'buyeridentity',
  'shippingaddress',
  'billingaddress',
  // Where a person is, what they typed and what they use: a bare word that is too common to match as a fragment.
  'city',
  'ip',
  'query',
  'term',
  'q',
  'useragent',
  // Short or abbreviated names for the same things.
  'pc',
  'zp',
  'cell',
  'recipient',
  'birthday',
]);

/** Fragments that make a key sensitive wherever they appear (`shippingZip`, `x-api-key`, `cartKey`...). */
const SENSITIVE_FRAGMENTS: readonly string[] = [
  'email',
  'phone',
  'firstname',
  'lastname',
  'fullname',
  'customername',
  'shippingname',
  'billingname',
  'address',
  'street',
  'zip',
  'postal',
  'postcode',
  'token',
  'secret',
  'password',
  'passwd',
  'authorization',
  'cookie',
  'session',
  'apikey',
  'accesskey',
  'privatekey',
  'signature',
  'hmac',
  'cartkey',
  'cartid',
  'checkouturl',
  'creditcard',
  'cardnumber',
  'cvv',
  'cvc',
  'shippingcity',
  'billingcity',
  'searchterm',
  'searchquery',
  'forwardedfor',
  'clientip',
  'useragent',
  'shipto',
  'contactname',
  'msisdn',
  'dateofbirth',
  'ordernote',
  'recipient',
  'giftmessage',
];

/** True when a field of this name must never be logged. Case, separators and prefixes do not matter. */
export function isSensitiveKey(key: string): boolean {
  const normal = key
    .slice(0, MAX_KEY_CHARS)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  if (normal === '') return false;
  return (
    SENSITIVE_EXACT_KEYS.has(normal) ||
    SENSITIVE_FRAGMENTS.some((fragment) => normal.includes(fragment))
  );
}

// A whole number under a key like `sessionCount` or `addressCount` is a counter, not the thing the fragment names: it
// carries nothing personal, and blanking it would hide useful numbers from the log. Only a key that ends in one of
// these words (and has something before it) qualifies. An exact sensitive key (`zip`, `phone`, `name`) and every key
// that merely contains a fragment (`shippingZip`, `phoneNumber`) is redacted whatever the type. Strings are never
// exempt: `tokenCount: 'abc123'` is text and goes.
const COUNTER_SUFFIXES: readonly string[] = [
  'count',
  'counts',
  'total',
  'length',
  'size',
  'ttl',
  'age',
  'attempts',
  'retries',
  'limit',
  'index',
  'ms',
  'seconds',
];
const MAX_COUNTER_VALUE = 1_000_000_000;

function isCounterKey(key: string): boolean {
  const normal = key
    .slice(0, MAX_KEY_CHARS)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  return (
    !SENSITIVE_EXACT_KEYS.has(normal) &&
    COUNTER_SUFFIXES.some(
      (suffix) => normal.length > suffix.length && normal.endsWith(suffix),
    )
  );
}

/**
 * True when the value of this field must be replaced. A boolean, null or undefined carries no information; a small
 * whole number under a counter-style key (`sessionCount`) passes; everything else under a sensitive key goes.
 */
export function mustRedactValue(key: string, value: unknown): boolean {
  if (value === null || value === undefined || typeof value === 'boolean') {
    return false;
  }
  if (!isSensitiveKey(key)) return false;
  if (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_COUNTER_VALUE &&
    isCounterKey(key)
  ) {
    return false;
  }
  return true;
}

// --- By content --------------------------------------------------------------------------------------------

// `key=value`, `key: value`, `"key":"value"` and the URL-encoded forms. Only the key and its separator are matched
// here; the value is read by valueEnd. The key is at most 40 characters so the scan stays linear, and whether it
// is sensitive is decided by isSensitiveKey, the same rule as for object keys. JSON that was itself put inside a
// string has escaped quotes (`{\"firstName\":\"Jane\"}`), so a quote in the separator may follow up to four
// backslashes.
const KEY_SEPARATOR =
  /([\w-]{1,40})((?:\\{1,4}["']|["'])?\s*(?:=|:|%3[Dd])\s*)/g;
const MAX_VALUE_CHARS = 200;
// Ends an unquoted value at once: a newline, or a delimiter of query strings, cookies and JSON. A space or a comma
// does not, because addresses contain both; NEXT_KEY ends it there when another pair starts.
const VALUE_STOP = /[\n\r&"';}]/;
const NEXT_KEY = /^[\s,]+[\w-]{1,40}(?:=|:|%3[Dd])/;
const MAX_NEXT_KEY_PROBE = 60;

const MAX_ESCAPES = 4;

/** The quote that opens a value at `from`: `"`, `'`, or one preceded by up to four backslashes (escaped JSON). */
function openingQuote(text: string, from: number): string {
  let slashes = 0;
  while (slashes <= MAX_ESCAPES && text.charAt(from + slashes) === '\\') {
    slashes += 1;
  }
  if (slashes > MAX_ESCAPES) return '';
  const quote = text.charAt(from + slashes);
  return quote === '"' || quote === "'"
    ? text.slice(from, from + slashes + 1)
    : '';
}

/** Where the value that starts at `from` ends, and the quote that wraps it, if any. */
function valueEnd(text: string, from: number): {end: number; quote: string} {
  const opening = openingQuote(text, from);
  if (opening !== '') {
    const bodyStart = from + opening.length;
    const limit = Math.min(text.length, bodyStart + MAX_VALUE_CHARS);
    const close = text.indexOf(opening, bodyStart);
    const newline = text.indexOf('\n', bodyStart);
    const lineEnd = newline === -1 || newline > limit ? limit : newline;
    // A closed quote ends the value; an unterminated one runs to the end of the line, capped.
    if (close !== -1 && close < limit && close < lineEnd) {
      return {end: close + opening.length, quote: opening};
    }
    return {end: lineEnd, quote: opening};
  }
  // An unquoted value of a sensitive key can be several words ("address: 12 Oak Lane Springfield"), so it runs to
  // the end of the line, a delimiter, or the next `key=` or `key:` token, and at most MAX_VALUE_CHARS.
  const limit = Math.min(text.length, from + MAX_VALUE_CHARS);
  let end = from;
  while (end < limit && !VALUE_STOP.test(text.charAt(end))) {
    if (NEXT_KEY.test(text.slice(end, end + MAX_NEXT_KEY_PROBE))) break;
    end += 1;
  }
  return {end, quote: ''};
}

// Checkout paths carry the checkout token: /checkouts/cn/<token>.
const CHECKOUT_PATH = /(\/checkouts\/(?:cn\/)?)[^/?#\s"']+/gi;
// scheme://user:password@host
const URL_USERINFO = /(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi;
// A cart id plus its key is the access to a cart; the id alone is not logged either.
const CART_GID = /(gid:\/\/shopify\/Cart\/)[^\s?"'&]+/gi;
const CUSTOMER_GID = /(gid:\/\/shopify\/Customer\/)[^\s?"'&]+/gi;
const AUTH_SCHEME = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g;
// Vendor-prefixed secrets: Shopify (shpat_, shpss_...), Stripe-style, GitHub, AWS access key ids.
const VENDOR_TOKEN =
  /\b(?:shp[a-z]{2,3}_[A-Za-z0-9]{16,}|(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})/g;
const EMAIL =
  /[\p{L}\p{N}._+%-]{1,64}(?:@|%40)[\p{L}\p{N}-]{1,63}(?:\.[\p{L}\p{N}-]{1,63}){1,8}/gu;
// US phone numbers: separated, in parentheses, with a plus, or bare. A bare number must have a valid NANP shape (area
// code and exchange start with 2 to 9, optional leading 1), which leaves current epoch timestamps (they start with 1)
// alone. Any other 10-digit id that happens to look like a phone number is redacted: an accepted false positive.
const PHONE_PAREN =
  /(^|[^\w.])((?:\+?1[\s.-]?)?\(\d{3}\)[\s.-]?\d{3}[\s.-]?\d{4})(?!\d)/g;
const PHONE_SEPARATED =
  /(^|[^\w.])((?:\+?1[\s.-]?)?\d{3}[\s.-]\d{3}[\s.-]\d{4})(?!\d)/g;
const PHONE_E164 = /(^|[^\w.])(\+\d{10,15})(?!\d)/g;
const PHONE_BARE = /(^|[^\w.])(1?[2-9]\d{2}[2-9]\d{6})(?!\d)/g;
// A card number written in groups; only Luhn-valid ones are redacted, so order ids are not hit.
const CARD_GROUPED =
  /(^|[^\d])(\d{4}(?:[ -]\d{4}){2,3}(?:[ -]\d{1,4})?)(?!\d)/g;
const ZIP_WORD =
  /\b(zip(?:\s?code)?|postal(?:\s?code)?|postcode)(\s*[:#]?\s*)\d{5}(?:-\d{4})?\b/gi;
const STREET_ADDRESS =
  /\b\d{1,6}\s+(?:[A-Za-z0-9.'-]+\s+){1,4}(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|court|ct|way|place|pl|parkway|pkwy|highway|hwy|terrace|ter|circle|cir|square|sq|trail|trl)\b\.?/gi;
// A long run of letters and digits is a token or a hash, not a word (hyphenated handles are not matched).
const LONG_TOKEN = /(^|[^A-Za-z0-9+])([A-Za-z0-9+]{32,}={0,2})/g;

function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let n = digits.charCodeAt(i) - 48;
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

function redactCards(text: string): string {
  return text.replace(CARD_GROUPED, (match, prefix: string, number: string) => {
    const digits = number.replace(/\D/g, '');
    return digits.length >= 13 && digits.length <= 19 && luhnValid(digits)
      ? `${prefix}[card]`
      : match;
  });
}

function redactLongTokens(text: string): string {
  return text.replace(LONG_TOKEN, (match, prefix: string, token: string) =>
    /\d/.test(token) && /[A-Za-z]/.test(token) ? `${prefix}[token]` : match,
  );
}

/**
 * Replaces the value of every sensitive `key=value` pair. A key that is not sensitive does not swallow its
 * value, so `https://x.test/cb?access_token=abc` still reaches `access_token` after `https:`.
 */
function redactKeyValues(text: string): string {
  const pattern = new RegExp(KEY_SEPARATOR.source, 'g');
  let out = '';
  let copied = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const [whole, key] = match;
    if (key === undefined || !isSensitiveKey(key)) continue;
    const valueStart = match.index + whole.length;
    const {end, quote} = valueEnd(text, valueStart);
    const closed =
      quote !== '' &&
      end >= valueStart + 2 * quote.length &&
      text.slice(end - quote.length, end) === quote;
    out += `${text.slice(copied, valueStart)}${quote}${REDACTED}${closed ? quote : ''}`;
    copied = end;
    pattern.lastIndex = Math.max(end, valueStart);
  }
  return out + text.slice(copied);
}

/**
 * Removes personal data and secrets from free text. Input beyond a few thousand characters is cut first, so a
 * hostile string cannot make the scan slow; the result is cut again to a log-line size.
 */
export function redactString(input: string): string {
  const cut =
    input.length > MAX_SCANNED_CHARS
      ? input.slice(0, MAX_SCANNED_CHARS)
      : input;
  let text = cut
    .replace(CHECKOUT_PATH, `$1${REDACTED}`)
    .replace(URL_USERINFO, `$1${REDACTED}@`)
    .replace(CART_GID, `$1${REDACTED}`)
    .replace(CUSTOMER_GID, `$1${REDACTED}`)
    .replace(AUTH_SCHEME, `$1 ${REDACTED}`)
    .replace(JWT, '[token]')
    .replace(VENDOR_TOKEN, '[token]');
  text = redactKeyValues(text)
    .replace(EMAIL, '[email]')
    .replace(PHONE_PAREN, '$1[phone]')
    .replace(PHONE_SEPARATED, '$1[phone]')
    .replace(PHONE_E164, '$1[phone]')
    .replace(PHONE_BARE, '$1[phone]')
    .replace(ZIP_WORD, `$1$2${REDACTED}`)
    .replace(STREET_ADDRESS, '[address]');
  text = redactLongTokens(redactCards(text));
  return text.length > MAX_OUTPUT_CHARS
    ? `${text.slice(0, MAX_OUTPUT_CHARS)}…`
    : text;
}

// --- Any value ---------------------------------------------------------------------------------------------

function isPlainContainer(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function redactDeep(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  switch (typeof value) {
    case 'string':
      return redactString(value);
    case 'number':
      return Number.isFinite(value) ? value : String(value);
    case 'boolean':
    case 'undefined':
      return value;
    case 'bigint':
      return value.toString();
    case 'symbol':
    case 'function':
      return `[${typeof value}]`;
    default:
      break;
  }
  if (typeof value !== 'object') return '[unsupported]';
  if (value === null) return null;
  const object: object = value;
  if (object instanceof Error) {
    // The class name only: messages and causes of failed requests can hold queries, variables and cart ids.
    return `Error(${redactString(object.name).slice(0, 60)})`;
  }
  if (object instanceof Date) {
    return Number.isNaN(object.getTime())
      ? 'invalid-date'
      : object.toISOString();
  }
  if (object instanceof URL) return redactString(object.href);
  if (depth >= MAX_DEPTH) return '[truncated]';
  if (seen.has(object)) return '[circular]';
  seen.add(object);
  try {
    if (Array.isArray(object)) {
      return object
        .slice(0, MAX_ITEMS)
        .map((item: unknown) => redactDeep(item, depth + 1, seen));
    }
    if (!isPlainContainer(object)) return '[object]';
    return redactEntries(object, depth, seen);
  } finally {
    seen.delete(object);
  }
}

/** The label of a `{key: 'delivery_zip', value: '90210'}` pair, or null when the object is not one. */
function pairLabel(object: object, keys: readonly string[]): string | null {
  if (keys.length > 4 || !keys.includes('key') || !keys.includes('value')) {
    return null;
  }
  const label: unknown = Reflect.get(object, 'key');
  return typeof label === 'string' && label.length <= MAX_KEY_CHARS
    ? label
    : null;
}

function redactEntries(
  object: object,
  depth: number,
  seen: WeakSet<object>,
): Record<string, unknown> {
  const entries: Array<[string, unknown]> = [];
  const keys = Object.keys(object).slice(0, MAX_KEYS);
  const label = pairLabel(object, keys);
  for (const key of keys) {
    let raw: unknown;
    try {
      raw = Reflect.get(object, key);
    } catch {
      raw = '[unreadable]';
    }
    const safeKey = redactString(key).slice(0, MAX_KEY_CHARS);
    // Shopify attributes and line properties are `{key, value}` pairs: the word `key` is a label, the sensitivity
    // is in the label's text (`delivery_zip`), and it is the `value` that must go. The pair's other fields are
    // ordinary fields judged by their own names (`{key, value, zip}` loses the zip too).
    const sensitive =
      label === null || key !== 'key'
        ? mustRedactValue(label !== null && key === 'value' ? label : key, raw)
        : false;
    entries.push([
      safeKey,
      sensitive ? REDACTED : redactDeep(raw, depth + 1, seen),
    ]);
  }
  // fromEntries defines own properties, so a hostile `__proto__` key stays plain data.
  return Object.fromEntries(entries);
}

/** Redacts any value into JSON-safe data. Never throws. */
export function redactValue(value: unknown): unknown {
  try {
    return redactDeep(value, 0, new WeakSet());
  } catch {
    return '[unredactable]';
  }
}
