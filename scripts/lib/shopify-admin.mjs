// Minimal Shopify Admin GraphQL client for tooling scripts (no dependencies, injected fetch and clock).
//
// Sources (read 2026-10-12):
//  - Endpoint and header: https://shopify.dev/docs/api/admin-graphql/2026-10 (POST
//    https://{shop}.myshopify.com/admin/api/2026-10/graphql.json, header X-Shopify-Access-Token).
//  - Rate limits: https://shopify.dev/docs/apps/build/apis/graphql-admin/rate-limits (standard plan
//    100 points per second, max single query cost 1,000, default mutation cost 10; extensions.cost has
//    requestedQueryCost, actualQueryCost and throttleStatus { maximumAvailable, currentlyAvailable,
//    restoreRate }; the bucket is credited the difference after the query; recommended backoff one second).
//  - Latest stable API version on 2026-10-12 is 2026-10: https://shopify.dev/docs/api/usage/versioning
//  UNVERIFIED(V-20): the exact THROTTLED error body is not shown on the pages read. Shopify's error
//  list names the code THROTTLED, so this client matches errors[].extensions.code === 'THROTTLED'
//  and HTTP 429 and treats both the same way.

import { normalizeShopDomain } from './env.mjs';
import { redactText, scrubSecrets, silentLogger } from './redact.mjs';

export const ADMIN_API_VERSION = '2026-10';
export const MAX_SINGLE_QUERY_COST = 1000;
export const STANDARD_BUCKET = Object.freeze({ restoreRate: 100, bucketSize: 1000 });
const DEFAULT_ESTIMATED_COST = 100;
const BACKOFF_CAP_MS = 30_000;

/** @typedef {{ now: () => number, sleep: (ms: number) => Promise<void> }} Clock */

/** @type {Clock} */
export const realClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * @typedef {'auth' | 'not_found' | 'throttled' | 'cost_exceeded' | 'server' | 'http' | 'network' | 'timeout' |
 *   'graphql' | 'invalid_response' | 'read_only' | 'user_errors'} AdminErrorKind
 * @typedef {{ field: string[] | null, message: string, code: string | null }} UserError
 * @typedef {{ kind: AdminErrorKind, message: string, status?: number, attempts?: number, errors?: UserError[] }} AdminError
 * @typedef {{ requestedQueryCost?: number, actualQueryCost?: number, throttleStatus?: { maximumAvailable: number, currentlyAvailable: number, restoreRate: number } }} QueryCost
 * @typedef {{ ok: true, data: Record<string, unknown>, cost: QueryCost | null, attempts: number }
 *   | { ok: false, error: AdminError }} AdminResult
 */

/**
 * Leaky-bucket model of Shopify's calculated-cost limit. `acquire` waits until the bucket should hold
 * the requested cost (Shopify rejects a query whose requested cost exceeds the points available);
 * `observe` replaces the estimate with the authoritative throttleStatus from each response.
 * @param {{ clock: Clock, restoreRate?: number, bucketSize?: number }} options
 */
export function createCostThrottle({ clock, restoreRate = STANDARD_BUCKET.restoreRate, bucketSize = STANDARD_BUCKET.bucketSize }) {
  let available = bucketSize;
  let max = bucketSize;
  let rate = restoreRate;
  let updatedAt = clock.now();

  function refill() {
    const now = clock.now();
    available = Math.min(max, available + ((now - updatedAt) / 1000) * rate);
    updatedAt = now;
  }

  return {
    /** @param {number} requestedCost @returns {Promise<number>} milliseconds waited */
    async acquire(requestedCost) {
      refill();
      const need = Math.min(requestedCost, max);
      let waited = 0;
      if (available < need) {
        waited = Math.ceil(((need - available) / rate) * 1000);
        await clock.sleep(waited);
        refill();
      }
      available = Math.max(0, available - need);
      return waited;
    },
    /** @param {{ maximumAvailable: number, currentlyAvailable: number, restoreRate: number }} status */
    observe(status) {
      max = status.maximumAvailable;
      rate = status.restoreRate > 0 ? status.restoreRate : rate;
      available = Math.min(status.currentlyAvailable, max);
      updatedAt = clock.now();
    },
    /** After a THROTTLED answer the bucket is empty as far as we know. */
    drain() {
      refill();
      available = 0;
    },
    snapshot() {
      refill();
      return { available, max, rate };
    },
  };
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} cost
 * @returns {QueryCost | null}
 */
function readCost(cost) {
  if (!isRecord(cost)) return null;
  /** @type {QueryCost} */
  const out = {};
  if (typeof cost.requestedQueryCost === 'number') out.requestedQueryCost = cost.requestedQueryCost;
  if (typeof cost.actualQueryCost === 'number') out.actualQueryCost = cost.actualQueryCost;
  const status = cost.throttleStatus;
  if (
    isRecord(status) &&
    typeof status.maximumAvailable === 'number' &&
    typeof status.currentlyAvailable === 'number' &&
    typeof status.restoreRate === 'number'
  ) {
    out.throttleStatus = {
      maximumAvailable: status.maximumAvailable,
      currentlyAvailable: status.currentlyAvailable,
      restoreRate: status.restoreRate,
    };
  }
  return out;
}

/**
 * @param {unknown} errors
 * @returns {{ code: string | null, message: string }[]}
 */
function readGraphqlErrors(errors) {
  if (!Array.isArray(errors)) return [];
  return errors.map((entry) => {
    const message = isRecord(entry) && typeof entry.message === 'string' ? entry.message : 'Unknown GraphQL error';
    const extensions = isRecord(entry) ? entry.extensions : null;
    const code = isRecord(extensions) && typeof extensions.code === 'string' ? extensions.code : null;
    return { code, message };
  });
}

/**
 * @param {Response} response
 * @returns {number | null} milliseconds from a Retry-After header in seconds
 */
function retryAfterMs(response) {
  const raw = response.headers.get('retry-after');
  if (!raw) return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds * 1000, BACKOFF_CAP_MS) : null;
}

/**
 * @typedef {object} AdminClientOptions
 * @property {string} store          <name>.myshopify.com (validated here, so the host is never attacker-controlled)
 * @property {string} token          Admin API access token; only ever placed in the request header
 * @property {string} [apiVersion]
 * @property {typeof fetch} [fetch]
 * @property {Clock} [clock]
 * @property {import('./redact.mjs').Logger} [logger]
 * @property {boolean} [allowMutations]  false by default: dry runs cannot write even by mistake
 * @property {number} [maxAttempts]      total tries per request, default 5 (bounded retries)
 * @property {number} [timeoutMs]
 * @property {() => number} [random]     jitter source; tests pass () => 0
 * @property {number} [restoreRate]
 * @property {number} [bucketSize]
 */

/**
 * @param {AdminClientOptions} options
 */
export function createAdminClient(options) {
  const store = normalizeShopDomain(options.store);
  if (!store) throw new TypeError('createAdminClient: store must be a <name>.myshopify.com domain');
  if (typeof options.token !== 'string' || options.token === '') throw new TypeError('createAdminClient: token is required');

  const token = options.token;
  const apiVersion = options.apiVersion ?? ADMIN_API_VERSION;
  const doFetch = options.fetch ?? globalThis.fetch;
  const clock = options.clock ?? realClock;
  const logger = options.logger ?? silentLogger;
  const allowMutations = options.allowMutations === true;
  const maxAttempts = Math.max(1, options.maxAttempts ?? 5);
  const timeoutMs = options.timeoutMs ?? 30_000;
  const random = options.random ?? Math.random;
  const secrets = [token];
  const throttle = createCostThrottle({ clock, restoreRate: options.restoreRate, bucketSize: options.bucketSize });
  const url = `https://${store}/admin/api/${apiVersion}/graphql.json`;
  /** @type {Map<string, number>} last requestedQueryCost seen per operation, a better estimate than a constant */
  const knownCost = new Map();

  /** @param {number} attempt @param {number} baseMs @param {number | null} floorMs */
  function backoffMs(attempt, baseMs, floorMs) {
    const exponential = baseMs * 2 ** (attempt - 1);
    const jitter = Math.floor(random() * 250);
    return Math.min(BACKOFF_CAP_MS, Math.max(floorMs ?? 0, exponential) + jitter);
  }

  /** @param {unknown} error */
  function describeThrown(error) {
    return redactText(error instanceof Error ? error.message : String(error), secrets);
  }

  /**
   * @param {string} query
   * @param {Record<string, unknown>} [variables]
   * @param {{ operationName?: string, estimatedCost?: number }} [meta]
   * @returns {Promise<AdminResult>}
   */
  async function request(query, variables = {}, meta = {}) {
    const operation = meta.operationName ?? 'anonymous';
    if (!allowMutations && /(^|[\s}])mutation\b/.test(query)) {
      return { ok: false, error: { kind: 'read_only', message: `Refusing mutation ${operation}: this client was created without allowMutations.` } };
    }
    // Shopify rejects a query whose *requested* cost exceeds the points available, so under-estimating
    // costs a THROTTLED retry while over-estimating costs a short wait. Take the larger of the caller's
    // guess and the cost Shopify last reported for this operation.
    const estimate = Math.max(meta.estimatedCost ?? 0, knownCost.get(operation) ?? 0) || DEFAULT_ESTIMATED_COST;

    // A mutation that timed out or hit a network error or a 5xx may ALREADY have been applied; repeating it could create a
    // duplicate. Only a 429 (rejected before running) is safe to retry for mutations; ambiguous failures are returned to the
    // caller, which must re-read the resource before deciding (the importer plans from a fresh read each run).
    const isMutation = /(^|[\s}])mutation\b/.test(query);

    /** @type {AdminError} */
    let lastError = { kind: 'network', message: 'No attempt was made' };
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const waitedMs = await throttle.acquire(estimate);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      /** @type {Response} */
      let response;
      try {
        response = await doFetch(url, {
          method: 'POST',
          redirect: 'error', // never forward the token to another host
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-Shopify-Access-Token': token,
          },
          body: JSON.stringify({ query, variables, ...(meta.operationName ? { operationName: meta.operationName } : {}) }),
        });
      } catch (error) {
        clearTimeout(timer);
        const timedOut = controller.signal.aborted;
        lastError = {
          kind: timedOut ? 'timeout' : 'network',
          message: timedOut ? `Request timed out after ${timeoutMs} ms` : describeThrown(error),
          attempts: attempt,
        };
        logger.warn('shopify request failed', { operation, attempt, kind: lastError.kind, waitedMs });
        if (isMutation) return { ok: false, error: { ...lastError, message: `${lastError.message}. The change may or may not have been applied: re-read before retrying.` } };
        if (attempt < maxAttempts) await clock.sleep(backoffMs(attempt, 500, null));
        continue;
      }
      clearTimeout(timer);
      const status = response.status;
      if (status === 429) {
        throttle.drain();
        lastError = { kind: 'throttled', message: 'Shopify returned HTTP 429', status, attempts: attempt };
        logger.warn('shopify throttled', { operation, attempt, status });
        if (attempt < maxAttempts) await clock.sleep(backoffMs(attempt, 1000, retryAfterMs(response)));
        continue;
      }
      if (status >= 500) {
        lastError = { kind: 'server', message: `Shopify returned HTTP ${status}`, status, attempts: attempt };
        logger.warn('shopify server error', { operation, attempt, status });
        if (isMutation) return { ok: false, error: { ...lastError, message: `${lastError.message}. The change may or may not have been applied: re-read before retrying.` } };
        if (attempt < maxAttempts) await clock.sleep(backoffMs(attempt, 500, retryAfterMs(response)));
        continue;
      }
      if (status === 401 || status === 403) {
        return { ok: false, error: { kind: 'auth', message: `Shopify refused the credentials (HTTP ${status}). Check the token and its scopes.`, status, attempts: attempt } };
      }
      if (status === 404) {
        return { ok: false, error: { kind: 'not_found', message: 'Shopify returned HTTP 404. Check the store domain and API version.', status, attempts: attempt } };
      }
      if (status < 200 || status >= 300) {
        return { ok: false, error: { kind: 'http', message: `Shopify returned HTTP ${status}`, status, attempts: attempt } };
      }

      /** @type {unknown} */
      let body;
      // Bound the body read too: the abort signal also cancels a body that stalls after the headers arrived.
      const bodyTimer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        body = await response.json();
      } catch {
        clearTimeout(bodyTimer);
        return { ok: false, error: { kind: 'invalid_response', message: 'Shopify returned a body that is not JSON', status, attempts: attempt } };
      }
      clearTimeout(bodyTimer);
      if (!isRecord(body)) {
        return { ok: false, error: { kind: 'invalid_response', message: 'Shopify returned an unexpected JSON shape', status, attempts: attempt } };
      }

      const extensions = isRecord(body.extensions) ? body.extensions : {};
      const cost = readCost(extensions.cost);
      if (cost?.throttleStatus) throttle.observe(cost.throttleStatus);
      if (cost?.requestedQueryCost !== undefined) knownCost.set(operation, cost.requestedQueryCost);

      const errors = readGraphqlErrors(body.errors);
      if (errors.length > 0) {
        if (errors.some((entry) => entry.code === 'THROTTLED')) {
          if (!cost?.throttleStatus) throttle.drain();
          lastError = { kind: 'throttled', message: 'Shopify throttled the request (THROTTLED)', status, attempts: attempt };
          logger.warn('shopify throttled', { operation, attempt, code: 'THROTTLED' });
          if (attempt < maxAttempts) await clock.sleep(backoffMs(attempt, 1000, null));
          continue;
        }
        const costExceeded = errors.some((entry) => entry.code === 'MAX_COST_EXCEEDED');
        const message = redactText(errors.map((entry) => entry.message).join('; '), secrets);
        return { ok: false, error: { kind: costExceeded ? 'cost_exceeded' : 'graphql', message, status, attempts: attempt } };
      }

      // Nothing Shopify returns should contain our token; if an error message ever echoes it, it must not
      // reach a console, log or manifest (T-04, T-05).
      const data = scrubSecrets(body.data, secrets);
      if (!isRecord(data)) {
        return { ok: false, error: { kind: 'invalid_response', message: 'Shopify response has no data object', status, attempts: attempt } };
      }
      logger.debug('shopify request ok', { operation, attempt, waitedMs, requested: cost?.requestedQueryCost, actual: cost?.actualQueryCost });
      return { ok: true, data, cost, attempts: attempt };
    }
    return { ok: false, error: { ...lastError, message: `${lastError.message} (gave up after ${maxAttempts} attempts)` } };
  }

  return { request, store, apiVersion, throttleSnapshot: () => throttle.snapshot() };
}

/** @typedef {ReturnType<typeof createAdminClient>} AdminClient */

/**
 * Mutations report business failures in payload.userErrors with HTTP 200. Turn them into a typed error
 * so a caller cannot forget to look.
 * @param {Record<string, unknown>} data
 * @param {string} rootField e.g. 'productSet'
 * @returns {{ ok: true, payload: Record<string, unknown> } | { ok: false, error: AdminError }}
 */
export function readPayload(data, rootField) {
  const payload = data[rootField];
  if (!isRecord(payload)) {
    return { ok: false, error: { kind: 'invalid_response', message: `Response has no ${rootField} payload` } };
  }
  const raw = payload.userErrors;
  if (Array.isArray(raw) && raw.length > 0) {
    /** @type {UserError[]} */
    const errors = raw.map((entry) => ({
      field: isRecord(entry) && Array.isArray(entry.field) ? entry.field.map(String) : null,
      message: isRecord(entry) && typeof entry.message === 'string' ? entry.message : 'Unknown error',
      code: isRecord(entry) && typeof entry.code === 'string' ? entry.code : null,
    }));
    const summary = errors.map((entry) => `${entry.field ? `${entry.field.join('.')}: ` : ''}${entry.message}${entry.code ? ` [${entry.code}]` : ''}`).join('; ');
    return { ok: false, error: { kind: 'user_errors', message: `${rootField} rejected: ${summary}`, errors } };
  }
  return { ok: true, payload };
}

/**
 * Walks nodes/edges connection shapes without trusting them.
 * @param {unknown} connection
 * @returns {Record<string, unknown>[]}
 */
export function connectionNodes(connection) {
  if (!isRecord(connection)) return [];
  const nodes = connection.nodes;
  if (Array.isArray(nodes)) return nodes.filter(isRecord);
  const edges = connection.edges;
  if (Array.isArray(edges)) {
    return edges.map((edge) => (isRecord(edge) ? edge.node : null)).filter(isRecord);
  }
  return [];
}

export { isRecord };
