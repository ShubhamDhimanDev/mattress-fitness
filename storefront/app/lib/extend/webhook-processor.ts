// SERVER ONLY. What runs in the background after the webhook was answered (P5A-08, REQ-EXT-003, ADR-0009 decisions 3
// and 7): decide whether this deployment syncs at all, read the order from the Admin API, cross-check and report it.
//
// EXTEND_ORDER_SYNC is read BEFORE the order is fetched: in `extend-app` or `off` mode no Admin API call is made and
// nothing goes to Extend, so a second reporter (Extend's own Shopify app) is never doubled and an idle webhook costs
// nothing. The cross-check of ADR-0009 decision 7 (paid price versus the quoted plan price, and the covered product
// being on the same order) is `syncOrder`: a mismatch is flagged in the log by line id and reason, and that line is
// never sent to Extend.

import type {CircuitBreaker} from '~/lib/extend/circuit-breaker';
import type {ExtendConfigResult} from '~/lib/extend/config';
import {
  readOrderForSync,
  type AdminConfigResult,
} from '~/lib/extend/admin-client';
import type {ExtendLogger} from '~/lib/extend/log';
import {createOffersQuoteLookup} from '~/lib/extend/offers';
import {syncOrder, type RetryPolicy} from '~/lib/extend/sync';
import type {FetchLike, NowFn, SleepFn} from '~/lib/extend/types';
import type {ProcessOutcome} from '~/lib/extend/webhook-handler';
import type {WebhookAction} from '~/lib/extend/webhook';

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
};

/**
 * The whole background budget stays inside what `waitUntil` allows after the response (about 30 seconds on Workers
 * runtimes; the sync's own limit is `maxTotalMs`). Anything cut short is picked up by the reconcile script.
 */
const BACKGROUND_RETRY: Partial<RetryPolicy> = {
  maxAttempts: 3,
  maxTotalMs: 15_000,
};

export async function processOrderAction(
  action: WebhookAction,
  deps: ProcessDeps,
): Promise<ProcessOutcome> {
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
    return {status: 'done'};
  }
  const {orderSync} = deps.config.config;
  if (orderSync !== 'self') {
    log({
      level: 'info',
      event: 'sync.skipped',
      orderId: action.orderId,
      reason: orderSync === 'off' ? 'order_sync_off' : 'order_sync_extend_app',
    });
    return {status: 'done'};
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

  // TODO(P5B-05): the haul-away detective note of security review M-4 (order shipping ZIP versus the delivery zone)
  // belongs to the Phase 5B control, which must run whether or not Extend sync is on. It is not wired here: it needs
  // the haul-away variant id and the zone from the offer configuration (OFFER_CONFIG_JSON / P4-12), and the ZIP is
  // personal data that may be logged only as a yes/no result, never as a value.

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
