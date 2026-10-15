// @vitest-environment jsdom
import {cleanup, render, screen} from '@testing-library/react';
import {
  RouterProvider,
  createMemoryRouter,
  data as routeData,
} from 'react-router';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {AccountErrorBoundary} from '~/components/account/AccountErrorBoundary';

afterEach(cleanup);

// P6-07 / P-L8 / T-11: the account error page shows fixed text, never the thrown message, and always offers a
// way forward.

function renderFailure(failure: () => never, path = '/account/orders?page=2') {
  // React Router logs a caught route error to the console; that noise is not under test.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const router = createMemoryRouter(
    [
      {
        path: '/account',
        errorElement: <AccountErrorBoundary />,
        children: [{path: 'orders', loader: failure, element: <p>ok</p>}],
      },
    ],
    {initialEntries: [path]},
  );
  render(<RouterProvider router={router} />);
}

describe('<AccountErrorBoundary>', () => {
  it('offers a retry for a failed read and hides the error text', async () => {
    renderFailure(() => {
      throw new Error('LEAK customer jane.doe@example.com');
    });
    expect(
      await screen.findByRole('heading', {
        name: 'We could not load your account',
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Please try again');
    expect(document.body).not.toHaveTextContent('LEAK');
    expect(document.body).not.toHaveTextContent('jane.doe');
    expect(screen.getByRole('link', {name: 'Try again'})).toHaveAttribute(
      'href',
      '/account/orders?page=2',
    );
    expect(
      screen.getByRole('link', {name: 'Back to the home page'}),
    ).toHaveAttribute('href', '/');
  });

  it('sends a 401 or 403 to sign in again', async () => {
    renderFailure(() => {
      throw routeData({message: 'LEAK'}, {status: 403});
    });
    expect(
      await screen.findByRole('heading', {name: 'Please sign in again'}),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'Sign in'})).toHaveAttribute(
      'href',
      '/account/login',
    );
    expect(document.body).not.toHaveTextContent('LEAK');
  });

  it('says an order is not found, and links back to the account, for a 404', async () => {
    renderFailure(() => {
      throw routeData({message: 'LEAK'}, {status: 404});
    });
    expect(
      await screen.findByRole('heading', {name: 'We could not find that'}),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', {name: 'Back to your account'}),
    ).toHaveAttribute('href', '/account');
    expect(document.body).not.toHaveTextContent('LEAK');
  });
});
