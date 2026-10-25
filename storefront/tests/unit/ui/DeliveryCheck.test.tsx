// @vitest-environment jsdom
import {
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import {
  createMemoryRouter,
  data,
  RouterProvider,
  useFetcher,
} from 'react-router';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {DeliveryCheck} from '~/components/delivery/DeliveryCheck';
import {DELIVERY_FETCHER_KEY} from '~/components/delivery/useDeliveryZip';
import type {DeliveryResponse} from '~/lib/delivery-runtime/response';
import {resetZipChangeForTests} from '~/lib/delivery-runtime/zip-change';
import {deliveryViewFor, type DeliveryView} from '~/lib/delivery/status';
import type {DeliveryZone} from '~/lib/delivery/zone';

afterEach(() => {
  cleanup();
  // Saving a ZIP records a change in a module-level store; nothing here reads it, but a test must not leave it behind.
  resetZipChangeForTests();
});

// The router's first loads run on a jsdom main thread that is shared with the other test files in a full run; the
// default 1 s for findBy and waitFor is too tight there (this file was flaky only under full-suite load).
configure({asyncUtilTimeout: 5000});
// A multi-step test waits on several of those, and Vitest's own default of 5000 ms would end the test before one
// wait gives up, hiding which step stalled. Give each test room for three of them.
vi.setConfig({testTimeout: 15000});

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
  /** Holds the save's answer back until released, to look at the busy state. */
  actionGate?: Promise<void>;
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
          await options.actionGate;
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

  it('shows a busy button while its own save is on its way, and answers when it arrives', async () => {
    let release: () => void = () => {};
    const actionGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    renderCheck({actionGate});
    fireEvent.change(await screen.findByLabelText('ZIP code'), {
      target: {value: '60645'},
    });
    fireEvent.click(screen.getByRole('button', {name: /check delivery/i}));
    expect(
      await screen.findByRole('button', {name: /checking/i}),
    ).toHaveAttribute('aria-busy', 'true');
    release();
    expect(
      await screen.findByText('In-home delivery is available to 60645.'),
    ).toBeVisible();
  });
});

// Regression for the flaky tests of this file (invalid ZIP, clears the saved ZIP, says yes): the first answer is a
// GET load on the shared fetcher, and the answer can be on screen while the fetcher still reads "loading" (React
// Router's data map is ahead of the router state it renders). The old hook counted that as pending, the buttons were
// inert, and a click right after the form appeared was swallowed. This test holds the fetcher in "loading" on purpose
// and clicks: it fails deterministically against the old behaviour and does not depend on timing.
describe('DeliveryCheck while the shared fetcher is loading (P3B-11)', () => {
  const SEED: DeliveryResponse = {delivery: {status: 'no-zip'}, error: null};

  function LoadButton() {
    const fetcher = useFetcher({key: DELIVERY_FETCHER_KEY});
    return (
      <button type="button" onClick={() => void fetcher.load('/delivery')}>
        Start load
      </button>
    );
  }

  function mountLoading() {
    const loads: string[] = [];
    const router = createMemoryRouter(
      [
        {
          path: '/products/x',
          element: (
            <>
              <LoadButton />
              <DeliveryCheck initial={SEED} />
            </>
          ),
        },
        {
          path: '/delivery',
          // Never answers: the fetcher stays in "loading" for the whole test.
          loader: () => {
            loads.push('load');
            return new Promise(() => {});
          },
          action: () => data({delivery: SEED.delivery, error: null}),
        },
      ],
      {initialEntries: ['/products/x']},
    );
    render(<RouterProvider router={router} />);
    return {loads, router};
  }

  it('does not mark the buttons busy, so a click on the visible form is not swallowed', async () => {
    const {loads, router} = mountLoading();
    fireEvent.click(await screen.findByRole('button', {name: 'Start load'}));
    await waitFor(() => {
      expect(loads).toHaveLength(1);
      expect(router.state.fetchers.get(DELIVERY_FETCHER_KEY)?.state).toBe(
        'loading',
      );
    });

    const submit = await screen.findByRole('button', {name: /check delivery/i});
    expect(submit).not.toHaveAttribute('aria-busy');
    fireEvent.change(screen.getByLabelText('ZIP code'), {
      target: {value: '12'},
    });
    fireEvent.click(submit);
    expect(
      await screen.findByText('Enter a 5-digit US ZIP code.'),
    ).toBeVisible();
  });
});
