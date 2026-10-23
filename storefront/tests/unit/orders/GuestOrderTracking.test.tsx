// @vitest-environment jsdom
import {cleanup, fireEvent, render, screen} from '@testing-library/react';
import {RouterProvider, createMemoryRouter, data} from 'react-router';
import {afterEach, describe, expect, it} from 'vitest';
import {
  GuestOrderSummary,
  formatPlacedDate,
} from '~/components/orders/GuestOrderSummary';
import {
  GUEST_LOOKUP_FAILURE_MESSAGE,
  matchGuestOrder,
  type GuestOrderView,
} from '~/lib/orders/guest-lookup';
import {
  GUEST_LOOKUP_RATE_LIMITED_MESSAGE,
  GUEST_LOOKUP_UNAVAILABLE_MESSAGE,
  type GuestLookupResponse,
} from '~/lib/orders/guest-lookup-handler';
import TrackOrderPage from '~/routes/track-order';
import {FIXTURE_NOW, fixtureOrder} from './fake-admin-client';

afterEach(cleanup);

// REQ-ACC-003 / P6-08: the guest tracking page and its pieces. The page runs inside a data router whose loader and
// action are stand-ins for the server (the real ones are covered by tests/unit/routes/track-order.test.ts).

function viewOf(overrides: Parameters<typeof fixtureOrder>[0] = {}) {
  const result = matchGuestOrder(
    fixtureOrder(overrides),
    {orderNumber: '#1001', email: 'shopper@example.com'},
    FIXTURE_NOW,
  );
  if (result.status !== 'match') throw new Error('fixture must match');
  return result.order;
}

function renderPage(options: {
  available?: boolean;
  respond?: () => GuestLookupResponse;
  status?: number;
}) {
  const router = createMemoryRouter(
    [
      {
        path: '/track-order',
        Component: TrackOrderPage,
        loader: () => ({available: options.available ?? true}),
        action: () =>
          data(
            options.respond?.() ?? {
              status: 'not_found',
              message: GUEST_LOOKUP_FAILURE_MESSAGE,
            },
            {status: options.status ?? 200},
          ),
      },
    ],
    {
      initialEntries: [
        '/track-order?orderNumber=1001&email=shopper%40example.com',
      ],
    },
  );
  render(<RouterProvider router={router} />);
  return router;
}

async function submitForm() {
  const form = await screen.findByRole('form', {name: 'Find your order'});
  fireEvent.submit(form);
}

describe('the track-order page', () => {
  it('shows a labelled form that posts, and ignores the query string', async () => {
    renderPage({});
    const form = await screen.findByRole('form', {name: 'Find your order'});
    expect(form).toHaveAttribute('method', 'post');
    expect(form).toHaveAttribute('action', '/track-order');
    const number = screen.getByLabelText(/Order number/);
    const email = screen.getByLabelText(/Email address/);
    expect(number).toHaveValue('');
    expect(email).toHaveValue('');
    expect(number).toBeRequired();
    expect(email).toHaveAttribute('type', 'email');
    expect(email).toHaveAttribute('autocomplete', 'email');
    expect(number).toHaveAttribute('autocomplete', 'off');
    expect(
      screen.getByRole('heading', {level: 1, name: 'Track your order'}),
    ).toBeInTheDocument();
    expect(document.body).toHaveTextContent('last 60 days');
    expect(
      screen.getByRole('button', {name: 'Find my order'}),
    ).toBeInTheDocument();
  });

  it('shows only the unavailable notice, and no form, when the lookup is not configured', async () => {
    renderPage({available: false});
    expect(
      await screen.findByRole('heading', {
        name: 'Order lookup is not available right now',
      }),
    ).toBeInTheDocument();
    expect(document.body).toHaveTextContent(GUEST_LOOKUP_UNAVAILABLE_MESSAGE);
    expect(screen.queryByRole('form')).toBeNull();
    expect(screen.queryByLabelText(/Order number/)).toBeNull();
    expect(
      screen.getByRole('link', {name: 'Sign in to your account'}),
    ).toHaveAttribute('href', '/account/login');
  });

  it('shows the generic message for a failed lookup and echoes nothing the shopper typed', async () => {
    renderPage({});
    fireEvent.change(await screen.findByLabelText(/Order number/), {
      target: {value: '#1001'},
    });
    fireEvent.change(screen.getByLabelText(/Email address/), {
      target: {value: 'shopper@example.com'},
    });
    await submitForm();
    const message = await screen.findByText(GUEST_LOOKUP_FAILURE_MESSAGE);
    expect(message).toBeInTheDocument();
    expect(
      screen.getByRole('link', {name: 'Sign in to your account'}),
    ).toBeInTheDocument();
    // The message sits in a live region and focus moves there.
    expect(message.closest('[aria-live="polite"]')).not.toBeNull();
    expect(document.activeElement).toBe(message.closest('[aria-live]'));
  });

  it('shows the order for a match', async () => {
    renderPage({
      respond: () => ({status: 'found', order: viewOf()}),
    });
    await submitForm();
    expect(
      await screen.findByRole('heading', {name: 'Order #1001'}),
    ).toBeInTheDocument();
    expect(screen.getByText('Fulfilled')).toBeInTheDocument();
    expect(
      screen.getByText(/Larkmoor Cedar Medium Hybrid Mattress - Queen/),
    ).toBeInTheDocument();
    expect(screen.queryByText(GUEST_LOOKUP_FAILURE_MESSAGE)).toBeNull();
  });

  it('shows the rate-limit notice', async () => {
    renderPage({
      status: 429,
      respond: () => ({
        status: 'rate_limited',
        message: GUEST_LOOKUP_RATE_LIMITED_MESSAGE,
      }),
    });
    await submitForm();
    expect(
      await screen.findByText(GUEST_LOOKUP_RATE_LIMITED_MESSAGE),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {name: 'Please wait before trying again'}),
    ).toBeInTheDocument();
  });

  it('replaces the form with the unavailable notice if the server says so mid-session', async () => {
    renderPage({
      status: 503,
      respond: () => ({
        status: 'unavailable',
        message: GUEST_LOOKUP_UNAVAILABLE_MESSAGE,
      }),
    });
    await submitForm();
    expect(
      await screen.findByRole('heading', {
        name: 'Order lookup is not available right now',
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('form')).toBeNull();
  });
});

describe('<GuestOrderSummary>', () => {
  function view(order: GuestOrderView) {
    render(<GuestOrderSummary order={order} />);
  }

  it('lists the order, status, items and tracking with a safe external link', () => {
    view(viewOf());
    expect(
      screen.getByRole('heading', {name: 'Order #1001'}),
    ).toBeInTheDocument();
    expect(screen.getByText('October 2, 2026')).toBeInTheDocument();
    expect(screen.getByText('In transit')).toBeInTheDocument();
    expect(
      screen.getByText('Example Freight TRK123456789'),
    ).toBeInTheDocument();
    const link = screen.getByRole('link', {name: /Track this package/});
    expect(link).toHaveAttribute(
      'href',
      'https://tracking.example.com/TRK123456789',
    );
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveTextContent('(opens in a new tab)');
  });

  it('says there is no tracking yet when nothing has shipped', () => {
    view(viewOf({fulfillments: [], displayFulfillmentStatus: 'UNFULFILLED'}));
    expect(screen.getByText('Being prepared')).toBeInTheDocument();
    expect(screen.getByText(/No tracking details yet/)).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('renders hostile item text as text and never as a link or markup', () => {
    const order = viewOf();
    view({
      ...order,
      items: [{title: '<img src=x onerror=alert(1)> Mattress', quantity: 1}],
      shipments: [
        {
          statusLabel: null,
          trackingCompany: '<b>Carrier</b>',
          trackingNumber: null,
          trackingUrl: null,
        },
      ],
    });
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('b')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    expect(document.body).toHaveTextContent(
      '<img src=x onerror=alert(1)> Mattress',
    );
  });

  it('formats the date in UTC and tolerates a bad one', () => {
    expect(formatPlacedDate('2026-10-02T03:00:00Z')).toBe('October 2, 2026');
    expect(formatPlacedDate('not a date')).toBe('');
  });
});
