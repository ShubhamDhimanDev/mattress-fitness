// SERVER ONLY. What runs in the background after the webhook was answered (P5A-08, REQ-EXT-003, ADR-0009 decisions 3
// and 7): decide whether this deployment syncs at all, read the order from the Admin API, cross-check and report it.
//
// EXTEND_ORDER_SYNC is read BEFORE the order is fetched: in `extend-app` or `off` mode no Admin API call is made and
// nothing goes to Extend, so a second reporter (Extend's own Shopify app) is never doubled and an idle webhook costs
// nothing. The cross-check of ADR-0009 decision 7 (paid price versus the quoted plan price, and the covered product
// being on the same order) is `syncOrder`: a mismatch is flagged in the log by line id and reason, and that line is
// never sent to Extend.
//
// The detective order check (P5B-05, ADR-0006 decision 3) runs beside the sync and independently of it: whatever
// EXTEND_ORDER_SYNC says, and even when Extend is not configured at all, a paid order is judged against the offer rules
// and the delivery zone and the findings are logged by order id and code. It has its own, leaner order read and cannot
// change the sync's result unless the sync was skipped.

import type {CircuitBreaker} from '~/lib/extend/circuit-breaker';
import type {ExtendConfigResult} from '~/lib/extend/config';
import {
  readOrderForDetective,
  readOrderForSync,
  type AdminConfigResult,
} from '~/lib/extend/admin-client';
import {detectWithConfig, unreadableOrderResult} from '~/lib/detective/detect';
import type {DetectiveConfig, DetectiveResult} from '~/lib/detective/types';
import type {ExtendLogger} from '~/lib/extend/log';
import {createOffersQuoteLookup} from '~/lib/extend/offers';
import {syncOrder, type RetryPolicy} from '~/lib/extend/sync';
import type {FetchLike, NowFn, SleepFn} from '~/lib/extend/types';
import type {ProcessOutcome} from '~/lib/extend/webhook-handler';
import type {WebhookAction, WebhookIntent} from '~/lib/extend/webhook';

export type ProcessDeps = {
  /** Parsed with `requireFlag: false`, so order sync keeps running after the UI flag hides the offers. */
  config: ExtendConfigResult;
  admin: AdminConfigResult;
  fetch: FetchLike;
  sleep: SleepFn;
  now: NowFn;
  log: ExtendLogger;
  breaker?: CircuitBreaker;
  random?: () => number;
  retry?: Partial<RetryPolicy>;
  /**
   * Offer rules and delivery zone for the detective check (P5B-05), built from the same OFFER_CONFIG_JSON the cart gate
   * reads. Left out, the check does not run (the existing tests and any caller that has no offer configuration).
   */
  detective?: DetectiveConfig;
};

/**
 * The whole background budget stays inside what `waitUntil` allows after the response (about 30 seconds on Workers
 * runtimes; the sync's own limit is `maxTotalMs`). Anything cut short is picked up by the reconcile script.
 */
const BACKGROUND_RETRY: Partial<RetryPolicy> = {
  maxAttempts: 3,
  maxTotalMs: 15_000,
};

/**
 * The detective read gets a smaller budget than the sync (two tries, five seconds each) because it runs beside the sync
 * inside the same background window. Whatever it misses is picked up by scripts/detective/report.mjs.
 */
const DETECTIVE_READ = {maxAttempts: 2, timeoutMs: 5000} as const;

/**
 * Violations arise when the order is placed; later topics (refund, fulfilment, cancel) change nothing the check looks at,
 * so they would only repeat the same log lines and spend Admin API calls.
 */
const DETECTIVE_INTENTS: ReadonlySet<WebhookIntent> = new Set<WebhookIntent>([
  'report',
  'update',
]);

type SyncOutcome = ProcessOutcome | {status: 'skipped'};

async function processSync(
  action: WebhookAction,
  deps: ProcessDeps,
): Promise<SyncOutcome> {
  const {log} = deps;
  if (deps.config.status !== 'enabled') {
    log({
      level: 'info',
      event: 'sync.skipped',
      orderId: action.orderId,
      reason: `disabled:${deps.config.reason}${
        deps.config.missing.length > 0
          ? `:${deps.config.missing.join(',')}`
          : ''
      }`,
    });
    return {status: 'skipped'};
  }
  const {orderSync} = deps.config.config;
  if (orderSync !== 'self') {
    log({
      level: 'info',
      event: 'sync.skipped',
      orderId: action.orderId,
      reason: orderSync === 'off' ? 'order_sync_off' : 'order_sync_extend_app',
    });
    return {status: 'skipped'};
  }

  const read = await readOrderForSync(
    {admin: deps.admin, fetch: deps.fetch, sleep: deps.sleep},
    action.orderId,
  );
  if (read.status === 'error') {
    log({
      level: 'error',
      event: 'webhook.order_read_failed',
      orderId: action.orderId,
      reason: read.reason,
    });
    return {status: 'failed'};
  }

  const result = await syncOrder(read.order, {
    config: deps.config,
    fetch: deps.fetch,
    sleep: deps.sleep,
    now: deps.now,
    log,
    ...(deps.breaker === undefined ? {} : {breaker: deps.breaker}),
    ...(deps.random === undefined ? {} : {random: deps.random}),
    retry: {...BACKGROUND_RETRY, ...deps.retry},
    // The category of the covered product is what the shop's own metafield says it is, so it is eligible by definition
    // here; the eligible list only gates which products get OFFERED (REQ-EXT-005), not which sold plans are reported.
    lookupQuote: (query) =>
      createOffersQuoteLookup({
        config: deps.config,
        fetch: deps.fetch,
        log,
        eligibleCategories: [query.category],
        ...(deps.breaker === undefined ? {} : {breaker: deps.breaker}),
      })(query),
  });
  return result.status === 'failed' ? {status: 'failed'} : {status: 'done'};
}

/** Order id, status and codes only: a result has no field that could hold a name, address or ZIP. */
function logDetectiveResult(result: DetectiveResult, log: ExtendLogger): void {
  log({
    level: result.status === 'clean' ? 'info' : 'warn',
    event: 'detective.checked',
    orderId: result.orderId,
    reason: result.status,
    count: result.violations.length,
  });
  for (const violation of result.violations) {
    log({
      level: 'warn',
      event: 'detective.violation',
      orderId: result.orderId,
      reason: violation.code,
      lineIds: violation.lineIds,
    });
  }
  for (const reason of result.unjudged) {
    log({
      level: 'warn',
      event: 'detective.unjudged',
      orderId: result.orderId,
      reason,
    });
  }
}

/** Never throws: the check is a side control and must not be able to break the sync that runs beside it. */
async function runDetective(
  action: WebhookAction,
  deps: ProcessDeps,
  config: DetectiveConfig,
): Promise<ProcessOutcome> {
  const {log} = deps;
  try {
    if (config.status !== 'ready') {
      // Without rules a gift, a protector and a haul-away line all look like ordinary lines, so nothing can be judged.
      // Say so for every order instead of looking quiet: silence would read as "no violations".
      log({
        level: 'warn',
        event: 'detective.unjudged',
        orderId: action.orderId,
        reason: `rules_unavailable:${config.reason}`,
      });
      return {status: 'done'};
    }
    if (deps.admin.status !== 'ready') {
      log({
        level: 'warn',
        event: 'detective.skipped',
        orderId: action.orderId,
        reason: `admin_not_configured:${deps.admin.missing.join(',')}`,
      });
      return {status: 'done'};
    }
    const read = await readOrderForDetective(
      {
        admin: deps.admin,
        fetch: deps.fetch,
        sleep: deps.sleep,
        ...DETECTIVE_READ,
      },
      action.orderId,
    );
    if (read.status === 'error') {
      if (read.reason === 'malformed' || read.reason === 'truncated') {
        // Retrying cannot change the answer: record the order as not judged, with the reason it could not be read.
        logDetectiveResult(unreadableOrderResult(action.orderId), log);
        return {status: 'done'};
      }
      log({
        level: 'error',
        event: 'detective.read_failed',
        orderId: action.orderId,
        reason: read.reason,
      });
      return {status: 'failed'};
    }
    logDetectiveResult(detectWithConfig(read.order, config), log);
    return {status: 'done'};
  } catch {
    log({
      level: 'error',
      event: 'detective.read_failed',
      orderId: action.orderId,
      reason: 'internal_error',
    });
    return {status: 'failed'};
  }
}

export async function processOrderAction(
  action: WebhookAction,
  deps: ProcessDeps,
): Promise<ProcessOutcome> {
  const detection =
    deps.detective !== undefined && DETECTIVE_INTENTS.has(action.intent)
      ? runDetective(action, deps, deps.detective)
      : null;

  let sync: SyncOutcome;
  try {
    sync = await processSync(action, deps);
  } catch (error) {
    // Let the detective finish its own logging before the crash is reported by the caller.
    await detection;
    throw error;
  }
  const detected = await detection;

  // The sync's result is what the handler records. The check decides the outcome only when there was no sync to report.
  if (sync.status === 'failed') return {status: 'failed'};
  if (sync.status === 'done') return {status: 'done'};
  return detected === null ? {status: 'done'} : detected;
}
