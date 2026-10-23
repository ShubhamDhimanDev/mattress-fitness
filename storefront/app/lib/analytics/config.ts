// Analytics configuration read from the public environment (P7-01, REQ-ANL-001, REQ-ANL-002, NFR-011).
//
// Everything here is public by design (a GA4 measurement id and a Meta pixel id are visible in any page that uses
// them), so the values travel to the browser in the root loader. Pure: the caller passes the environment in.
//
// Fail closed, in three ways:
//  - no id, no provider: an unset or malformed id means nothing loads, no script is added to the page and no host is
//    added to the Content Security Policy;
//  - an unknown PUBLIC_CONSENT_MODE means 'opt-in', the stricter behaviour (nothing is sent before the shopper
//    agrees). 'opt-out' is chosen only by the exact value. Which of the two the law requires for this client is a
//    legal decision this code does not make (Q-012, T-16); the switch exists so the answer is a configuration change.

export const CONSENT_MODES = ['opt-in', 'opt-out'] as const;
export type ConsentMode = (typeof CONSENT_MODES)[number];

export const DEFAULT_CONSENT_MODE: ConsentMode = 'opt-in';

export type AnalyticsEnv = {
  readonly PUBLIC_CONSENT_MODE?: string | undefined;
  readonly PUBLIC_GA4_MEASUREMENT_ID?: string | undefined;
  readonly PUBLIC_META_PIXEL_ID?: string | undefined;
};

export type PublicAnalyticsConfig = {
  readonly consentMode: ConsentMode;
  readonly ga4MeasurementId: string | null;
  readonly metaPixelId: string | null;
};

// "G-" followed by letters and digits. Anything else (a Universal Analytics "UA-" id, a GTM container "GTM-", a
// value with a quote or a space) is refused, so the id can never break out of the script URL or the policy.
const GA4_ID = /^G-[A-Z0-9]{4,16}$/;
// Pixel ids are all digits (15 or 16 today); the wider bounds avoid refusing a valid id and still refuse junk.
const META_PIXEL_ID = /^\d{6,20}$/;

function clean(value: string | undefined): string {
  return (value ?? '').trim();
}

export function parseConsentMode(value: string | undefined): ConsentMode {
  return clean(value).toLowerCase() === 'opt-out' ? 'opt-out' : 'opt-in';
}

export function parseGa4MeasurementId(
  value: string | undefined,
): string | null {
  const id = clean(value).toUpperCase();
  return GA4_ID.test(id) ? id : null;
}

export function parseMetaPixelId(value: string | undefined): string | null {
  const id = clean(value);
  return META_PIXEL_ID.test(id) ? id : null;
}

export function parseAnalyticsConfig(env: AnalyticsEnv): PublicAnalyticsConfig {
  return {
    consentMode: parseConsentMode(env.PUBLIC_CONSENT_MODE),
    ga4MeasurementId: parseGa4MeasurementId(env.PUBLIC_GA4_MEASUREMENT_ID),
    metaPixelId: parseMetaPixelId(env.PUBLIC_META_PIXEL_ID),
  };
}

/**
 * Names (never values) of provider variables that are set but unusable, for one warning at startup. A value is
 * not logged: it is public, but a typo is more likely a pasted secret than anything else.
 */
export function rejectedAnalyticsEnvNames(env: AnalyticsEnv): string[] {
  const rejected: string[] = [];
  if (
    clean(env.PUBLIC_GA4_MEASUREMENT_ID) !== '' &&
    parseGa4MeasurementId(env.PUBLIC_GA4_MEASUREMENT_ID) === null
  ) {
    rejected.push('PUBLIC_GA4_MEASUREMENT_ID');
  }
  if (
    clean(env.PUBLIC_META_PIXEL_ID) !== '' &&
    parseMetaPixelId(env.PUBLIC_META_PIXEL_ID) === null
  ) {
    rejected.push('PUBLIC_META_PIXEL_ID');
  }
  return rejected;
}

export type ConsentCategory = 'analytics' | 'marketing';

/** The consent categories at least one configured provider needs. Empty means nothing to ask about. */
export function configuredCategories(
  config: PublicAnalyticsConfig,
): readonly ConsentCategory[] {
  const categories: ConsentCategory[] = [];
  if (config.ga4MeasurementId) categories.push('analytics');
  if (config.metaPixelId) categories.push('marketing');
  return categories;
}

export function hasProviders(config: PublicAnalyticsConfig): boolean {
  return configuredCategories(config).length > 0;
}
