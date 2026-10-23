// @vitest-environment jsdom
import {act, cleanup, render, screen} from '@testing-library/react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {AnalyticsGate} from '~/components/consent/AnalyticsGate';
import {parseAnalyticsConfig} from '~/lib/analytics/config';

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
    render(
      <AnalyticsGate
        cart={null}
        shop={null}
        consent={{}}
        config={parseAnalyticsConfig({PUBLIC_GA4_MEASUREMENT_ID: 'G-ABCD1234'})}
      >
        <p>the page</p>
      </AnalyticsGate>,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(screen.getByText('the page')).toBeInTheDocument();
    // React reports an uncaught render error with console.error; there must be none.
    expect(errors).not.toHaveBeenCalled();
  });
});
