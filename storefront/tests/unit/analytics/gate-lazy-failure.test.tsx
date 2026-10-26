// @vitest-environment jsdom
import {act, cleanup, render, screen, waitFor} from '@testing-library/react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {AnalyticsGate} from '~/components/consent/AnalyticsGate';
import {parseAnalyticsConfig} from '~/lib/analytics/config';
import {earlyViews} from '~/lib/analytics/gate';

// NFR-013 with the bundle budget: the consent layer is a lazy chunk, and a chunk that fails to download (offline,
// a deploy replaced the file, an ad blocker) must hide the consent layer and nothing else.

vi.mock('~/components/consent/ConsentRuntime', () => {
  throw new Error('chunk failed to load');
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'requestIdleCallback');
});

describe('a consent chunk that fails to load', () => {
  it('leaves the page rendered and throws nothing', async () => {
    Reflect.set(window, 'requestIdleCallback', (callback: () => void) => {
      callback();
      return 1;
    });
    Reflect.set(window, 'cancelIdleCallback', () => {});
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(
      <AnalyticsGate
        cart={null}
        shop={null}
        config={parseAnalyticsConfig({PUBLIC_GA4_MEASUREMENT_ID: 'G-ABCD1234'})}
      >
        <p>the page</p>
      </AnalyticsGate>,
    );
    const failureLines = () =>
      warnings.mock.calls
        .map((call) => String(call[0]))
        .filter((line) => line.includes('analytics.chunk_failed'));
    // The logger is fetched with a dynamic import on the failure path only, so the line arrives a moment later: wait for it
    // instead of sleeping a fixed time (a fixed 20 ms flaked under a loaded machine).
    await waitFor(() => expect(failureLines()).toHaveLength(1));
    // Let real timer ticks pass, then count again: a second report (a retry, a remount) would arrive late, and the
    // wait above stops at the first line, so it could not see one.
    for (let tick = 0; tick < 2; tick += 1) {
      await act(async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 30));
      });
      expect(failureLines()).toHaveLength(1);
    }
    expect(screen.getByText('the page')).toBeInTheDocument();
    // React reports an uncaught render error with console.error; there must be none.
    expect(errors).not.toHaveBeenCalled();
    // One closed-vocabulary line: the event name and the class of the failure, nothing else (code re-review m-9).
    const lines = failureLines();
    expect(lines).toHaveLength(1);
    const fields: unknown = JSON.parse(lines[0] ?? '{}');
    expect(fields).toMatchObject({
      level: 'warn',
      event: 'analytics.chunk_failed',
      reason: 'Error',
    });
    expect(lines[0]).not.toMatch(/chunk failed to load|localhost|http/);
    // Nothing will ever take the kept page views, so they are no longer kept.
    earlyViews.keep('product_viewed', {url: 'x'});
    expect(earlyViews.take()).toEqual([]);
  });
});
