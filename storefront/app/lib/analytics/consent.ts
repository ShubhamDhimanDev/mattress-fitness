// The shopper's consent decision: what is stored, how it is read back and what it means (P7-01, NFR-011).
//
// Two categories only, matching the two providers we ship: `analytics` (Google Analytics) and `marketing` (Meta
// pixel). "Strictly necessary" storage (cart, session, the delivery ZIP the shopper asked us to remember, this
// decision itself) needs no consent and is not listed here.
//
// Pure functions. The caller supplies the clock and the Global Privacy Control signal so every branch is testable.

import type {ConsentMode} from '~/lib/analytics/config';

export type ConsentChoice = {
  readonly analytics: boolean;
  readonly marketing: boolean;
};

export type StoredConsent = ConsentChoice & {
  /** Bump when the categories or their wording change materially: older decisions are then asked again. */
  readonly version: number;
  /** Epoch seconds when the shopper decided. */
  readonly decidedAt: number;
};

export const CONSENT_STORAGE_KEY = 'mf_consent';
export const CONSENT_POLICY_VERSION = 1;
/** 180 days: a decision is asked again after this. A product-owner or legal value, not a technical one. */
export const CONSENT_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

const CLOCK_SKEW_SECONDS = 24 * 60 * 60;
const MAX_STORED_LENGTH = 200;

export const DENY_ALL: ConsentChoice = {analytics: false, marketing: false};
export const ALLOW_ALL: ConsentChoice = {analytics: true, marketing: true};

export function serializeConsent(
  choice: ConsentChoice,
  nowSeconds: number,
): string {
  const stored: StoredConsent = {
    version: CONSENT_POLICY_VERSION,
    analytics: choice.analytics,
    marketing: choice.marketing,
    decidedAt: Math.floor(nowSeconds),
  };
  return JSON.stringify(stored);
}

/**
 * Reads a stored decision back. Anything unexpected (wrong shape, wrong types, an older policy version, expired,
 * dated in the future, oversized) is "no decision", never a partial one: the shopper is asked again.
 */
export function parseStoredConsent(
  raw: string | null | undefined,
  nowSeconds: number,
): StoredConsent | null {
  if (typeof raw !== 'string' || raw === '' || raw.length > MAX_STORED_LENGTH) {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const version: unknown = Reflect.get(value, 'version');
  const analytics: unknown = Reflect.get(value, 'analytics');
  const marketing: unknown = Reflect.get(value, 'marketing');
  const decidedAt: unknown = Reflect.get(value, 'decidedAt');
  if (
    version !== CONSENT_POLICY_VERSION ||
    typeof analytics !== 'boolean' ||
    typeof marketing !== 'boolean' ||
    typeof decidedAt !== 'number' ||
    !Number.isFinite(decidedAt)
  ) {
    return null;
  }
  const age = nowSeconds - decidedAt;
  if (age > CONSENT_MAX_AGE_SECONDS || age < -CLOCK_SKEW_SECONDS) return null;
  return {version, analytics, marketing, decidedAt};
}

/**
 * What applies while the shopper has not decided.
 *  - opt-in: nothing.
 *  - opt-out: everything, except marketing when the browser sends Global Privacy Control, which is an opt-out
 *    request for sale or sharing under some US state laws. Honouring it is the conservative reading; whether it
 *    is required here is a legal question for the client (T-16).
 */
export function defaultChoice(mode: ConsentMode, gpc: boolean): ConsentChoice {
  if (mode === 'opt-in') return DENY_ALL;
  return {analytics: true, marketing: !gpc};
}

export function effectiveChoice(
  mode: ConsentMode,
  stored: StoredConsent | null,
  gpc: boolean,
): ConsentChoice {
  if (stored) return {analytics: stored.analytics, marketing: stored.marketing};
  return defaultChoice(mode, gpc);
}

/** `name=value` lookup in a Cookie header or `document.cookie` string. */
export function readCookieValue(
  cookieHeader: string | null | undefined,
  name: string,
): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * The first-party cookie that holds the decision. Readable by the browser (it has to read it back), so no
 * HttpOnly; `SameSite=Lax`; `Secure` on https. It holds two booleans and a date: nothing that identifies anyone.
 */
export function buildConsentCookie(
  value: string,
  options: {readonly secure: boolean},
): string {
  return [
    `${CONSENT_STORAGE_KEY}=${encodeURIComponent(value)}`,
    `Max-Age=${CONSENT_MAX_AGE_SECONDS}`,
    'Path=/',
    'SameSite=Lax',
    ...(options.secure ? ['Secure'] : []),
  ].join('; ');
}
