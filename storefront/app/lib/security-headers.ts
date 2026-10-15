// Response security headers that do not depend on the host (P7-07, finding P-L6, threats T-07 and T-10).
//
// Pure functions, no framework imports, so they are unit-tested and used from `entry.server.tsx` for every
// document and data response. Hydrogen's enforced, nonce-based Content-Security-Policy stays as it is; this
// module adds the headers around it and a stricter Content-Security-Policy-Report-Only variant that names every
// resource type explicitly. The directive-by-directive reasoning and the rule for adding a third-party origin
// are in docs/security/SECURITY_HEADERS.md.

const LOOPBACK_NAMES: ReadonlySet<string> = new Set(['localhost']);
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/**
 * Sensitive browser features this storefront never uses (a grep of app/ finds no camera, microphone,
 * geolocation or Payment Request call; the store locator searches by ZIP, and payment happens on Shopify's own
 * checkout origin). Only features every current engine recognises are listed: an unknown feature name is a
 * console error in some browsers and the end-to-end specs fail on console errors.
 */
export const PERMISSIONS_POLICY =
  'camera=(), microphone=(), geolocation=(), payment=()';

/**
 * One year is the usual ceiling; six months is used until the final host is known (Q-003). Deliberately
 * without `includeSubDomains` and without `preload`: both are effectively permanent and need the final host
 * decision and an inventory of every subdomain first (docs/security/SECURITY_HEADERS.md, "HSTS").
 */
export const HSTS_VALUE = 'max-age=15552000';

/** Headers every response gets, whatever the host. */
export const BASE_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': PERMISSIONS_POLICY,
  // Legacy twin of the CSP `frame-ancestors 'none'` that Hydrogen already sends. No Shopify checkout, admin
  // preview or customer-account flow frames this storefront; they navigate to their own origins.
  'X-Frame-Options': 'DENY',
  // `same-origin-allow-popups` rather than `same-origin`: it still cuts the window reference from any other
  // origin that opens us, but a later provider popup (a payment or chat window) keeps its opener. Tightening
  // to `same-origin` is a one-line change once the Phase 7 providers are known (T-10).
  'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
};

function hostnameOf(requestUrl: string): string | null {
  try {
    return new URL(requestUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * True when the request reached us over TLS. Behind a proxy that ends TLS the URL says `http:` (finding P-L5),
 * so the first `X-Forwarded-Proto` value counts too. A caller can fake that header, but the only effect is an
 * HSTS header on its own plain-http response, which browsers ignore.
 */
export function isHttpsRequest(
  requestUrl: string,
  forwardedProto: string | null,
): boolean {
  try {
    if (new URL(requestUrl).protocol === 'https:') return true;
  } catch {
    return false;
  }
  const first = (forwardedProto ?? '').split(',')[0]?.trim().toLowerCase();
  return first === 'https';
}

/** A real, resolvable host name: not localhost, not an IP literal, at least one dot. */
export function isPublicHostname(hostname: string | null): boolean {
  if (!hostname) return false;
  const host = hostname.toLowerCase();
  if (LOOPBACK_NAMES.has(host) || host.endsWith('.localhost')) return false;
  if (host.startsWith('[') || IPV4.test(host)) return false;
  return host.includes('.');
}

export type SecurityHeaderInput = {
  readonly requestUrl: string;
  /** The `X-Forwarded-Proto` request header, if any. */
  readonly forwardedProto?: string | null;
};

/** HSTS only on https requests to a public host name; a localhost preview must never pin itself to https. */
export function shouldSendHsts(input: SecurityHeaderInput): boolean {
  return (
    isHttpsRequest(input.requestUrl, input.forwardedProto ?? null) &&
    isPublicHostname(hostnameOf(input.requestUrl))
  );
}

/** Sets the host-independent headers (and HSTS when it applies) on a Headers object. Other headers stay. */
export function applySecurityHeaders(
  headers: Headers,
  input: SecurityHeaderInput,
): void {
  for (const [name, value] of Object.entries(BASE_SECURITY_HEADERS)) {
    headers.set(name, value);
  }
  if (shouldSendHsts(input))
    headers.set('Strict-Transport-Security', HSTS_VALUE);
}

// --- Content-Security-Policy-Report-Only -----------------------------------------------------------------

// A host name from the environment goes into a header, so only a plain DNS name is accepted: a value holding
// a space, a semicolon or a comma could otherwise add a directive of its own.
const HOSTNAME =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const NONCE = /^[A-Za-z0-9+/_=-]{8,128}$/;

export type ReportOnlyCspOptions = {
  readonly nonce: string;
  /** `PUBLIC_STORE_DOMAIN`, for example `example.myshopify.com`. */
  readonly storeDomain?: string | undefined;
  /** `PUBLIC_CHECKOUT_DOMAIN`. */
  readonly checkoutDomain?: string | undefined;
  /** The dev server serves scripts and HMR from localhost; production never lists those origins. */
  readonly development: boolean;
};

function httpsHost(value: string | undefined): string | null {
  return value && HOSTNAME.test(value)
    ? `https://${value.toLowerCase()}`
    : null;
}

function compact(values: readonly (string | null)[]): string[] {
  return values.filter((value): value is string => value !== null);
}

const SHOPIFY_CDN = 'https://cdn.shopify.com';
const SHOPIFY_TELEMETRY = 'https://monorail-edge.shopifysvc.com';
const SHOPIFY_ACCOUNT = 'https://shopify.com';

/**
 * The tightened policy, delivered report-only: it never blocks, it only shows in the browser console what an
 * enforced version would block. Against Hydrogen's enforced policy it
 *   - starts from `default-src 'self'` and lists every resource type explicitly (no fallback to a list that also
 *     allows Shopify's account host for scripts),
 *   - bans plugins (`object-src`), frames (`frame-src`) and inline event handlers (`script-src-attr`),
 *   - allows inline `style=""` attributes only, not inline `<style>` elements (React sets style attributes;
 *     the stylesheet is a linked file),
 *   - restricts where forms may submit (`form-action`), which Hydrogen's policy does not.
 * `frame-ancestors` is left out on purpose: browsers ignore it in a report-only policy, and the enforced one
 * already sends `'none'`. Returns null when the nonce is not a plain token, so no malformed header goes out.
 */
export function buildReportOnlyCsp(
  options: ReportOnlyCspOptions,
): string | null {
  if (!NONCE.test(options.nonce)) return null;
  const store = httpsHost(options.storeDomain);
  const checkout = httpsHost(options.checkoutDomain);
  const nonce = `'nonce-${options.nonce}'`;
  const dev = options.development ? ['http://localhost:*'] : [];
  const devSockets = options.development
    ? ['ws://localhost:*', 'ws://127.0.0.1:*']
    : [];

  const directives: ReadonlyArray<readonly [string, readonly string[]]> = [
    ['default-src', ["'self'"]],
    ['base-uri', ["'self'"]],
    ['object-src', ["'none'"]],
    ['script-src', ["'self'", nonce, SHOPIFY_CDN, ...dev]],
    ['script-src-attr', ["'none'"]],
    [
      'style-src',
      [
        "'self'",
        SHOPIFY_CDN,
        ...dev,
        ...(options.development ? ["'unsafe-inline'"] : []),
      ],
    ],
    ['style-src-attr', ["'unsafe-inline'"]],
    ['img-src', ["'self'", 'data:', SHOPIFY_CDN, ...dev]],
    ['font-src', ["'self'", SHOPIFY_CDN, ...dev]],
    ['media-src', ["'self'", SHOPIFY_CDN, ...dev]],
    [
      'connect-src',
      [
        "'self'",
        SHOPIFY_CDN,
        SHOPIFY_TELEMETRY,
        ...compact([checkout, store]),
        ...dev,
        ...devSockets,
      ],
    ],
    ['frame-src', ["'none'"]],
    ['worker-src', ["'self'"]],
    ['manifest-src', ["'self'"]],
    ['form-action', ["'self'", SHOPIFY_ACCOUNT, ...compact([checkout, store])]],
  ];

  return directives
    .map(([name, sources]) => `${name} ${[...new Set(sources)].join(' ')}`)
    .join('; ');
}
