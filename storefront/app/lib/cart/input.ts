// Validation of cart input that arrives in a URL (threats T-01, T-07, T-08). The browser may name a
// variant, a quantity and a discount code, nothing else: prices, discounts and eligibility are decided by
// Shopify and by our server, never read from a request.

export const MIN_LINE_QUANTITY = 1;
export const MAX_LINE_QUANTITY = 99;
const MAX_PERMALINK_LINES = 20;
const VARIANT_NUMBER = /^[1-9]\d{0,19}$/;
const DISCOUNT_CODE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_PATH_LENGTH = 2000;

export type CartPermalinkLine = {
  readonly merchandiseId: string;
  readonly quantity: number;
};

export type CartPermalink =
  | {readonly status: 'ok'; readonly lines: readonly CartPermalinkLine[]}
  | {readonly status: 'invalid'};

/**
 * `/cart/<variant number>:<quantity>,<variant number>:<quantity>`. Every entry must be a plain variant
 * number and an integer quantity from 1 to 99; one bad entry rejects the whole link, so a tampered link
 * never half-works. A repeated variant has its quantities added, capped at the maximum.
 */
export function parseCartPermalink(raw: string | undefined): CartPermalink {
  if (!raw) return {status: 'invalid'};
  const parts = raw.split(',');
  if (parts.length > MAX_PERMALINK_LINES) return {status: 'invalid'};

  const quantities = new Map<string, number>();
  for (const part of parts) {
    const [variant, quantity, ...extra] = part.split(':');
    if (extra.length > 0 || !variant || quantity === undefined) {
      return {status: 'invalid'};
    }
    if (!VARIANT_NUMBER.test(variant) || !/^\d{1,3}$/.test(quantity)) {
      return {status: 'invalid'};
    }
    const amount = Number(quantity);
    if (amount < MIN_LINE_QUANTITY || amount > MAX_LINE_QUANTITY) {
      return {status: 'invalid'};
    }
    quantities.set(
      variant,
      Math.min(MAX_LINE_QUANTITY, (quantities.get(variant) ?? 0) + amount),
    );
  }

  return {
    status: 'ok',
    lines: [...quantities].map(([variant, quantity]) => ({
      merchandiseId: `gid://shopify/ProductVariant/${variant}`,
      quantity,
    })),
  };
}

/** A discount code from a URL or a form; anything with unexpected characters is ignored. */
export function parseDiscountCode(
  raw: string | null | undefined,
): string | null {
  const code = raw?.trim();
  return code && DISCOUNT_CODE.test(code) ? code : null;
}

/**
 * A redirect target taken from a URL: a path on this site or the fallback. It must start with exactly one
 * `/`, contain no backslash, whitespace or control character (browsers strip tabs and newlines, so
 * `/<tab>/evil.com` would become `//evil.com`), and still resolve to our own origin.
 */
export function safeRedirectPath(
  raw: string | null | undefined,
  fallback = '/',
): string {
  if (!raw || raw.length > MAX_PATH_LENGTH) return fallback;
  if (!raw.startsWith('/') || raw.startsWith('//')) return fallback;
  for (const char of raw) {
    const code = char.codePointAt(0) ?? 0;
    if (char === '\\' || code <= 0x20 || (code >= 0x7f && code <= 0x9f)) {
      return fallback;
    }
  }
  try {
    const base = 'https://site.invalid';
    return new URL(raw, base).origin === base ? raw : fallback;
  } catch {
    return fallback;
  }
}
