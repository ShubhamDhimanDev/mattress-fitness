// Environment, allow-list and live-flag guards for every script that can reach a Shopify store.
// T-14: a script run against the wrong store is a data-loss risk, so (1) dry run is the default,
// (2) any contact with a store needs the domain in SHOPIFY_ALLOWED_STORES, (3) writes also need --live.

export const ENV_STORE_DOMAIN = 'SHOPIFY_STORE_DOMAIN';
export const ENV_ADMIN_TOKEN = 'SHOPIFY_ADMIN_API_ACCESS_TOKEN';
export const ENV_ALLOWED_STORES = 'SHOPIFY_ALLOWED_STORES';
export const ENV_API_VERSION = 'SHOPIFY_ADMIN_API_VERSION';

const SHOP_DOMAIN = /^[a-z0-9][a-z0-9-]{0,60}[a-z0-9]\.myshopify\.com$/;

/**
 * Accepts "Shop.myshopify.com", "https://shop.myshopify.com/" and similar; returns the bare
 * lower-case domain or null. Custom domains are refused: the Admin API host is always *.myshopify.com.
 * @param {unknown} input
 * @returns {string | null}
 */
export function normalizeShopDomain(input) {
  if (typeof input !== 'string') return null;
  const cleaned = input
    .trim()
    .toLowerCase()
    .replace(/^https:\/\//, '')
    .replace(/\/+$/, '');
  return SHOP_DOMAIN.test(cleaned) ? cleaned : null;
}

/**
 * Comma, space or newline separated list. Invalid entries (wildcards, custom domains) are dropped
 * rather than trusted, so a typo can only make the list shorter, never wider.
 * @param {unknown} raw
 * @returns {string[]}
 */
export function parseAllowedStores(raw) {
  if (typeof raw !== 'string') return [];
  const seen = new Set();
  for (const part of raw.split(/[\s,;]+/)) {
    const domain = normalizeShopDomain(part);
    if (domain) seen.add(domain);
  }
  return [...seen];
}

/**
 * @typedef {'live_flag_missing' | 'store_missing' | 'store_invalid' | 'allow_list_empty' | 'store_not_allowed' | 'token_missing'} GuardReason
 * @typedef {{ ok: true, store: string } | { ok: false, reason: GuardReason, message: string }} GuardResult
 */

/**
 * Contact with a store (even read-only) needs an allow-listed domain.
 * @param {{ store: unknown, env: Record<string, string | undefined> }} args
 * @returns {GuardResult}
 */
export function checkStoreAllowed({ store, env }) {
  if (store === undefined || store === null || store === '') {
    return { ok: false, reason: 'store_missing', message: `No store given. Pass --store or set ${ENV_STORE_DOMAIN}.` };
  }
  const domain = normalizeShopDomain(store);
  if (!domain) {
    return { ok: false, reason: 'store_invalid', message: 'The store must be a <name>.myshopify.com domain.' };
  }
  const allowed = parseAllowedStores(env[ENV_ALLOWED_STORES]);
  if (allowed.length === 0) {
    return { ok: false, reason: 'allow_list_empty', message: `${ENV_ALLOWED_STORES} is empty or unset. List the stores this tool may touch.` };
  }
  if (!allowed.includes(domain)) {
    return { ok: false, reason: 'store_not_allowed', message: `${domain} is not in ${ENV_ALLOWED_STORES}. Refusing to continue.` };
  }
  return { ok: true, store: domain };
}

/**
 * Writes need the explicit --live flag as well as an allow-listed store.
 * @param {{ live: unknown, store: unknown, env: Record<string, string | undefined> }} args
 * @returns {GuardResult}
 */
export function checkLiveAllowed({ live, store, env }) {
  if (live !== true) {
    return { ok: false, reason: 'live_flag_missing', message: 'Writes need the explicit --live flag. Running as a dry run is the default.' };
  }
  return checkStoreAllowed({ store, env });
}

export class LiveGuardError extends Error {
  /** @param {GuardReason} reason @param {string} message */
  constructor(reason, message) {
    super(message);
    this.name = 'LiveGuardError';
    this.reason = reason;
  }
}

/**
 * Throwing variant for scripts whose entry point should stop outright.
 * @param {{ live: unknown, store: unknown, env: Record<string, string | undefined> }} args
 * @returns {string} the normalised, allow-listed store domain
 */
export function assertLiveAllowed(args) {
  const result = checkLiveAllowed(args);
  if (!result.ok) throw new LiveGuardError(result.reason, result.message);
  return result.store;
}

/**
 * @param {{ store: unknown, env: Record<string, string | undefined> }} args
 * @returns {string}
 */
export function assertStoreAllowed(args) {
  const result = checkStoreAllowed(args);
  if (!result.ok) throw new LiveGuardError(result.reason, result.message);
  return result.store;
}

/**
 * The token is read from the environment only, and only returned to the caller that builds the
 * client; the error message never contains the value.
 * @param {Record<string, string | undefined>} env
 * @returns {{ ok: true, token: string } | { ok: false, reason: 'token_missing', message: string }}
 */
export function readAdminToken(env) {
  const token = env[ENV_ADMIN_TOKEN];
  if (typeof token !== 'string' || token.trim() === '') {
    return { ok: false, reason: 'token_missing', message: `${ENV_ADMIN_TOKEN} is not set. Set it in the environment, never on the command line.` };
  }
  return { ok: true, token: token.trim() };
}
