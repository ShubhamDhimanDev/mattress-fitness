// Settings of the plain-Node server entry (ADR-0010, P9-12). These are host settings, not storefront settings: the
// storefront itself still reads its configuration only from the request-context env (ADR-0004). Names only here;
// values live in the server's environment file (docs/deployment/VPS_RUNBOOK.md). Pure functions, no I/O.

import { isIP } from 'node:net';

export const DEFAULTS = Object.freeze({
  port: 3000,
  // Loopback: the reverse proxy is the only public listener, so a client cannot reach this port directly and forge
  // the forwarded headers that TRUST_PROXY makes us believe.
  bindHost: '127.0.0.1',
  maxBodyBytes: 1024 * 1024,
  shutdownTimeoutMs: 10_000,
  cacheMaxEntries: 500,
  cacheMaxBytes: 64 * 1024 * 1024,
});

/**
 * Variables without which the storefront cannot work at all (DEPLOYMENT.md, "Required for a store to work").
 * PUBLIC_STOREFRONT_ID is deliberately not here: Hydrogen's getShopAnalytics defaults it to '0' (it only labels the
 * analytics sub-channel, app/root.tsx), so a missing value degrades analytics attribution, not the store.
 */
export const REQUIRED_NAMES = Object.freeze([
  'SESSION_SECRET',
  'PUBLIC_STORE_DOMAIN',
  'PUBLIC_STOREFRONT_API_TOKEN',
  'PUBLIC_CHECKOUT_DOMAIN',
]);

/** Same floor the application enforces for SESSION_SECRET in production (DEC-032); checked here so a restart fails loudly. */
export const MIN_SECRET_LENGTH = 32;

function readInt(raw, name, fallback, min, max, problems) {
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d{1,10}$/.test(raw)) {
    problems.push(`${name} must be a whole number`);
    return fallback;
  }
  const value = Number(raw);
  if (value < min || value > max) {
    problems.push(`${name} must be between ${min} and ${max}`);
    return fallback;
  }
  return value;
}

/**
 * Loopback only; anything it does not recognise counts as not loopback, so the check errs towards refusing.
 *
 * @param {string} address a literal IPv4 or IPv6 address (already checked with isIP)
 */
export function isLoopback(address) {
  const value = address.toLowerCase();
  if (isIP(value) === 4) return value.startsWith('127.');
  const bare = value.split('%')[0] ?? value;
  if (bare === '::1' || /^(0{1,4}:){7}0{0,3}1$/.test(bare)) return true;
  return bare.startsWith('::ffff:127.');
}

/**
 * Reads the host settings. Never returns a value of a secret, only problems that name variables.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {{
 *   settings: {port: number, bindHost: string, trustProxy: boolean, maxBodyBytes: number,
 *     shutdownTimeoutMs: number, cacheMaxEntries: number, cacheMaxBytes: number},
 *   problems: string[]
 * }}
 */
export function readSettings(env) {
  const problems = [];
  const port = readInt(env.PORT, 'PORT', DEFAULTS.port, 1, 65535, problems);
  const maxBodyBytes = readInt(
    env.MAX_BODY_BYTES,
    'MAX_BODY_BYTES',
    DEFAULTS.maxBodyBytes,
    1024,
    50 * 1024 * 1024,
    problems,
  );
  const shutdownTimeoutMs = readInt(
    env.SHUTDOWN_TIMEOUT_MS,
    'SHUTDOWN_TIMEOUT_MS',
    DEFAULTS.shutdownTimeoutMs,
    0,
    120_000,
    problems,
  );
  const cacheMaxEntries = readInt(
    env.CACHE_MAX_ENTRIES,
    'CACHE_MAX_ENTRIES',
    DEFAULTS.cacheMaxEntries,
    1,
    100_000,
    problems,
  );

  const cacheMaxBytes = readInt(
    env.CACHE_MAX_BYTES,
    'CACHE_MAX_BYTES',
    DEFAULTS.cacheMaxBytes,
    1024 * 1024,
    1024 * 1024 * 1024,
    problems,
  );

  let bindHost = DEFAULTS.bindHost;
  if (env.BIND_HOST !== undefined && env.BIND_HOST !== '') {
    // A literal address only, checked by Node's own parser: a typo must not silently bind everywhere.
    if (isIP(env.BIND_HOST) !== 0) {
      bindHost = env.BIND_HOST;
    } else {
      problems.push('BIND_HOST must be an IPv4 or IPv6 address');
    }
  }

  if (
    env.TRUST_PROXY !== undefined &&
    env.TRUST_PROXY !== '' &&
    env.TRUST_PROXY !== 'true' &&
    env.TRUST_PROXY !== 'false'
  ) {
    problems.push('TRUST_PROXY must be true or false');
  }

  // Believing X-Forwarded-Proto is only safe when nothing but the proxy can reach the port; otherwise any client can
  // forge it (HSTS on a plain-http answer, Secure cookies decided by a header). Refuse rather than warn: the
  // unit and the proxy template both bind loopback, so a different value is a mistake or a design change to record in ADR-0010.
  if (env.TRUST_PROXY === 'true' && isIP(bindHost) !== 0 && !isLoopback(bindHost)) {
    problems.push('TRUST_PROXY=true requires BIND_HOST to be a loopback address (127.0.0.0/8 or ::1)');
  }

  return {
    settings: {
      port,
      bindHost,
      trustProxy: env.TRUST_PROXY === 'true',
      maxBodyBytes,
      shutdownTimeoutMs,
      cacheMaxEntries,
      cacheMaxBytes,
    },
    problems,
  };
}

/**
 * Names (never values) of required storefront variables that are missing, plus a note for a SESSION_SECRET that the
 * application would refuse in production.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {string[]}
 */
export function readStorefrontProblems(env) {
  const problems = [];
  for (const name of REQUIRED_NAMES) {
    const value = env[name];
    if (value === undefined || value.trim() === '') problems.push(`${name} is not set`);
  }
  const secret = env.SESSION_SECRET;
  if (secret !== undefined && secret.trim() !== '' && secret.length < MIN_SECRET_LENGTH) {
    problems.push(`SESSION_SECRET is shorter than ${MIN_SECRET_LENGTH} characters`);
  }
  return problems;
}
