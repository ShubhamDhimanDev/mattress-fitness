// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import {createMemoryRouter, data, RouterProvider} from 'react-router';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {DeliveryCheck} from '~/components/delivery/DeliveryCheck';
import {deliveryViewFor} from '~/lib/delivery/status';
import type {DeliveryZone} from '~/lib/delivery/zone';

afterEach(cleanup);

// P3B-11, P5B-03: REQ-NAV-003 (validated, persisted, editable), REQ-DEL-002 (yes/no and approved wording).

const ZONE: DeliveryZone = {
  name: 'Test',
  postalCodes: ['606*'],
  feeCents: 100,
  freeOverCents: null,
  promise: {inHome: 'White-glove delivery.', parcel: '', pickup: ''},
};

/** An in-memory stand-in for the /delivery route: same shapes, no cookie. */
function renderCheck(options: {
  zone?: DeliveryZone | null;
  saved?: string | null;
}) {
  let saved = options.saved ?? null;
  const zone = options.zone === undefined ? ZONE : options.zone;
  const submissions: string[] = [];
  const router = createMemoryRouter(
    [
      {path: '/products/x', element: <DeliveryCheck />},
      {
        path: '/delivery',
        loader: () =>
          data({delivery: deliveryViewFor(zone, saved), error: null}),
        action: async ({request}) => {
          const form = await request.formData();
          submissions.push(String(form.get('zip') ?? form.get('intent')));
          saved =
            form.get('intent') === 'clear' ? null : String(form.get('zip'));
          return data({delivery: deliveryViewFor(zone, saved), error: null});
        },
      },
    ],
    {initialEntries: ['/products/x']},
  );
  render(<RouterProvider router={router} />);
  return {submissions};
}

describe('DeliveryCheck', () => {
  it('asks for a ZIP when none is saved, with a labelled field', async () => {
    renderCheck({});
    expect(await screen.findByLabelText('ZIP code')).toBeInTheDocument();
    expect(
      screen.getByText(/Enter your ZIP code to see delivery options/i),
    ).toBeInTheDocument();
  });

  it('shows an inline error and sends nothing for an invalid ZIP', async () => {
    const {submissions} = renderCheck({});
    const input = await screen.findByLabelText('ZIP code');
    fireEvent.change(input, {target: {value: '12'}});
    fireEvent.click(screen.getByRole('button', {name: /check delivery/i}));
    expect(
      await screen.findByText('Enter a 5-digit US ZIP code.'),
    ).toBeVisible();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(submissions).toEqual([]);
  });

  it('says yes with the approved wording for a ZIP inside the zone, then offers to change it', async () => {
    const {submissions} = renderCheck({});
    fireEvent.change(await screen.findByLabelText('ZIP code'), {
      target: {value: '60645'},
    });
    fireEvent.click(screen.getByRole('button', {name: /check delivery/i}));
    expect(
      await screen.findByText('In-home delivery is available to 60645.'),
    ).toBeVisible();
    expect(screen.getByText('White-glove delivery.')).toBeVisible();
    expect(submissions).toEqual(['60645']);
    expect(
      screen.getByRole('button', {name: /change zip code/i}),
    ).toBeVisible();
  });

  it('says no, with no promise text, for a ZIP outside the zone', async () => {
    renderCheck({saved: '90210'});
    expect(
      await screen.findByText('In-home delivery is not available to 90210.'),
    ).toBeVisible();
    expect(screen.queryByText('White-glove delivery.')).toBeNull();
  });

  it('shows the saved ZIP from the server on first paint of the answer', async () => {
    renderCheck({saved: '60645'});
    expect(
      await screen.findByText('In-home delivery is available to 60645.'),
    ).toBeVisible();
  });

  it('renders nothing when no delivery zone is configured (never a false yes)', async () => {
    const view = renderCheck({zone: null, saved: '60645'});
    await waitFor(() => expect(screen.queryByText(/available to/i)).toBeNull());
    expect(view.submissions).toEqual([]);
    await waitFor(() => expect(screen.queryByLabelText('ZIP code')).toBeNull());
  });

  it('clears the saved ZIP and goes back to asking', async () => {
    renderCheck({saved: '60645'});
    fireEvent.click(await screen.findByRole('button', {name: /clear/i}));
    expect(await screen.findByLabelText('ZIP code')).toBeVisible();
  });

  it('keeps the answer in a polite live region and the form usable without scripts (posts to /delivery)', async () => {
    renderCheck({});
    const input = await screen.findByLabelText('ZIP code');
    const form = input.closest('form');
    expect(form).toHaveAttribute('action', '/delivery');
    expect(form).toHaveAttribute('method', 'post');
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    // The ZIP field is never prefilled into a URL: it is a POST field.
    expect(input).toHaveAttribute('name', 'zip');
  });

  it('does not log anything', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderCheck({saved: '60645'});
    await screen.findByText('In-home delivery is available to 60645.');
    expect(spy).not.toHaveBeenCalled();
  });
});
