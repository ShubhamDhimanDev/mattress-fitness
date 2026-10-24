// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {scheduleIdle} from '~/lib/analytics/gate';
import {whenIdle} from '~/lib/when-idle';

// `scheduleIdle` (analytics gate) is a copy of `whenIdle` (header), kept apart so the consent chunk does not share a
// module with the initial JavaScript (bundle budget, scripts/perf). This pins the copy to the original: same
// timeout, same Safari fallback delay, same canceller.

afterEach(() => {
  Reflect.deleteProperty(window, 'requestIdleCallback');
  Reflect.deleteProperty(window, 'cancelIdleCallback');
  vi.useRealTimers();
});

const runners = [
  ['whenIdle', whenIdle],
  ['scheduleIdle', scheduleIdle],
] as const;

describe.each(runners)('%s', (_name, run) => {
  it('uses requestIdleCallback with a 3000 ms limit and cancels with cancelIdleCallback', () => {
    const request = vi.fn(() => 7);
    const cancel = vi.fn();
    Reflect.set(window, 'requestIdleCallback', request);
    Reflect.set(window, 'cancelIdleCallback', cancel);
    const callback = vi.fn();
    const stop = run(callback);
    expect(request).toHaveBeenCalledWith(callback, {timeout: 3000});
    stop();
    expect(cancel).toHaveBeenCalledWith(7);
  });

  it('falls back to a 1500 ms timer where requestIdleCallback is missing, and the canceller clears it', () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const stop = run(callback);
    vi.advanceTimersByTime(1499);
    expect(callback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledTimes(1);

    const second = vi.fn();
    const stopSecond = run(second);
    stopSecond();
    vi.advanceTimersByTime(5000);
    expect(second).not.toHaveBeenCalled();
    stop();
  });
});
