// @vitest-environment jsdom
import {act, cleanup, fireEvent, render, screen} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {CHECKOUT_LINK_PATH} from '~/components/consent/AnalyticsBridge';
import {CHECKOUT_STEPS_PATH} from '~/lib/cart/checkout';
import {AnalyticsGate} from '~/components/consent/AnalyticsGate';
import {PrivacyChoicesButton} from '~/components/consent/PrivacyChoicesButton';
import {parseAnalyticsConfig} from '~/lib/analytics/config';
import {consentHandle} from '~/lib/analytics/gate';

// P7-01 bundle budget (scripts/perf): the consent layer is a lazy chunk. With no provider id (the default) the chunk
// is never requested; with one, it is requested only after hydration and when the browser is idle, and the page
// shell (the footer button, Hydrogen's canTrack) reacts to what it publishes. NFR-013: see gate-lazy-failure.test.tsx
// for a chunk that fails to download.

const {loaded, published} = vi.hoisted(() => ({
  loaded: vi.fn(),
  published: {store: null as unknown},
}));

vi.mock('~/components/consent/ConsentRuntime', async () => {
  const React = await import('react');
  const {createConsentStore} = await import('~/lib/analytics/consent-store');
  loaded();
  return {
    ConsentRuntime: (props: {
      publishStore: (store: unknown) => void;
      notify: () => void;
      schedule: (callback: () => void) => () => void;
    }) => {
      const {publishStore, notify} = props;
      React.useEffect(() => {
        const store = createConsentStore({
          mode: 'opt-in',
          storage: {read: () => null, write: () => {}},
        });
        published.store = store;
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
    <AnalyticsGate
      cart={null}
      shop={null}
      consent={{}}
      config={parseAnalyticsConfig(env)}
    >
      <p>the page</p>
      <PrivacyChoicesButton />
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
    expect(screen.queryByRole('button', {name: 'Privacy choices'})).toBeNull();
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

  it('the footer button appears once the chunk has published its store, and opens the preferences', async () => {
    renderGate({PUBLIC_GA4_MEASUREMENT_ID: 'G-ABCD1234'});
    expect(screen.queryByRole('button', {name: 'Privacy choices'})).toBeNull();
    await runIdle();
    const button = await screen.findByRole('button', {name: 'Privacy choices'});
    const store = published.store as {
      getSnapshot: () => {preferencesOpen: boolean};
    };
    expect(store.getSnapshot().preferencesOpen).toBe(false);
    fireEvent.click(button);
    expect(store.getSnapshot().preferencesOpen).toBe(true);
  });

  it('the button goes away when the chunk unmounts', async () => {
    const {unmount} = renderGate({PUBLIC_GA4_MEASUREMENT_ID: 'G-ABCD1234'});
    await runIdle();
    await screen.findByRole('button', {name: 'Privacy choices'});
    unmount();
    expect(consentHandle.getStore()).toBeNull();
  });
});

describe('what Hydrogen is told (canTrack)', () => {
  it('"consented" is false without a choice, true for any consented provider, and follows a withdrawal', async () => {
    renderGate({PUBLIC_GA4_MEASUREMENT_ID: 'G-ABCD1234'});
    expect(consentHandle.consented()).toBe(false);
    await runIdle();
    await screen.findByTestId('runtime');
    const store = published.store as {
      acceptAll: () => void;
      rejectAll: () => void;
      save: (choice: {analytics: boolean; marketing: boolean}) => void;
    };
    await act(async () => store.acceptAll());
    expect(consentHandle.consented()).toBe(true);
    await act(async () => store.save({analytics: false, marketing: true}));
    expect(consentHandle.consented()).toBe(true);
    await act(async () => store.rejectAll());
    expect(consentHandle.consented()).toBe(false);
  });
});

describe('begin_checkout link path', () => {
  it('is the checkout gate the cart links to (the bridge writes it out to stay out of the root preload list)', () => {
    expect(CHECKOUT_LINK_PATH).toBe(CHECKOUT_STEPS_PATH);
  });
});
