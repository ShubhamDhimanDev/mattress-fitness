// In-memory circuit breaker (NFR-013, T-13). State is per isolate/process: on Oxygen each isolate keeps its
// own breaker, which is acceptable because the aim is to stop hammering a failing provider, not to count exactly.
// The clock is injected so tests never sleep.

import type {NowFn} from '~/lib/extend/types';

export type CircuitBreakerOptions = {
  now: NowFn;
  /** Consecutive failures that open the circuit. */
  failureThreshold?: number;
  /** How long the circuit stays open before a single probe request is allowed. */
  openMs?: number;
};

export type BreakerState = 'closed' | 'open' | 'half_open';

export type AcquireResult =
  {allowed: true; probe: boolean} | {allowed: false; retryAfterMs: number};

export type CircuitBreaker = {
  acquire: () => AcquireResult;
  recordSuccess: () => void;
  recordFailure: () => void;
  snapshot: () => {state: BreakerState; consecutiveFailures: number};
};

export function createCircuitBreaker(
  options: CircuitBreakerOptions,
): CircuitBreaker {
  const threshold = Math.max(1, options.failureThreshold ?? 5);
  const openMs = Math.max(1, options.openMs ?? 30_000);
  const {now} = options;

  let consecutiveFailures = 0;
  let openedAt: number | null = null;
  let probeStartedAt: number | null = null;

  const state = (): BreakerState => {
    if (openedAt === null) return 'closed';
    return probeStartedAt === null ? 'open' : 'half_open';
  };

  return {
    acquire() {
      if (openedAt === null) return {allowed: true, probe: false};
      const elapsed = now() - openedAt;
      if (elapsed < openMs) {
        return {allowed: false, retryAfterMs: openMs - elapsed};
      }
      // Half-open: exactly one probe at a time. A probe that never reported back (lost isolate, bug) is
      // abandoned after another openMs so the circuit cannot stay shut forever.
      if (probeStartedAt !== null && now() - probeStartedAt < openMs) {
        return {
          allowed: false,
          retryAfterMs: openMs - (now() - probeStartedAt),
        };
      }
      probeStartedAt = now();
      return {allowed: true, probe: true};
    },
    recordSuccess() {
      consecutiveFailures = 0;
      openedAt = null;
      probeStartedAt = null;
    },
    recordFailure() {
      if (openedAt !== null) {
        // A failed probe re-opens for a full period; a late failure from before the circuit opened is ignored.
        if (probeStartedAt !== null) {
          openedAt = now();
          probeStartedAt = null;
        }
        return;
      }
      consecutiveFailures += 1;
      if (consecutiveFailures >= threshold) {
        openedAt = now();
        probeStartedAt = null;
      }
    },
    snapshot: () => ({state: state(), consecutiveFailures}),
  };
}

/**
 * Which HTTP outcomes say "the provider is unhealthy". A 4xx that is about our request (400, 404, 409, 422)
 * proves the provider is up, so it counts as healthy; 401/403 (bad credentials), 408, 429 and 5xx do not.
 * ASSUMPTION(V-11): Extend's guides document no error statuses or rate limits, so these meanings are the standard
 * HTTP ones; confirm against the demo host.
 */
export function isUnhealthyHttpStatus(status: number): boolean {
  return (
    status >= 500 ||
    status === 401 ||
    status === 403 ||
    status === 408 ||
    status === 429
  );
}
