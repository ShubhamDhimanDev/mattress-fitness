// @vitest-environment jsdom
import {cleanup, fireEvent, render, screen} from '@testing-library/react';
import {CartForm} from '@shopify/hydrogen';
import {createMemoryRouter, data, RouterProvider} from 'react-router';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {CartActionForm} from '~/components/cart/CartActionForm';
import {resetCartResultsForTests} from '~/components/cart/cart-results';
import {useCartOffers} from '~/components/cart/useCartOffers';
import {OFFERS_UNAVAILABLE_REASON} from '~/lib/offers-runtime/messages';
import {unverifiedView} from '~/lib/offers-runtime/view';

// REQ-CART-003 / REQ-CART-004 / B-20 follow-up: the cart drawer's offers view arrives in the answer of a cart action.
// React Router removes a mounted fetcher that went idle from `useFetchers()` before the render that could read it, so a
// hook that reads `useFetchers().data` sees the view only while the request is still reloading and then loses it (and
// asks `/cart` again). The view has to come from the results the submitting forms report. These tests drive the real
// data router and the real cart form.

afterEach(cleanup);
beforeEach(() => resetCartResultsForTests());

const CART_VERSION = '2026-10-14T10:00:00Z';
const VIEW_TEXT = 'View from the action answer';
const LOADER_TEXT = 'View from the cart loader';

const viewFor = (message: string, updatedAt = CART_VERSION) =>
  unverifiedView(updatedAt, {...OFFERS_UNAVAILABLE_REASON, message});

function cartResult(extra: Record<string, unknown>, status = 200) {
  return data(
    {
      cart: null,
      errors: [],
      warnings: [],
      offers: null,
      analytics: {cartId: undefined},
      ...extra,
    },
    {status},
  );
}

async function cartAction({request}: {request: Request}) {
  const form = await request.formData();
  const raw = form.get(CartForm.INPUT_NAME);
  // The refused post answers without a view, like the route's `rejected()`.
  if (typeof raw === 'string' && raw.includes('Refuse')) {
    return cartResult({errors: [{message: 'Refused'}]}, 400);
  }
  return cartResult({offers: viewFor(VIEW_TEXT)});
}

function Probe({active = false}: {active?: boolean}) {
  const view = useCartOffers({
    cartUpdatedAt: CART_VERSION,
    provided: null,
    active,
  });
  return <p>{view ? `view: ${view.blocked[0]?.message}` : 'view: none'}</p>;
}

function Harness({active}: {active?: boolean}) {
  return (
    <div>
      <Probe active={active} />
      <CartActionForm
        route="/cart"
        action={CartForm.ACTIONS.LinesUpdate}
        inputs={{lines: []}}
      >
        {(fetcher) => (
          <>
            <button type="submit">Change cart</button>
            <p>form: {fetcher.state}</p>
          </>
        )}
      </CartActionForm>
      <CartActionForm
        route="/cart"
        action={CartForm.ACTIONS.LinesRemove}
        inputs={{lineIds: ['Refuse']}}
      >
        <button type="submit">Refused change</button>
      </CartActionForm>
    </div>
  );
}

function mount(active = false) {
  const router = createMemoryRouter(
    [
      {path: '/', element: <Harness active={active} />},
      {
        path: '/cart',
        action: cartAction,
        loader: () => {
          return {cart: null, offers: viewFor(LOADER_TEXT)};
        },
      },
    ],
    {initialEntries: ['/']},
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe('useCartOffers reads the view from reported cart results (REQ-CART-003, B-20)', () => {
  it('shows nothing before any cart action and no view was provided', () => {
    mount();
    expect(screen.getByText('view: none')).toBeInTheDocument();
  });

  it('keeps the view of a cart action after its form went idle again', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', {name: 'Change cart'}));
    await screen.findByText(`view: ${VIEW_TEXT}`);
    // The router has finished with the form; `useFetchers()` no longer lists it.
    await screen.findByText('form: idle');
    expect(screen.getByText(`view: ${VIEW_TEXT}`)).toBeInTheDocument();
  });

  it('after the drawer loaded /cart, the view a cart action answered with replaces it and stays', async () => {
    mount(true);
    // The drawer is open and has no view yet, so it loads /cart.
    await screen.findByText(`view: ${LOADER_TEXT}`);
    fireEvent.click(screen.getByRole('button', {name: 'Change cart'}));
    await screen.findByText(`view: ${VIEW_TEXT}`);
    await screen.findByText('form: idle');
    expect(screen.getByText(`view: ${VIEW_TEXT}`)).toBeInTheDocument();
  });

  it('a refused action (no view in the answer) does not erase the view already known', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', {name: 'Change cart'}));
    await screen.findByText(`view: ${VIEW_TEXT}`);
    fireEvent.click(screen.getByRole('button', {name: 'Refused change'}));
    // Give the refused answer time to be reported: wait for the form to settle, then check.
    await screen.findByText('form: idle');
    await expect
      .poll(() => screen.queryByText(`view: ${VIEW_TEXT}`) !== null)
      .toBe(true);
  });
});
