// Email address checks for the signup form (REQ-ANL-003, T-13, T-05). Pure; shared by the browser's pre-check and the
// server's real check. The server never trusts the browser's result.
//
// What is accepted is deliberately a practical subset of RFC 5321/5322: printable ASCII, one "@", a dotted domain with
// a letters-only (or punycode) last label. Quoted local parts, comments, IP-address domains and raw Unicode are refused:
// real shoppers do not use them, and each one is a way to slip a second address or a header break past a naive check.
// Whether the mailbox exists is for Klaviyo's confirmation email (double opt-in) to prove, not for this code.

const MAX_ADDRESS = 254;
const MAX_LOCAL = 64;
const MAX_LABEL = 63;

// RFC 5322 "atext", without the quote and bracket characters that never occur in an ordinary address.
const LOCAL_PART =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const DOMAIN_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;
const TOP_LEVEL = /^(?:[A-Za-z]{2,}|xn--[A-Za-z0-9-]{2,})$/;

export type EmailCheck =
  | {readonly status: 'ok'; readonly email: string}
  | {readonly status: 'invalid'};

const INVALID: EmailCheck = {status: 'invalid'};

/** The lower-cased address to send, or `invalid`. Surrounding spaces are removed; nothing else is repaired. */
export function validateSignupEmail(raw: unknown): EmailCheck {
  if (typeof raw !== 'string') return INVALID;
  const value = raw.trim();
  if (value.length < 6 || value.length > MAX_ADDRESS) return INVALID;
  // Printable ASCII only: this also rules out spaces, tabs, CR/LF and every control or format character.
  if (!/^[\x21-\x7e]+$/.test(value)) return INVALID;

  const at = value.indexOf('@');
  if (at < 1 || at !== value.lastIndexOf('@')) return INVALID;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (local.length > MAX_LOCAL || !LOCAL_PART.test(local)) return INVALID;

  const labels = domain.split('.');
  if (labels.length < 2) return INVALID;
  if (!labels.every((l) => l.length <= MAX_LABEL && DOMAIN_LABEL.test(l))) {
    return INVALID;
  }
  const last = labels[labels.length - 1] ?? '';
  if (!TOP_LEVEL.test(last)) return INVALID;
  return {status: 'ok', email: value.toLowerCase()};
}

// UNVERIFIED against each provider's current rules: Yahoo's documented "-keyword" extension is the only one collapsed.
const YAHOO_DOMAINS: ReadonlySet<string> = new Set([
  'yahoo.com',
  'ymail.com',
  'rocketmail.com',
]);

/**
 * The key an address is counted under, so that `victim+1@`, `victim+2@` (and, at Gmail, `v.ictim@`) are one mailbox
 * to the limiter. The address that is SENT to Klaviyo is never altered by this. Input must already be validated.
 */
export function limiterEmailKey(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 0) return email;
  let local = email.slice(0, at);
  let domain = email.slice(at + 1);
  const plus = local.indexOf('+');
  if (plus > 0) local = local.slice(0, plus);
  // Yahoo "disposable address" style: base-keyword@yahoo.com reaches the base account. Catch-all domains (a1@, a2@ to
  // one inbox) cannot be detected from the address and are NOT collapsed; the daily and overall caps bound them.
  const dash = local.indexOf('-');
  if (dash > 0 && YAHOO_DOMAINS.has(domain)) local = local.slice(0, dash);
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.replaceAll('.', '');
  return `${local}@${domain}`;
}
