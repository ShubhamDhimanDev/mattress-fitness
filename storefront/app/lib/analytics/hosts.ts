// The third-party origins each provider needs, by Content Security Policy directive (P7-01, T-10).
//
// Google's list is quoted from "Use Google tag with a Content Security Policy"
// (developers.google.com/tag-platform/security/guides/csp, "Analytics without Ads features", read 2026-10-23).
// It contains wildcard subdomains because Google serves GA4 from regional hosts (for example
// region1.google-analytics.com); this deviates from docs/security/SECURITY_HEADERS.md "never a wildcard host" and is
// recorded as an open decision in docs/integrations/ANALYTICS.md.
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
    'https://*.google.com',
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
