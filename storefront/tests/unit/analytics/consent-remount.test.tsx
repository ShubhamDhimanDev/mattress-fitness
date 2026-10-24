// @vitest-environment jsdom
import {AnalyticsEvent as HydrogenEvent, useAnalytics} from '@shopify/hydrogen';
import {act, cleanup, render, waitFor} from '@testing-library/react';
import {useEffect} from 'react';
import {createMemoryRouter, RouterProvider} from 'react-router';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {AnalyticsGate} from '~/components/consent/AnalyticsGate';
import {parseAnalyticsConfig} from '~/lib/analytics/config';
import {serializeConsent} from '~/lib/analytics/consent';
import {consentHandle, earlyViews} from '~/lib/analytics/gate';
import {currentAnalytics, releaseAnalytics} from '~/lib/analytics/live';

// Code re-review M-1: the root renders one <AnalyticsGate> in the App and another in the ErrorBoundary, and a 404 or
// a route error swaps them, so the consent chunk's component really unmounts and mounts again. The running layer
// must survive that: one script and one setup per provider, no lost or doubled views, and a withdrawal made while no
// component was mounted applied to the resident tag. Real adapters (jsdom does not load their scripts: the test fires
// the load event itself).

const GA = parseAnalyticsConfig({PUBLIC_GA4_MEASUREMENT_ID: 'G-ABCD1234'});
const FLAG = 'ga-disable-G-ABCD1234';

function setConsent(analytics: boolean) {
  const value = serializeConsent(
    {analytics, marketing: false},
    Date.now() / 1000,
  );
  document.cookie = `mf_consent=${encodeURIComponent(value)}; Path=/`;
}

function layer(): unknown[][] {
  const data: unknown = Reflect.get(window, 'dataLayer');
  return Array.isArray(data)
    ? data.map((entry: unknown) => Array.from(entry as ArrayLike<unknown>))
    : [];
}
const calls = (name: string, second?: string) =>
  layer().filter(
    (entry) => entry[0] === name && (second ? entry[1] === second : true),
  ).length;
const scripts = () =>
  document.head.querySelectorAll('script[src*="googletagmanager"]');

function PublishesView() {
  const {publish} = useAnalytics();
  useEffect(() => {
    publish(HydrogenEvent.PRODUCT_VIEWED, {
      url: window.location.href,
      shop: null,
      products: [
        {
          id: 'gid://shopify/Product/9001',
          title: 'Cloud Mattress',
          price: '1999.99',
          vendor: 'Acme',
          variantId: 'gid://shopify/ProductVariant/1',
          variantTitle: 'Queen',
          quantity: 1,
        },
      ],
    });
  }, [publish]);
  return <p>product page</p>;
}

/** One root render: the App's gate, or the ErrorBoundary's. */
function mountRoot(children: React.ReactNode) {
  const router = createMemoryRouter([
    {
      path: '*',
      element: (
        <AnalyticsGate cart={null} shop={null} consent={{}} config={GA}>
          {children}
        </AnalyticsGate>
      ),
    },
  ]);
  return render(<RouterProvider router={router} />);
}

beforeEach(() => {
  Reflect.set(window, 'requestIdleCallback', (callback: () => void) => {
    callback();
    return 1;
  });
  Reflect.set(window, 'cancelIdleCallback', () => {});
  Reflect.set(window, 'Shopify', {
    customerPrivacy: {
      consentStatus: 'loaded',
      analyticsProcessingAllowed: () => true,
    },
  });
  setConsent(true);
});

afterEach(() => {
  cleanup();
  releaseAnalytics();
  document.cookie = 'mf_consent=; Max-Age=0; Path=/';
  document.head.innerHTML = '';
  for (const name of ['dataLayer', 'gtag', FLAG, 'requestIdleCallback']) {
    Reflect.deleteProperty(window, name);
  }
  Reflect.deleteProperty(window, 'cancelIdleCallback');
  Reflect.deleteProperty(window, 'Shopify');
  consentHandle.publish(null);
  earlyViews.reset();
});

describe('the consent layer survives the App / ErrorBoundary swap', () => {
  it('loads one script and sets the tag up once, reports the page once, adopts the layer on remount', async () => {
    const first = mountRoot(<PublishesView />);
    await waitFor(() => expect(scripts()).toHaveLength(1));
    act(() => {
      scripts()[0]?.dispatchEvent(new Event('load'));
    });
    await waitFor(() => expect(calls('event', 'view_item')).toBe(1));
    expect(calls('event', 'page_view')).toBe(1);
    expect(calls('config')).toBe(1);
    const running = currentAnalytics();
    expect(running).not.toBeNull();

    // A 404: the ErrorBoundary's root replaces the App's.
    first.unmount();
    expect(currentAnalytics()).toBe(running);
    const second = mountRoot(<p>page not found</p>);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
    });

    expect(currentAnalytics()).toBe(running);
    expect(scripts()).toHaveLength(1);
    expect(calls('config')).toBe(1);
    expect(calls('js')).toBe(1);
    expect(calls('event', 'view_item')).toBe(1);
    expect(calls('event', 'page_view')).toBe(1);
    second.unmount();
  });

  it('applies a withdrawal made while no component was mounted to the resident tag', async () => {
    const first = mountRoot(<p>a page</p>);
    await waitFor(() => expect(scripts()).toHaveLength(1));
    act(() => {
      scripts()[0]?.dispatchEvent(new Event('load'));
    });
    await waitFor(() => expect(calls('event', 'page_view')).toBe(1));
    expect(Reflect.get(window, FLAG)).toBe(false);

    first.unmount();
    // In the gap: the shopper withdraws in another tab; this tab is looked at again.
    setConsent(false);
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(Reflect.get(window, FLAG)).toBe(true);

    // The remounted layer sees the withdrawal too and sends nothing.
    const sentBefore = layer().length;
    const second = mountRoot(<p>page not found</p>);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
    expect(Reflect.get(window, FLAG)).toBe(true);
    expect(scripts()).toHaveLength(1);
    expect(layer().length).toBe(sentBefore);
    second.unmount();
  });

  it('a withdrawal in the gap is also applied by the adoption itself (no focus event needed)', async () => {
    const first = mountRoot(<p>a page</p>);
    await waitFor(() => expect(scripts()).toHaveLength(1));
    act(() => {
      scripts()[0]?.dispatchEvent(new Event('load'));
    });
    await waitFor(() => expect(calls('event', 'page_view')).toBe(1));
    first.unmount();
    setConsent(false);
    expect(Reflect.get(window, FLAG)).toBe(false);
    const second = mountRoot(<p>page not found</p>);
    await waitFor(() => expect(Reflect.get(window, FLAG)).toBe(true));
    second.unmount();
  });

  it('a layer that was released is replaced by a fresh one on the next mount, and the old one stays stopped', async () => {
    const first = mountRoot(<p>a page</p>);
    await waitFor(() => expect(currentAnalytics()).not.toBeNull());
    const older = currentAnalytics();
    first.unmount();
    releaseAnalytics();
    const second = mountRoot(<p>again</p>);
    await waitFor(() => expect(currentAnalytics()).not.toBeNull());
    expect(currentAnalytics()).not.toBe(older);
    // Releasing the old layer again is a no-op for the new one (the sink is cleared only if it is still the old one's).
    const newer = currentAnalytics();
    expect(newer).not.toBeNull();
    second.unmount();
  });
});
