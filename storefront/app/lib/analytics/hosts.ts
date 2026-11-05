// The third-party origins each provider needs, by Content Security Policy directive (P7-01, T-10).
//
// Google's list is quoted from "Use Google tag with a Content Security Policy"
// (developers.google.com/tag-platform/security/guides/csp, "Analytics without Ads features", read 2026-10-23).
// Google's own list also names https://*.google.com for connect-src. That is NOT used: google.com serves
// user-controlled content (script.google.com web apps, docs, sites, forms), so it would be a ready-made data sink for
// any future script injection (security review 2026-10-24, L-1). Instead connect-src has five entries: the tag manager
// host, `*.google-analytics.com`, `www.google.com`, `analytics.google.com` and `*.analytics.google.com` (the hosts GA4
// is expected to call with Google signals and ad personalisation off). Which of them GA4 really calls is
// UNVERIFIED: run staging in report-only with a real id, load every template, and add only a host that is actually
// seen blocked.
//
// WILDCARDS, for the owner's written approval. SECURITY_HEADERS.md says "never a wildcard host"; two wildcards are
// used on purpose, each limited to one Google-operated, analytics-only registrable domain:
//   https://*.google-analytics.com   (regional collectors such as region1.google-analytics.com)
//   https://*.analytics.google.com
// Until the owner accepts this exception in writing, the exception is proposed, not approved, and NO environment may
// set PUBLIC_GA4_MEASUREMENT_ID: the hosts below are added to both policies the moment the id is set.
//
// Meta's list is UNVERIFIED: Meta's developer documentation says nothing about Content Security Policy
// (checked 2026-10-23). The hosts are the ones the pixel library is documented to load from and report to in
// community and vendor guides. A refused request shows in the browser console in report-only mode; review there.

export type ProviderCsp = {
  readonly script: readonly string[];
  readonly img: readonly string[];
  readonly connect: readonly string[];
  /** Frames the provider's tags open (Tag Manager's own helper frame). Omitted means none. */
  readonly frame?: readonly string[];
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

// OpenAI (ChatGPT ads) pixel. Hosts read from the pixel's own script (oaiq.min.js, fetched 2026-11-02): it loads from
// bzrcdn.openai.com and posts events (fetch and sendBeacon) to bzr.openai.com/v1/sdk/events. OpenAI publishes no
// Content Security Policy guidance (UNVERIFIED); confirm in report-only with a real pixel id.
export const OPENAI_CSP: ProviderCsp = {
  script: ['https://bzrcdn.openai.com'],
  img: [],
  connect: ['https://bzr.openai.com'],
};

// Tag Manager needs the same Google hosts as GA4, plus the Google Ads hosts: the live container (GTM-PQXJ6C4K, read
// 2026-11-05) holds Google Ads tags for AW-18473942295 (conversion linker and marking, enhanced-conversion data,
// auto events). Without these hosts the enforced policy refused them and Tag Assistant reported "Content Security
// Policy of your site blocks some resources". The list is Google's "Google Ads" and "Google Ads User Data" rows of
// the same CSP guide (read 2026-11-05), limited to the US: Google's per-country `www.google.<TLD>` hosts are NOT
// listed (the store is US-only, NFR-008); add one only if report-only shows it blocked.
//
// `www.google.com` as a script source is Google's own instruction for the Ads tags but is a wider script origin than
// the rest of this list (it also serves Google-run JSONP-style endpoints). It is added only when a Tag Manager
// container id is set, and the nonce policy still blocks every inline script. For the owner's approval with the
// wildcard exception above. Tags INSIDE a container that call other hosts are refused by the policy on purpose: add
// a host only after the owner approves the tag that needs it.
const GOOGLE_ADS_CSP: ProviderCsp = {
  script: ['https://www.googleadservices.com', 'https://www.google.com'],
  img: [
    'https://www.googleadservices.com',
    'https://googleads.g.doubleclick.net',
    'https://pagead2.googlesyndication.com',
    'https://www.google.com',
  ],
  connect: [
    'https://www.googleadservices.com',
    'https://googleads.g.doubleclick.net',
    'https://pagead2.googlesyndication.com',
    'https://www.google.com',
    'https://ad.doubleclick.net',
  ],
  frame: ['https://www.googletagmanager.com'],
};

const unique = (values: readonly string[]): string[] => [...new Set(values)];

export const GTM_CSP: ProviderCsp = {
  script: unique([...GA4_CSP.script, ...GOOGLE_ADS_CSP.script]),
  img: unique([...GA4_CSP.img, ...GOOGLE_ADS_CSP.img]),
  connect: unique([...GA4_CSP.connect, ...GOOGLE_ADS_CSP.connect]),
  frame: GOOGLE_ADS_CSP.frame ?? [],
};

/** The only origins a provider script may be loaded from, whatever a caller passes. */
export const PROVIDER_SCRIPT_ORIGINS: ReadonlySet<string> = new Set([
  ...GA4_CSP.script,
  ...META_CSP.script,
  ...OPENAI_CSP.script,
]);
