// @vitest-environment jsdom
import {
  AnalyticsEvent as HydrogenEvent,
  useAnalytics,
} from '~/lib/hydrogen/analytics';
import {act, cleanup, render, screen, waitFor} from '@testing-library/react';
import {StrictMode, useEffect} from 'react';
import {createMemoryRouter, RouterProvider} from 'react-router';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {AnalyticsGate} from '~/components/consent/AnalyticsGate';
import {track, type AnalyticsEvent} from '~/lib/analytics';
import type {ProviderAdapter} from '~/lib/analytics/adapter';
import {parseAnalyticsConfig} from '~/lib/analytics/config';
import {serializeConsent} from '~/lib/analytics/consent';
import {consentHandle, earlyViews} from '~/lib/analytics/gate';
import {releaseAnalytics} from '~/lib/analytics/live';

// P7-01 review 2026-10-24 (M-1): the REAL lazy chunk (ConsentRuntime, runtime, bridge, store, banner), the real
// AnalyticsGate and Hydrogen's real Analytics.Provider. Only the provider adapters are replaced by a recorder, because
// jsdom cannot load Google's script. Proves that, with consent already stored, (1) events `track()` held while the
// chunk was loading reach the provider once, and (2) the product view Hydrogen published before the chunk existed
// is not lost.

const sent: AnalyticsEvent[] = [];

vi.mock('~/lib/analytics/browser', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('~/lib/analytics/browser')>();
  return {
    ...original,
    createBrowserAdapters: (): ProviderAdapter[] => [
      {
        id: 'ga4',
        category: 'analytics',
        load: () => Promise.resolve({status: 'ready'}),
        send: (event) => void sent.push(event),
        grant: () => {},
        revoke: () => {},
      },
    ],
  };
});

const GA = parseAnalyticsConfig({PUBLIC_GA4_MEASUREMENT_ID: 'G-ABCD1234'});
const names = () => sent.map((event) => event.name);
const count = (name: string) => names().filter((n) => n === name).length;

function storeConsent(analytics: boolean) {
  const value = serializeConsent(
    {analytics, marketing: false},
    Date.now() / 1000,
  );
  document.cookie = `mf_consent=${encodeURIComponent(value)}; Path=/`;
}

function productPayload(url: string) {
  return {
    url,
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
  };
}

/** What a product page does: Hydrogen's view event is published once, on the first render. */
function PublishesProductView({url}: {url: string}) {
  const {publish} = useAnalytics();
  useEffect(() => {
    publish(HydrogenEvent.PRODUCT_VIEWED, productPayload(url));
  }, [publish, url]);
  return <p>product page</p>;
}

// A data router, as in the app: the bridge reads the pending navigation from it.
function renderPage(children: React.ReactNode, strict = false) {
  const router = createMemoryRouter([
    {
      path: '*',
      element: (
        <AnalyticsGate cart={null} shop={null} config={GA}>
          {children}
        </AnalyticsGate>
      ),
    },
  ]);
  const page = <RouterProvider router={router} />;
  return render(strict ? <StrictMode>{page}</StrictMode> : page);
}

beforeEach(() => {
  sent.length = 0;
  // The browser is idle at once; Hydrogen's consent script is "loaded" and says analytics is allowed (the US default).
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
});

afterEach(() => {
  cleanup();
  releaseAnalytics();
  document.cookie = 'mf_consent=; Max-Age=0; Path=/';
  Reflect.deleteProperty(window, 'requestIdleCallback');
  Reflect.deleteProperty(window, 'cancelIdleCallback');
  Reflect.deleteProperty(window, 'Shopify');
  consentHandle.publish(null);
  earlyViews.reset();
});

describe('the real consent chunk with consent already stored', () => {
  it('sends the events track() held while the chunk was loading, once each', async () => {
    storeConsent(true);
    track({
      name: 'view_item_list',
      params: {},
      ecommerce: {items: [], listId: 'all', listName: 'all'},
    });
    track({name: 'select_item', params: {}});
    renderPage(<p>a listing</p>);
    await waitFor(() => expect(count('view_item_list')).toBe(1));
    await waitFor(() => expect(count('page_view')).toBe(1));
    expect(count('select_item')).toBe(1);
    // Nothing doubled once everything has settled.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(names().filter((n) => n === 'view_item_list')).toHaveLength(1);
    expect(names().filter((n) => n === 'page_view')).toHaveLength(1);
  });

  it('does not lose the product view Hydrogen published before the chunk existed', async () => {
    storeConsent(true);
    renderPage(<PublishesProductView url={window.location.href} />);
    expect(screen.getByText('product page')).toBeInTheDocument();
    await waitFor(() => expect(count('view_item')).toBe(1));
    const view = sent.find((event) => event.name === 'view_item');
    expect(view?.ecommerce?.items[0]).toMatchObject({
      id: '9001',
      name: 'Cloud Mattress',
      priceCents: 199999,
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(count('view_item')).toBe(1);
    expect(count('page_view')).toBe(1);
  });

  it('does not send a kept view that belongs to another page', async () => {
    storeConsent(true);
    renderPage(
      <PublishesProductView url="http://localhost:3000/products/some-other-page" />,
    );
    await waitFor(() => expect(count('page_view')).toBe(1));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(count('view_item')).toBe(0);
  });
});

describe('the real consent chunk before the shopper has answered (opt-in)', () => {
  it('sends nothing, then sends the page view and the page\'s product view once after "Accept all"', async () => {
    renderPage(<PublishesProductView url={window.location.href} />);
    const accept = await screen.findByRole('button', {name: 'Accept all'});
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(sent).toEqual([]);
    await act(async () => accept.click());
    await waitFor(() => expect(count('view_item')).toBe(1));
    expect(names().slice(0, 2)).toEqual(['page_view', 'view_item']);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(names()).toEqual(['page_view', 'view_item']);
  });
});

// QA F-1: the dev server runs React in StrictMode, which cleans every effect up and runs it again at once. The consent
// chunk must keep the events track() held (and the early product view) through that.
describe('the real consent chunk under React StrictMode (development)', () => {
  it('still sends the events track() held while the chunk loaded, once each', async () => {
    storeConsent(true);
    track({
      name: 'view_item_list',
      params: {},
      ecommerce: {items: [], listId: 'all', listName: 'all'},
    });
    renderPage(<p>a listing</p>, true);
    await waitFor(() => expect(count('view_item_list')).toBe(1));
    await waitFor(() => expect(count('page_view')).toBe(1));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(count('view_item_list')).toBe(1);
    expect(count('page_view')).toBe(1);
  });

  it('still sends the product view published before the chunk existed, once', async () => {
    storeConsent(true);
    renderPage(<PublishesProductView url={window.location.href} />, true);
    await waitFor(() => expect(count('view_item')).toBe(1));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(count('view_item')).toBe(1);
  });
});
