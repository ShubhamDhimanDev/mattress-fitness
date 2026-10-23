// The third-party origins each provider needs, by Content Security Policy directive (P7-01, T-10).
//
// Google's list is quoted from "Use Google tag with a Content Security Policy"
// (developers.google.com/tag-platform/security/guides/csp, "Analytics without Ads features", read 2026-10-23).
// Google's own list also names https://*.google.com for connect-src. That is NOT used: google.com serves
// user-controlled content (script.google.com web apps, docs, sites, forms), so it would be a ready-made data sink for
// any future script injection (security review 2026-10-24, L-1). Instead connect-src names the two Google analytics
// hosts GA4 is expected to call with Google signals and ad personalisation off. Which of them GA4 really calls is
// UNVERIFIED: run staging in report-only with a real id, load every template, and add only a host that is actually
// seen blocked.
//
// WILDCARDS, for the owner's written approval. SECURITY_HEADERS.md says "never a wildcard host"; two wildcards are
// used on purpose, each limited to one Google-operated, analytics-only registrable domain:
//   https://*.google-analytics.com   (regional collectors such as region1.google-analytics.com)
//   https://*.analytics.google.com
// Until the owner accepts this exception in writing, the exception is proposed, not approved.
//
// Meta's list is UNVERIFIED: Meta's developer documentation says nothing about Content Security Policy
// (checked 2026-10-23). The hosts are the ones the pixel library is documented to load from and report to in
// community and vendor guides. A refused request shows in the browser console in report-only mode; review there.

export type ProviderCsp = {
  readonly script: readonly string[];
  readonly img: readonly string[];
  readonly connect: readonly string[];
};

export const GA4_CSP: ProviderCsp = {
  script: ['https://www.googletagmanager.com'],
  img: ['https://www.googletagmanager.com', 'https://*.google-analytics.com'],
  connect: [
    'https://www.googletagmanager.com',
    'https://*.google-analytics.com',
    'https://www.google.com',
    'https://analytics.google.com',
    'https://*.analytics.google.com',
  ],
};

export const META_CSP: ProviderCsp = {
  script: ['https://connect.facebook.net'],
  img: ['https://www.facebook.com'],
  connect: ['https://www.facebook.com', 'https://connect.facebook.net'],
};

/** The only origins a provider script may be loaded from, whatever a caller passes. */
export const PROVIDER_SCRIPT_ORIGINS: ReadonlySet<string> = new Set([
  ...GA4_CSP.script,
  ...META_CSP.script,
]);
