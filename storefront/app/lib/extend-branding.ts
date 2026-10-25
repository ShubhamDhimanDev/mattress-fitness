// Extend branding slots read from the public environment (REQ-EXT-004). Public values only; nothing here is a credential.
//
// Extend requires its branding and a link to the coverage terms on every offer surface, and its written approval before
// go-live (Q-005, B-15). The requirement stays Blocked until that approval is on file; these are only the slots, so no
// URL is invented. Each is empty by default:
//   PUBLIC_EXTEND_TERMS_URL  an https link to Extend's coverage terms, supplied by Extend or the client.
//   PUBLIC_EXTEND_LOGO_URL   an https image URL of Extend's approved logo, hosted by the client or Extend.
// Unset or invalid means no link, or text only. The logo's origin is the one host added to `img-src`.
//
// Pure: the caller passes the environment in.

export type ExtendBrandingEnv = {
  readonly PUBLIC_EXTEND_TERMS_URL?: string | undefined;
  readonly PUBLIC_EXTEND_LOGO_URL?: string | undefined;
};

/** What the browser is told. */
export type ExtendBranding = {
  readonly termsUrl: string | null;
  readonly logoUrl: string | null;
};

const MAX_URL_LENGTH = 2048;
// A plain DNS name only: the origin goes into a Content-Security-Policy header, so a space, semicolon or comma in a host
// must never get there (same rule as `~/lib/security-headers`).
const HOSTNAME =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

/** The parsed URL when it is https, has a public DNS host, no credentials and no non-default port; else null. */
function safeHttpsUrl(value: string | undefined): URL | null {
  const raw = (value ?? '').trim();
  if (raw === '' || raw.length > MAX_URL_LENGTH) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return null;
    if (url.username !== '' || url.password !== '' || url.port !== '') {
      return null;
    }
    return HOSTNAME.test(url.hostname) ? url : null;
  } catch {
    return null;
  }
}

export function parseExtendBranding(env: ExtendBrandingEnv): ExtendBranding {
  return {
    termsUrl: safeHttpsUrl(env.PUBLIC_EXTEND_TERMS_URL)?.href ?? null,
    logoUrl: safeHttpsUrl(env.PUBLIC_EXTEND_LOGO_URL)?.href ?? null,
  };
}

/** The logo's origin (`https://host`) for `img-src`, or null when no valid logo URL is set. */
export function extendLogoOrigin(branding: ExtendBranding): string | null {
  if (branding.logoUrl === null) return null;
  return safeHttpsUrl(branding.logoUrl)?.origin ?? null;
}
