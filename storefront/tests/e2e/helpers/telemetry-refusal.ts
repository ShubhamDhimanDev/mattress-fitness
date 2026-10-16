// Pure helper for the e2e console filters (security review K-L7, DEC-045). Kept apart from a11y.ts because that file
// imports Playwright and axe, which a plain Vitest run should not load: tests/unit/e2e-helpers/telemetry-refusal.test.ts
// imports this module directly.

/**
 * Shopify's consent script posts performance telemetry to this one host, which our Content Security Policy refuses
 * (D-QA-1). It is Shopify's script, not our code, and blocking it is intended (DEC-045): nothing we ship depends on
 * it. Only a CSP refusal whose BLOCKED URL has exactly this host name is ignored; a violation naming any other host,
 * or only mentioning this one somewhere else in the text, still fails.
 */
export const BLOCKED_TELEMETRY_HOST = 'otlp-http-production.shopifysvc.com';

// Chromium words a CSP refusal two ways: "violates the following Content Security Policy directive" (resource
// loads) and "violates the document's Content Security Policy" (fetch). A report-only policy prefixes the line
// with "[Report Only]" and says the same.
const CSP_REFUSAL =
  /violates the (?:following|document's) Content Security Policy/;
// The blocked URI is the quoted URL after "Refused to connect to", "Refused to load the script", or (newer Chromium
// wording for a connect-src block) "Connecting to '<url>' violates ...", and so on; some
// Chromium versions word a fetch refusal as "Fetch API cannot load <url>. Refused to connect because ...".
const QUOTED_BLOCKED_URL =
  /(?:Refus(?:ed|ing) to|Connecting to|Loading the (?:script|stylesheet|image|font))(?: [^']{0,60})?'([^']{1,2048})'/;
const FETCH_BLOCKED_URL = /Fetch API cannot load (\S{1,2048})\.\s+Refused to/;

/** The URL a browser console line says was blocked, or null when the line does not name one. */
export function blockedUrlOf(text: string): string | null {
  const quoted = QUOTED_BLOCKED_URL.exec(text);
  if (quoted?.[1] !== undefined) return quoted[1];
  const fetched = FETCH_BLOCKED_URL.exec(text);
  return fetched?.[1] ?? null;
}

/** True only for a CSP refusal of a URL on exactly the telemetry host (not a substring, a subdomain or a userinfo trick). */
export function isBlockedTelemetryRefusal(text: string): boolean {
  if (!CSP_REFUSAL.test(text)) return false;
  const blocked = blockedUrlOf(text);
  if (blocked === null) return false;
  try {
    const url = new URL(blocked);
    return url.protocol === 'https:' && url.hostname === BLOCKED_TELEMETRY_HOST;
  } catch {
    return false;
  }
}
