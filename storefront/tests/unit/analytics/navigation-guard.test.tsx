// @vitest-environment jsdom
import {act, cleanup, fireEvent, render, screen} from '@testing-library/react';
import {
  Link,
  Outlet,
  RouterProvider,
  createMemoryRouter,
  type LoaderFunction,
} from 'react-router';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {AnalyticsBridge} from '~/components/consent/AnalyticsBridge';
import {AnalyticsGate} from '~/components/consent/AnalyticsGate';
import {parseAnalyticsConfig} from '~/lib/analytics/config';

// Security re-review A-M1: the providers are paused for a private page BEFORE the address changes, from the pending
// React Router navigation and from a capture-phase click on a link into a private prefix.

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const GA = parseAnalyticsConfig({PUBLIC_GA4_MEASUREMENT_ID: 'G-ABCD1234'});

function setup(loader?: LoaderFunction) {
  const targets: Array<string | null> = [];
  const props = {
    takeEarlyViews: () => [],
    resetEarlyViews: () => {},
    setNavigationTarget: (href: string | null) => void targets.push(href),
  };
  const router = createMemoryRouter(
    [
      {
        // The root layout: the gate and the bridge stay mounted while the page inside changes.
        path: '/',
        element: (
          <AnalyticsGate cart={null} shop={null} config={GA}>
            <AnalyticsBridge {...props} />
            <Link to="/account/orders/123">Your order</Link>
            <Link to="/products/cloud">A product</Link>
            <a href="/track-order" target="_blank" rel="noreferrer">
              Track in a new tab
            </a>
            <Outlet />
          </AnalyticsGate>
        ),
        children: [
          {index: true, element: <p>home</p>},
          {
            path: 'account/orders/:id',
            loader: loader ?? (() => null),
            element: <p>order page</p>,
          },
          {path: 'products/:handle', element: <p>product page</p>},
        ],
      },
    ],
    {initialEntries: ['/']},
  );
  render(<RouterProvider router={router} />);
  return {targets, router};
}

describe('the pending navigation', () => {
  it('reports the private target while the next page loads, and nothing once it has arrived', async () => {
    let finish: () => void = () => {};
    const slow: LoaderFunction = () =>
      new Promise((resolve) => {
        finish = () => resolve(null);
      });
    const {targets} = setup(slow);
    await act(async () => {
      fireEvent.click(screen.getByRole('link', {name: 'Your order'}));
    });
    expect(targets).toContain('/account/orders/123');
    await act(async () => {
      finish();
    });
    expect(await screen.findByText('order page')).toBeInTheDocument();
    expect(targets.at(-1)).toBeNull();
  });
});

describe('a click on a link into a private prefix, in the capture phase', () => {
  it('tells the runtime before the router has started, and releases it if no navigation follows', async () => {
    vi.useFakeTimers();
    const targets: Array<string | null> = [];
    render(
      <RouterProvider
        router={createMemoryRouter([
          {
            path: '/',
            element: (
              <>
                <AnalyticsBridge
                  takeEarlyViews={() => []}
                  resetEarlyViews={() => {}}
                  setNavigationTarget={(href) => void targets.push(href)}
                />
                <a
                  href="/track-order"
                  onClick={(event) => event.preventDefault()}
                >
                  Track an order
                </a>
              </>
            ),
          },
        ])}
      />,
    );
    fireEvent.click(screen.getByRole('link', {name: 'Track an order'}));
    expect(targets.filter((href) => href !== null)).toEqual(['/track-order']);
    act(() => {
      vi.advanceTimersByTime(3100);
    });
    expect(targets.at(-1)).toBeNull();
  });

  it('ignores a modifier click, a middle click and a link that opens elsewhere', async () => {
    const {targets} = setup();
    const before = targets.length;
    const newTab = screen.getByRole('link', {name: 'Track in a new tab'});
    fireEvent.click(newTab);
    fireEvent.click(screen.getByRole('link', {name: 'Your order'}), {
      ctrlKey: true,
    });
    fireEvent.click(screen.getByRole('link', {name: 'Your order'}), {
      metaKey: true,
    });
    fireEvent.click(screen.getByRole('link', {name: 'Your order'}), {
      button: 1,
    });
    expect(targets.slice(before).filter((t) => t !== null)).toEqual([]);
  });
});
