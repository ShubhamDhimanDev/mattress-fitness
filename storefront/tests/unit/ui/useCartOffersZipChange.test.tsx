// @vitest-environment jsdom
import {
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import {CartForm} from '@shopify/hydrogen';
import {createMemoryRouter, data, RouterProvider} from 'react-router';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {CartActionForm} from '~/components/cart/CartActionForm';
import {resetCartResultsForTests} from '~/components/cart/cart-results';
import {useCartOffers} from '~/components/cart/useCartOffers';
import {useDeliveryZip} from '~/components/delivery/useDeliveryZip';
import {resetZipChangeForTests} from '~/lib/delivery-runtime/zip-change';
import {OFFERS_UNAVAILABLE_REASON} from '~/lib/offers-runtime/messages';
import {unverifiedView} from '~/lib/offers-runtime/view';

// P3B-11 (b), REQ-CART-003, REQ-CART-004: the offers view (haul-away eligibility, the free-delivery message) is
// computed on the server from the signed ZIP cookie, but cached in the browser per cart version. After a ZIP
// change the page and the drawer must drop what predates it and ask /cart again, without a reload. These tests
// drive the real data router, the real ZIP hook and the real cart form against in-memory routes.

afterEach(cleanup);
beforeEach(() => {
  resetCartResultsForTests();
  resetZipChangeForTests();
});
configure({asyncUtilTimeout: 5000});

const CART_VERSION = '2026-10-14T10:00:00Z';
const PAGE_TEXT = 'View from the page loader';
const ACTION_TEXT = 'View from the action answer';

const viewFor = (message: string) =>
  unverifiedView(CART_VERSION, {...OFFERS_UNAVAILABLE_REASON, message});

function Probe({
  active,
  provided,
}: {
  active: boolean;
  provided: ReturnType<typeof viewFor> | null;
}) {
  const view = useCartOffers({cartUpdatedAt: CART_VERSION, provided, active});
  const {save, clear} = useDeliveryZip();
  return (
    <div>
      <p>{view ? `view: ${view.blocked[0]?.message}` : 'view: none'}</p>
      <button type="button" onClick={() => void save('60645')}>
        Save ZIP
      </button>
      <button type="button" onClick={() => void save('bad')}>
        Save bad ZIP
      </button>
      <button type="button" onClick={() => void clear()}>
        Clear ZIP
      </button>
      <CartActionForm
        route="/cart"
        action={CartForm.ACTIONS.LinesUpdate}
        inputs={{lines: []}}
      >
        <button type="submit">Change cart</button>
      </CartActionForm>
    </div>
  );
}

function mount(options: {active: boolean; provided?: boolean}) {
  const calls = {cart: 0, zipPosts: 0};
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: (
          <Probe
            active={options.active}
            provided={options.provided ? viewFor(PAGE_TEXT) : null}
          />
        ),
      },
      {
        path: '/cart',
        // Each load answers with a new text, as the server would after reading a different cookie.
        loader: () => {
          calls.cart += 1;
          return {cart: null, offers: viewFor(`Cart view ${calls.cart}`)};
        },
        action: () =>
          data({
            cart: null,
            errors: [],
            warnings: [],
            offers: viewFor(ACTION_TEXT),
            analytics: {cartId: undefined},
          }),
      },
      {
        path: '/delivery',
        loader: () => ({delivery: {status: 'no-zip'}, error: null}),
        action: async ({request}) => {
          calls.zipPosts += 1;
          const form = await request.formData();
          if (form.get('zip') === 'bad') {
            return data(
              {delivery: {status: 'no-zip'}, error: 'invalid-zip'},
              {status: 400},
            );
          }
          return data({
            delivery: {status: 'in-zone', zip: '60645', promise: null},
            error: null,
          });
        },
      },
    ],
    {initialEntries: ['/']},
  );
  render(<RouterProvider router={router} />);
  return calls;
}

describe('the offers view follows a ZIP change (P3B-11, REQ-CART-003, REQ-CART-004)', () => {
  it('on the cart page, drops the page loader view and shows the one fetched after the change', async () => {
    const calls = mount({active: true, provided: true});
    expect(screen.getByText(`view: ${PAGE_TEXT}`)).toBeInTheDocument();
    // Nothing is fetched while the loader's view is current.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls.cart).toBe(0);

    fireEvent.click(screen.getByRole('button', {name: 'Save ZIP'}));
    await screen.findByText('view: Cart view 1');
    expect(screen.queryByText(`view: ${PAGE_TEXT}`)).toBeNull();
    expect(calls.cart).toBe(1);
  });

  it('in the drawer, loads once, then loads again after each change', async () => {
    const calls = mount({active: true});
    await screen.findByText('view: Cart view 1');

    fireEvent.click(screen.getByRole('button', {name: 'Save ZIP'}));
    await screen.findByText('view: Cart view 2');

    fireEvent.click(screen.getByRole('button', {name: 'Clear ZIP'}));
    await screen.findByText('view: Cart view 3');
    expect(calls.cart).toBe(3);
  });

  it('drops a view a cart action answered with before the change', async () => {
    mount({active: true});
    await screen.findByText('view: Cart view 1');
    fireEvent.click(screen.getByRole('button', {name: 'Change cart'}));
    await screen.findByText(`view: ${ACTION_TEXT}`);

    fireEvent.click(screen.getByRole('button', {name: 'Save ZIP'}));
    // The cart action also made React Router re-run the drawer's earlier /cart load, so the number is not fixed.
    await screen.findByText(/^view: Cart view \d+$/);
    expect(screen.queryByText(`view: ${ACTION_TEXT}`)).toBeNull();
  });

  it('uses a view a cart action answers with after the change', async () => {
    mount({active: true});
    await screen.findByText('view: Cart view 1');
    fireEvent.click(screen.getByRole('button', {name: 'Save ZIP'}));
    await screen.findByText('view: Cart view 2');

    fireEvent.click(screen.getByRole('button', {name: 'Change cart'}));
    await screen.findByText(`view: ${ACTION_TEXT}`);
  });

  it('does nothing when the server refused the change (the cookie is as it was)', async () => {
    const calls = mount({active: true});
    await screen.findByText('view: Cart view 1');

    fireEvent.click(screen.getByRole('button', {name: 'Save bad ZIP'}));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(calls.zipPosts).toBe(1);
    expect(calls.cart).toBe(1);
    expect(screen.getByText('view: Cart view 1')).toBeInTheDocument();
  });

  it('fetches nothing for a closed drawer, and loads when it opens after a change', async () => {
    const calls = mount({active: false});
    fireEvent.click(screen.getByRole('button', {name: 'Save ZIP'}));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(calls.cart).toBe(0);
    expect(screen.getByText('view: none')).toBeInTheDocument();
  });
});
