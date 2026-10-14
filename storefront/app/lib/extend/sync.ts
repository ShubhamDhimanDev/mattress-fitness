// SERVER ONLY. Order sync orchestration (REQ-EXT-003, NFR-006, T-03, T-06).
//
// syncOrder takes an order already read from Shopify (the Admin API read belongs to the webhook route, not here),
// cross-checks its coverage lines, builds the full snapshot and PUTs it to Extend with bounded retries.
//
// Idempotency: the snapshot is a pure function of the Shopify order, and PUT /orders is idempotent by design, so
// a retry after an ambiguous failure (for example a timeout after Extend already applied the request) and a
// webhook replay are both safe. This function keeps no state and sends no partial updates.
//
// Logging: events carry order ids, line ids, plan ids and reasons only. Customer data is sent to Extend (the
// Orders API requires it) but is never logged.

import {
  isUnhealthyHttpStatus,
  type CircuitBreaker,
} from '~/lib/extend/circuit-breaker';
import type {ExtendConfigResult} from '~/lib/extend/config';
import {callExtend, type CallFailureReason} from '~/lib/extend/http';
import {normalizeShopifyId} from '~/lib/extend/ids';
import {noopLogger, type ExtendLogger} from '~/lib/extend/log';
import {
  buildOrderSnapshot,
  listQuoteQueries,
  type CoverageWarning,
  type FlaggedLine,
  type QuoteQuery,
  type ShopifyOrderLike,
} from '~/lib/extend/orders';
import type {FetchLike, NowFn, PlanQuote, SleepFn} from '~/lib/extend/types';

/**
 * Confirms that a plan id is genuinely offered for the covered item at the price actually charged, for example
 * by calling the Offers API again for that product. Return `null` when the plan is NOT offered. THROW (or reject)
 * when the answer cannot be obtained (Extend down): the sync then fails as retriable instead of flagging an order
 * that may be perfectly valid.
 */
export type QuoteLookup = (
  query: QuoteQuery,
) => Promise<PlanQuote | null> | PlanQuote | null;

export type RetryPolicy = {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** Per-request timeout. */
  timeoutMs: number;
  /** Stop retrying once this much time has passed since the sync started. */
  maxTotalMs: number;
};

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 4,
  baseDelayMs: 500,
  maxDelayMs: 8000,
  timeoutMs: 10_000,
  maxTotalMs: 30_000,
};

export type SyncDeps = {
  config: ExtendConfigResult;
  fetch: FetchLike;
  sleep: SleepFn;
  now: NowFn;
  lookupQuote: QuoteLookup;
  log?: ExtendLogger;
  /** Optional: stops the sync from hammering Extend while it is down. A denied permit is a retriable failure. */
  breaker?: CircuitBreaker;
  /** 0..1, for backoff jitter. Defaults to Math.random. */
  random?: () => number;
  retry?: Partial<RetryPolicy>;
};

export type SkipReason =
  | 'disabled'
  | 'order_sync_extend_app'
  | 'order_sync_off'
  | 'no_coverage_lines'
  | 'all_coverage_flagged';

export type SyncFailureReason =
  | 'invalid_order'
  | 'unsupported_currency'
  | 'quote_lookup_failed'
  | 'circuit_open'
  | CallFailureReason;

export type SyncResult =
  | {
      status: 'synced';
      orderId: string;
      attempts: number;
      planIds: string[];
      flagged: FlaggedLine[];
      warnings: CoverageWarning[];
    }
  | {
      status: 'skipped';
      reason: SkipReason;
      orderId: string | null;
      flagged: FlaggedLine[];
    }
  | {
      status: 'failed';
      reason: SyncFailureReason;
      /** True when running the same sync again later may succeed (so the webhook route should ask Shopify to retry). */
      retriable: boolean;
      orderId: string | null;
      attempts: number;
      httpStatus?: number;
    };

/** Exponential backoff with jitter, optionally stretched to honour Retry-After, always capped. */
export function backoffDelayMs(
  attempt: number,
  policy: RetryPolicy,
  random: () => number,
  retryAfterMs?: number,
): number {
  const exponential = Math.min(
    policy.maxDelayMs,
    policy.baseDelayMs * 2 ** Math.max(0, attempt - 1),
  );
  const jittered = Math.round(exponential * (0.5 + random() * 0.5));
  return retryAfterMs === undefined
    ? jittered
    : Math.max(jittered, Math.min(retryAfterMs, policy.maxDelayMs));
}

/** Failures worth another immediate attempt: transient transport errors, 408, 429 and 5xx. */
function isTransient(reason: CallFailureReason, httpStatus?: number): boolean {
  if (reason === 'timeout' || reason === 'network') return true;
  return (
    reason === 'http' &&
    httpStatus !== undefined &&
    (httpStatus >= 500 || httpStatus === 408 || httpStatus === 429)
  );
}

/** Worth running again later: transient failures plus bad credentials, which an operator can fix. */
function isRetriableLater(
  reason: CallFailureReason,
  httpStatus?: number,
): boolean {
  return (
    isTransient(reason, httpStatus) ||
    reason === 'malformed' ||
    (reason === 'http' && (httpStatus === 401 || httpStatus === 403))
  );
}

function isPlanQuote(value: unknown): value is PlanQuote {
  return (
    typeof value === 'object' &&
    value !== null &&
    'planId' in value &&
    typeof value.planId === 'string' &&
    'priceCents' in value &&
    typeof value.priceCents === 'number' &&
    Number.isSafeInteger(value.priceCents)
  );
}

export async function syncOrder(
  order: ShopifyOrderLike,
  deps: SyncDeps,
): Promise<SyncResult> {
  const log = deps.log ?? noopLogger;
  const random = deps.random ?? Math.random;
  const policy: RetryPolicy = {...DEFAULT_RETRY_POLICY, ...deps.retry};
  const orderId = normalizeShopifyId(order.id);
  const idField = orderId === null ? {} : {orderId};

  const skip = (
    reason: SkipReason,
    flagged: FlaggedLine[] = [],
  ): SyncResult => {
    log({level: 'info', event: 'sync.skipped', reason, ...idField});
    return {status: 'skipped', reason, orderId, flagged};
  };

  if (deps.config.status !== 'enabled') return skip('disabled');
  const {config} = deps.config;
  // EXTEND_ORDER_SYNC guards against double reporting if Extend's own Shopify app syncs orders (ADR-0009).
  if (config.orderSync === 'extend-app') return skip('order_sync_extend_app');
  if (config.orderSync === 'off') return skip('order_sync_off');

  const startedAt = deps.now();

  // 1. Resolve quotes. A lookup that cannot answer aborts the sync as retriable; it never silently passes.
  const quotesByLineId = new Map<string, PlanQuote | null>();
  for (const {lineId, query} of listQuoteQueries(order)) {
    try {
      const quote = await deps.lookupQuote(query);
      quotesByLineId.set(lineId, isPlanQuote(quote) ? quote : null);
    } catch {
      log({
        level: 'warn',
        event: 'sync.quote_lookup_failed',
        lineIds: [lineId],
        planIds: [query.planId],
        ...idField,
      });
      return {
        status: 'failed',
        reason: 'quote_lookup_failed',
        retriable: true,
        orderId,
        attempts: 0,
      };
    }
  }

  // 2. Build the full snapshot (pure) and drop anything that fails the ADR-0009 cross-check.
  const built = buildOrderSnapshot(order, {
    storeId: config.storeId,
    quotesByLineId,
  });
  if (built.status === 'error') {
    log({
      level: 'error',
      event: 'sync.gave_up',
      reason: built.reason,
      ...idField,
    });
    return {
      status: 'failed',
      reason: built.reason,
      retriable: false,
      orderId,
      attempts: 0,
    };
  }
  if (built.flagged.length > 0) {
    log({
      level: 'warn',
      event: 'sync.coverage_flagged',
      lineIds: built.flagged.map((entry) => entry.lineId),
      reason: [...new Set(built.flagged.map((entry) => entry.reason))].join(
        ',',
      ),
      ...idField,
    });
  }
  if (built.warnings.length > 0) {
    log({
      level: 'warn',
      event: 'sync.coverage_warning',
      lineIds: built.warnings.map((entry) => entry.lineId),
      reason: 'quantity_mismatch',
      ...idField,
    });
  }
  if (built.coverageLineCount === 0) return skip('no_coverage_lines');
  if (built.contractLineCount === 0 && built.flagged.length > 0) {
    return skip('all_coverage_flagged', built.flagged);
  }

  // 3. PUT with bounded retries.
  let attempt = 0;
  let lastFailure: {reason: CallFailureReason; httpStatus?: number} | null =
    null;
  for (;;) {
    attempt += 1;

    if (deps.breaker) {
      const permit = deps.breaker.acquire();
      if (!permit.allowed) {
        // Our own failed attempts can be what opened the circuit. Then the useful answer is the real cause
        // (for example HTTP 500), not "circuit open", which would hide it from the operator reading the result.
        const cause = lastFailure;
        log({
          level: 'error',
          event: 'sync.gave_up',
          reason: cause?.reason ?? 'circuit_open',
          attempt,
          ...(cause?.httpStatus === undefined
            ? {}
            : {httpStatus: cause.httpStatus}),
          ...idField,
        });
        return cause === null
          ? {
              status: 'failed',
              reason: 'circuit_open',
              retriable: true,
              orderId,
              attempts: attempt - 1,
            }
          : {
              status: 'failed',
              reason: cause.reason,
              retriable: isRetriableLater(cause.reason, cause.httpStatus),
              orderId,
              attempts: attempt - 1,
              ...(cause.httpStatus === undefined
                ? {}
                : {httpStatus: cause.httpStatus}),
            };
      }
    }

    const result = await callExtend(config, deps.fetch, {
      method: 'PUT',
      path: '/orders',
      body: built.snapshot,
      timeoutMs: policy.timeoutMs,
      expectJson: false,
    });

    if (result.status === 'ok') {
      deps.breaker?.recordSuccess();
      log({
        level: 'info',
        event: 'sync.succeeded',
        planIds: built.planIds,
        attempt,
        ...idField,
      });
      return {
        status: 'synced',
        orderId: built.snapshot.transactionId,
        attempts: attempt,
        planIds: built.planIds,
        flagged: built.flagged,
        warnings: built.warnings,
      };
    }

    const {reason, httpStatus, retryAfterMs} = result;
    lastFailure = {reason, ...(httpStatus === undefined ? {} : {httpStatus})};
    if (deps.breaker) {
      if (
        reason !== 'http' ||
        (httpStatus !== undefined && isUnhealthyHttpStatus(httpStatus))
      ) {
        deps.breaker.recordFailure();
      } else {
        deps.breaker.recordSuccess();
      }
    }
    log({
      level: 'warn',
      event: 'sync.attempt_failed',
      reason,
      attempt,
      ...(httpStatus === undefined ? {} : {httpStatus}),
      ...idField,
    });

    const delay = backoffDelayMs(attempt, policy, random, retryAfterMs);
    const outOfTime = deps.now() - startedAt + delay > policy.maxTotalMs;
    if (
      !isTransient(reason, httpStatus) ||
      attempt >= policy.maxAttempts ||
      outOfTime
    ) {
      log({
        level: 'error',
        event: 'sync.gave_up',
        reason,
        attempt,
        ...(httpStatus === undefined ? {} : {httpStatus}),
        ...idField,
      });
      return {
        status: 'failed',
        reason,
        retriable: isRetriableLater(reason, httpStatus),
        orderId,
        attempts: attempt,
        ...(httpStatus === undefined ? {} : {httpStatus}),
      };
    }
    await deps.sleep(delay);
  }
}
