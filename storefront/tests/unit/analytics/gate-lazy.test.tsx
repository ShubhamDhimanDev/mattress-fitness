// @vitest-environment jsdom
import {act, cleanup, render, screen} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {CHECKOUT_LINK_PATH} from '~/components/consent/AnalyticsBridge';
import {CHECKOUT_STEPS_PATH} from '~/lib/cart/checkout';
import {AnalyticsGate} from '~/components/consent/AnalyticsGate';
import {parseAnalyticsConfig} from '~/lib/analytics/config';
import {consentHandle} from '~/lib/analytics/gate';

// P7-01 bundle budget (scripts/perf): the consent layer is a lazy chunk. With no provider id (the default) the chunk
// is never requested; with one, it is requested only after hydration and when the browser is idle, and the page
// shell (the footer button, Hydrogen's canTrack) reacts to what it publishes. NFR-013: see gate-lazy-failure.test.tsx
// for a chunk that fails to download.

const {loaded} = vi.hoisted(() => ({
  loaded: vi.fn(),
}));

vi.mock('~/components/consent/ConsentRuntime', async () => {
  const React = await import('react');
  const {createAlwaysAllowedStore} =
    await import('~/lib/analytics/consent-store');
  loaded();
  return {
    ConsentRuntime: (props: {
      publishStore: (store: unknown) => void;
      notify: () => void;
      schedule: (callback: () => void) => () => void;
    }) => {
      const {publishStore, notify} = props;
      React.useEffect(() => {
        const store = createAlwaysAllowedStore();
        publishStore(store);
        const unsubscribe = store.subscribe(notify);
        return () => {
          unsubscribe();
          publishStore(null);
        };
      }, [publishStore, notify]);
      return React.createElement('div', {'data-testid': 'runtime'});
    },
  };
});

const idle: Array<() => void> = [];

beforeEach(() => {
  loaded.mockClear();
  idle.length = 0;
  // The browser decides when it is idle; the test decides here.
  Reflect.set(window, 'requestIdleCallback', (callback: () => void) => {
    idle.push(callback);
    return idle.length;
  });
  Reflect.set(window, 'cancelIdleCallback', () => {});
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'requestIdleCallback');
  Reflect.deleteProperty(window, 'cancelIdleCallback');
  consentHandle.publish(null);
});

function renderGate(env: Record<string, string>) {
  return render(
    <AnalyticsGate cart={null} shop={null} config={parseAnalyticsConfig(env)}>
      <p>the page</p>
    </AnalyticsGate>,
  );
}

async function runIdle() {
  await act(async () => {
    for (const callback of idle.splice(0)) callback();
  });
}

describe('with no provider id (the default)', () => {
  it('renders the page and never requests the consent chunk', async () => {
    renderGate({});
    expect(screen.getByText('the page')).toBeInTheDocument();
    expect(idle).toHaveLength(0);
    await runIdle();
    await act(async () => {
      await Promise.resolve();
    });
    expect(loaded).not.toHaveBeenCalled();
    expect(screen.queryByTestId('runtime')).toBeNull();
    expect(consentHandle.getStore()).toBeNull();
  });

  it('a malformed id counts as unset', async () => {
    renderGate({PUBLIC_GA4_MEASUREMENT_ID: 'UA-1', PUBLIC_META_PIXEL_ID: 'x'});
    expect(idle).toHaveLength(0);
    expect(loaded).not.toHaveBeenCalled();
  });
});

describe('with a provider id', () => {
  it('waits for idle: the page is up and the chunk is not requested until then', async () => {
    renderGate({PUBLIC_GA4_MEASUREMENT_ID: 'G-ABCD1234'});
    expect(screen.getByText('the page')).toBeInTheDocument();
    expect(idle).toHaveLength(1);
    expect(loaded).not.toHaveBeenCalled();
    expect(screen.queryByTestId('runtime')).toBeNull();
  });

  it('mounts the chunk after idle, once, for a GA4-only and for a Meta-only configuration', async () => {
    const {unmount} = renderGate({PUBLIC_GA4_MEASUREMENT_ID: 'G-ABCD1234'});
    await runIdle();
    expect(await screen.findByTestId('runtime')).toBeInTheDocument();
    expect(loaded).toHaveBeenCalledTimes(1);
    unmount();
    cleanup();
    renderGate({PUBLIC_META_PIXEL_ID: '123456789012345'});
    await runIdle();
    expect(await screen.findByTestId('runtime')).toBeInTheDocument();
  });

  it('publishes the store once the chunk has loaded, and takes it away when the chunk unmounts', async () => {
    const {unmount} = renderGate({PUBLIC_GA4_MEASUREMENT_ID: 'G-ABCD1234'});
    expect(consentHandle.getStore()).toBeNull();
    await runIdle();
    await screen.findByTestId('runtime');
    expect(consentHandle.getStore()).not.toBeNull();
    unmount();
    expect(consentHandle.getStore()).toBeNull();
  });
});

describe('what Hydrogen is told (canTrack)', () => {
  it('"consented" is false until the chunk has published its store, then always true (tracking is always on)', async () => {
    renderGate({PUBLIC_GA4_MEASUREMENT_ID: 'G-ABCD1234'});
    expect(consentHandle.consented()).toBe(false);
    await runIdle();
    await screen.findByTestId('runtime');
    expect(consentHandle.consented()).toBe(true);
  });
});

describe('begin_checkout link path', () => {
  it('is the checkout gate the cart links to (the bridge writes it out to stay out of the root preload list)', () => {
    expect(CHECKOUT_LINK_PATH).toBe(CHECKOUT_STEPS_PATH);
  });
});
