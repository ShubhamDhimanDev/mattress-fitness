// SERVER ONLY. Reads the SMTP settings for the "plan your visit" email from the request-context env (CR-33, DEC-145).
// Pure: no I/O. Every value is validated here so nothing odd (a line break, an angle bracket) can reach an SMTP command
// or a mail header. A missing or malformed setting means "not configured": the form says it cannot send and nothing is
// faked. Names of variables are reported, never their values (the password is a secret).
//
//   SMTP_HOST        mail server name or IPv4 address (required)
//   SMTP_PORT        optional; defaults to 587 (starttls), 465 (tls) or 25 (none)
//   SMTP_SECURITY    starttls (default) | tls (implicit TLS, usually port 465) | none (no encryption, no login; for a local
//                    mail catcher only)
//   SMTP_USER, SMTP_PASSWORD   optional pair; both or neither. Refused with SMTP_SECURITY=none
//   SMTP_FROM        sender address (required)
//   LEAD_EMAIL_TO    the one address that receives each request (required)
//   LEAD_EMAIL_CC    optional, comma-separated, up to MAX_CC addresses

import {readEnvString} from '~/lib/extend/env';

export const MAX_CC = 10;

export type SmtpSecurity = 'starttls' | 'tls' | 'none';

export type SmtpConfig = {
  readonly host: string;
  readonly port: number;
  readonly security: SmtpSecurity;
  readonly auth: {readonly user: string; readonly password: string} | null;
  readonly from: string;
  readonly to: string;
  readonly cc: readonly string[];
};

export type SmtpConfigResult =
  | {readonly status: 'ready'; readonly config: SmtpConfig}
  | {readonly status: 'not_configured'; readonly missing: readonly string[]};

const DEFAULT_PORTS: Record<SmtpSecurity, number> = {
  starttls: 587,
  tls: 465,
  none: 25,
};

const HOST = /^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;
// No whitespace, quotes, angle brackets, commas or control characters anywhere: this is the SMTP and header injection guard.
const ADDRESS =
  /^[^\s<>()[\]\\,;:"@]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,}$/;
const LOGIN_VALUE = /^[\x20-\x7E]{1,256}$/;

export function isMailAddress(value: string): boolean {
  return value.length <= 254 && ADDRESS.test(value);
}

function parseSecurity(raw: string | null): SmtpSecurity | null {
  if (raw === null) return 'starttls';
  const value = raw.toLowerCase();
  return value === 'starttls' || value === 'tls' || value === 'none'
    ? value
    : null;
}

function parsePort(raw: string | null, fallback: number): number | null {
  if (raw === null) return fallback;
  if (!/^\d{1,5}$/.test(raw)) return null;
  const port = Number(raw);
  return port >= 1 && port <= 65535 ? port : null;
}

export function readSmtpConfig(env: object): SmtpConfigResult {
  const missing: string[] = [];
  const host = readEnvString(env, 'SMTP_HOST');
  if (host === null || !HOST.test(host)) missing.push('SMTP_HOST');
  const from = readEnvString(env, 'SMTP_FROM');
  if (from === null || !isMailAddress(from)) missing.push('SMTP_FROM');
  const to = readEnvString(env, 'LEAD_EMAIL_TO');
  if (to === null || !isMailAddress(to)) missing.push('LEAD_EMAIL_TO');

  const security = parseSecurity(readEnvString(env, 'SMTP_SECURITY'));
  if (security === null) missing.push('SMTP_SECURITY (starttls, tls or none)');
  const port = parsePort(
    readEnvString(env, 'SMTP_PORT'),
    DEFAULT_PORTS[security ?? 'starttls'],
  );
  if (port === null) missing.push('SMTP_PORT');

  const user = readEnvString(env, 'SMTP_USER');
  const password = readEnvString(env, 'SMTP_PASSWORD');
  const hasLogin = user !== null || password !== null;
  if (
    hasLogin &&
    (user === null ||
      password === null ||
      !LOGIN_VALUE.test(user) ||
      !LOGIN_VALUE.test(password) ||
      // A login over an unencrypted connection would send the password in the clear.
      security === 'none')
  ) {
    missing.push('SMTP_USER and SMTP_PASSWORD (both, with encryption on)');
  }

  const ccRaw = readEnvString(env, 'LEAD_EMAIL_CC');
  const cc =
    ccRaw === null
      ? []
      : ccRaw
          .split(',')
          .map((entry) => entry.trim())
          .filter((entry) => entry !== '');
  if (cc.length > MAX_CC || !cc.every(isMailAddress)) {
    missing.push(`LEAD_EMAIL_CC (up to ${MAX_CC} valid addresses)`);
  }

  if (
    missing.length > 0 ||
    host === null ||
    from === null ||
    to === null ||
    security === null ||
    port === null
  ) {
    return {status: 'not_configured', missing};
  }
  return {
    status: 'ready',
    config: {
      host,
      port,
      security,
      auth:
        hasLogin && user !== null && password !== null
          ? {user, password}
          : null,
      from,
      to,
      // The same address in To and Cc would be delivered twice.
      cc: [...new Set(cc.filter((address) => address !== to))],
    },
  };
}
