import {describe, expect, it} from 'vitest';
import {
  createCircuitBreaker,
  isUnhealthyHttpStatus,
} from '~/lib/extend/circuit-breaker';

function setup(options: {failureThreshold?: number; openMs?: number} = {}) {
  const clock = {t: 1_000};
  const breaker = createCircuitBreaker({now: () => clock.t, ...options});
  return {clock, breaker};
}

describe('circuit breaker (NFR-013, T-13)', () => {
  it('stays closed below the threshold and a success resets the count', () => {
    const {breaker} = setup({failureThreshold: 3});
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordSuccess();
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.snapshot()).toEqual({
      state: 'closed',
      consecutiveFailures: 2,
    });
    expect(breaker.acquire()).toEqual({allowed: true, probe: false});
  });

  it('opens after N consecutive failures and denies calls until the period ends', () => {
    const {breaker, clock} = setup({failureThreshold: 3, openMs: 10_000});
    for (let i = 0; i < 3; i += 1) breaker.recordFailure();
    expect(breaker.snapshot().state).toBe('open');
    expect(breaker.acquire()).toEqual({allowed: false, retryAfterMs: 10_000});
    clock.t += 4_000;
    expect(breaker.acquire()).toEqual({allowed: false, retryAfterMs: 6_000});
  });

  it('lets exactly one probe through after the open period, then closes on success', () => {
    const {breaker, clock} = setup({failureThreshold: 2, openMs: 5_000});
    breaker.recordFailure();
    breaker.recordFailure();
    clock.t += 5_000;
    expect(breaker.acquire()).toEqual({allowed: true, probe: true});
    expect(breaker.snapshot().state).toBe('half_open');
    expect(breaker.acquire().allowed).toBe(false); // second caller waits for the probe
    breaker.recordSuccess();
    expect(breaker.snapshot()).toEqual({
      state: 'closed',
      consecutiveFailures: 0,
    });
    expect(breaker.acquire()).toEqual({allowed: true, probe: false});
  });

  it('re-opens for a full period when the probe fails', () => {
    const {breaker, clock} = setup({failureThreshold: 2, openMs: 5_000});
    breaker.recordFailure();
    breaker.recordFailure();
    clock.t += 5_000;
    expect(breaker.acquire().allowed).toBe(true);
    breaker.recordFailure();
    expect(breaker.snapshot().state).toBe('open');
    clock.t += 4_999;
    expect(breaker.acquire().allowed).toBe(false);
    clock.t += 1;
    expect(breaker.acquire()).toEqual({allowed: true, probe: true});
  });

  it('abandons a probe that never reported back so the circuit cannot stay shut forever', () => {
    const {breaker, clock} = setup({failureThreshold: 1, openMs: 5_000});
    breaker.recordFailure();
    clock.t += 5_000;
    expect(breaker.acquire().allowed).toBe(true); // probe starts, never reports
    clock.t += 4_000;
    expect(breaker.acquire().allowed).toBe(false);
    clock.t += 1_000;
    expect(breaker.acquire()).toEqual({allowed: true, probe: true});
  });

  it('ignores a late failure from a call made before the circuit opened', () => {
    const {breaker, clock} = setup({failureThreshold: 1, openMs: 5_000});
    breaker.recordFailure();
    clock.t += 1_000;
    breaker.recordFailure();
    clock.t += 4_000; // 5s after it opened, not after the late failure
    expect(breaker.acquire()).toEqual({allowed: true, probe: true});
  });

  it('clamps nonsense options', () => {
    const {breaker} = setup({failureThreshold: 0, openMs: 0});
    breaker.recordFailure();
    expect(breaker.snapshot().state).toBe('open');
  });
});

describe('which HTTP statuses count as an unhealthy provider (NFR-013)', () => {
  it.each([
    [500, true],
    [502, true],
    [503, true],
    [504, true],
    [429, true],
    [408, true],
    [401, true],
    [403, true],
    [400, false],
    [404, false],
    [409, false],
    [422, false],
    [200, false],
  ])('%i -> %s', (status, unhealthy) => {
    expect(isUnhealthyHttpStatus(status)).toBe(unhealthy);
  });
});
