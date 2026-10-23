// @vitest-environment jsdom
import {
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import {createMemoryRouter, data, RouterProvider} from 'react-router';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {DeliveryCheck} from '~/components/delivery/DeliveryCheck';
import {deliveryViewFor, type DeliveryView} from '~/lib/delivery/status';
import type {DeliveryZone} from '~/lib/delivery/zone';

afterEach(cleanup);

// The router's first loads run on a jsdom main thread that is shared with the other test files in a full run; the
// default 1 s for findBy and waitFor is too tight there (this file was flaky only under full-suite load).
configure({asyncUtilTimeout: 5000});

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
  /** Holds the first answer back until released, to look at the loading state. */
  gate?: Promise<void>;
  zone?: DeliveryZone | null;
  saved?: string | null;
  /** Replaces the computed answer, for states the zone cannot produce (the deployment cannot keep a ZIP). */
  view?: DeliveryView;
}) {
  let saved = options.saved ?? null;
  const zone = options.zone === undefined ? ZONE : options.zone;
  const submissions: string[] = [];
  const otherLoader = vi.fn(() => null);
  const router = createMemoryRouter(
    [
      {
        path: '/products/x',
        loader: otherLoader,
        element: <DeliveryCheck />,
      },
      {
        path: '/delivery',
        loader: async () => {
          await options.gate;
          return data({
            delivery: options.view ?? deliveryViewFor(zone, saved),
            error: null,
          });
        },
        action: async ({request}) => {
          const form = await request.formData();
          submissions.push(String(form.get('zip') ?? form.get('intent')));
          saved =
            form.get('intent') === 'clear' ? null : String(form.get('zip'));
          return data({
            delivery: options.view ?? deliveryViewFor(zone, saved),
            error: null,
          });
        },
      },
    ],
    {initialEntries: ['/products/x']},
  );
  render(<RouterProvider router={router} />);
  return {submissions, otherLoader, router};
}

describe('DeliveryCheck', () => {
  it('asks for a ZIP when none is saved, with a labelled field', async () => {
    renderCheck({});
    expect(await screen.findByLabelText('ZIP code')).toBeInTheDocument();
    expect(
      screen.getByText(/Enter your ZIP code to see delivery options/i),
    ).toBeInTheDocument();
  });

  it('holds its space with a busy placeholder until the first answer, then shows the form', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    renderCheck({gate});
    expect(
      await screen.findByRole('region', {name: 'Delivery'}),
    ).toHaveAttribute('aria-busy', 'true');
    release();
    expect(await screen.findByLabelText('ZIP code')).toBeInTheDocument();
    expect(screen.getByRole('region', {name: 'Delivery'})).not.toHaveAttribute(
      'aria-busy',
    );
  });

  it('saving a ZIP does not re-run the page loaders', async () => {
    const {otherLoader, router} = renderCheck({});
    const input = await screen.findByLabelText('ZIP code');
    // The baseline is taken only once the router has finished its own first load, so a slow start cannot add a call
    // between the baseline and the check.
    await waitFor(() => {
      expect(router.state.initialized).toBe(true);
      expect(router.state.navigation.state).toBe('idle');
    });
    fireEvent.change(input, {target: {value: '60645'}});
    const callsBefore = otherLoader.mock.calls.length;
    fireEvent.click(screen.getByRole('button', {name: /check delivery/i}));
    await screen.findByText('In-home delivery is available to 60645.');
    // A revalidation would start after the answer is shown: wait for the router to be quiet before counting.
    await waitFor(() => {
      expect(router.state.revalidation).toBe('idle');
      expect(router.state.navigation.state).toBe('idle');
    });
    expect(otherLoader.mock.calls.length).toBe(callsBefore);
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

  it('shows a plain unavailable state, with no form and no yes or no, when the deployment cannot keep a ZIP (P3B-11)', async () => {
    const view = renderCheck({
      saved: '60645',
      view: {status: 'service-unavailable'},
    });
    expect(
      await screen.findByText(
        'Delivery information is not available right now.',
      ),
    ).toBeVisible();
    // Unlike "no zone configured", this is visible on the product page and the cart too.
    expect(screen.getByRole('region', {name: 'Delivery'})).toBeVisible();
    expect(screen.queryByLabelText('ZIP code')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText(/available to|not available to/i)).toBeNull();
    expect(screen.queryByText('White-glove delivery.')).toBeNull();
    expect(view.submissions).toEqual([]);
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
