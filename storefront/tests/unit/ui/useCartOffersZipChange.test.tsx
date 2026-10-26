// @vitest-environment jsdom
import {
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import {CartForm} from '~/lib/hydrogen/cart-form';
import {createMemoryRouter, data, RouterProvider} from 'react-router';
import {useState} from 'react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {CartActionForm} from '~/components/cart/CartActionForm';
import {resetCartResultsForTests} from '~/components/cart/cart-results';
import {useCartOffers} from '~/components/cart/useCartOffers';
import {useDeliveryZip} from '~/components/delivery/useDeliveryZip';
import {
  markZipChanged,
  resetZipChangeForTests,
} from '~/lib/delivery-runtime/zip-change';
import {
  describeViolation,
  OFFERS_UNAVAILABLE_REASON,
} from '~/lib/offers-runtime/messages';
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
// Each test waits on several router round trips; keep Vitest's 5000 ms default from ending it before one wait gives up.
vi.setConfig({testTimeout: 15000});

const CART_VERSION = '2026-10-14T10:00:00Z';
const PAGE_TEXT = 'View from the page loader';
const ACTION_TEXT = 'View from the action answer';
const FRESH_PAGE_TEXT = 'View from a later page load';

const viewFor = (message: string) =>
  unverifiedView(CART_VERSION, {...OFFERS_UNAVAILABLE_REASON, message});

function Probe({
  active,
  provided,
}: {
  active: boolean;
  provided: ReturnType<typeof viewFor> | null;
}) {
  // The page loader's view, replaceable like a navigation or a revalidation would replace it.
  const [page, setPage] = useState(provided);
  const view = useCartOffers({
    cartUpdatedAt: CART_VERSION,
    provided: page,
    active,
  });
  const {save, clear} = useDeliveryZip();
  return (
    <div>
      <p>{view ? `view: ${view.blocked[0]?.message}` : 'view: none'}</p>
      <button type="button" onClick={() => setPage(viewFor(FRESH_PAGE_TEXT))}>
        New page view
      </button>
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

function mount(options: {
  active: boolean;
  provided?: boolean;
  /** Holds the cart action's answer back until released. */
  cartActionGate?: Promise<void>;
  /** The view the /cart loader answers with on its nth call. */
  loaderView?: (call: number) => ReturnType<typeof viewFor>;
}) {
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
          return {
            cart: null,
            offers:
              options.loaderView?.(calls.cart) ??
              viewFor(`Cart view ${calls.cart}`),
          };
        },
        action: async () => {
          await options.cartActionGate;
          return data({
            cart: null,
            errors: [],
            warnings: [],
            offers: viewFor(ACTION_TEXT),
            analytics: {cartId: undefined},
          });
        },
      },
      {
        path: '/delivery',
        loader: () => ({delivery: {status: 'no-zip'}, error: null}),
        action: async ({request}) => {
          calls.zipPosts += 1;
          const form = await request.formData();
          if (form.get('intent') === 'clear') {
            return data({delivery: {status: 'no-zip'}, error: null});
          }
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

  it('uses a page view loaded after the change at once, with no extra fetch (a later navigation or revalidation)', async () => {
    const calls = mount({active: true, provided: true});
    fireEvent.click(screen.getByRole('button', {name: 'Save ZIP'}));
    await screen.findByText('view: Cart view 1');

    fireEvent.click(screen.getByRole('button', {name: 'New page view'}));
    await screen.findByText(`view: ${FRESH_PAGE_TEXT}`);
    expect(calls.cart).toBe(1);
  });

  it('a cart page opened after a change uses its own loader view and fetches nothing', async () => {
    markZipChanged(0);
    const calls = mount({active: true, provided: true});
    expect(screen.getByText(`view: ${PAGE_TEXT}`)).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(calls.cart).toBe(0);
    expect(screen.getByText(`view: ${PAGE_TEXT}`)).toBeInTheDocument();
  });

  it('saving the ZIP that is already saved is not a change and refreshes nothing', async () => {
    const calls = mount({active: true});
    await screen.findByText('view: Cart view 1');
    fireEvent.click(screen.getByRole('button', {name: 'Save ZIP'}));
    await screen.findByText('view: Cart view 2');

    fireEvent.click(screen.getByRole('button', {name: 'Save ZIP'}));
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(calls.zipPosts).toBe(2);
    expect(calls.cart).toBe(2);
    expect(screen.getByText('view: Cart view 2')).toBeInTheDocument();
  });

  it('clearing when no ZIP is saved is not a change either', async () => {
    const calls = mount({active: true});
    await screen.findByText('view: Cart view 1');
    fireEvent.click(screen.getByRole('button', {name: 'Clear ZIP'}));
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(calls.zipPosts).toBe(1);
    expect(calls.cart).toBe(1);
  });

  // The recorded window (see useCartOffers): results are stamped when reported, not when posted, so an answer to a
  // post sent before the ZIP answer was handled is used if it arrives after it. The server may have read the old
  // cookie for it; the /cart load that React Router re-runs after every cart action is what corrects it.
  it('documents the window: a cart answer that arrives after the change is used even if it was posted before it', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mount({active: true, cartActionGate: gate});
    await screen.findByText('view: Cart view 1');

    fireEvent.click(screen.getByRole('button', {name: 'Change cart'}));
    fireEvent.click(screen.getByRole('button', {name: 'Save ZIP'}));
    await screen.findByText('view: Cart view 2');

    release();
    await screen.findByText(`view: ${ACTION_TEXT}`);
  });

  // The ZIP never edits cart lines: an out-of-zone haul-away is a violation that blocks checkout with the line named
  // (ARCHITECTURE section 5), so the hook only has to surface the new block; the lines come from the root cart.
  it('surfaces a haul-away block that the new ZIP causes, from the fetched view alone', async () => {
    const outside = describeViolation({
      code: 'haul-away-not-eligible',
      reason: 'outside-zone',
      lineIds: ['gid://shopify/CartLine/haul'],
    });
    mount({
      active: true,
      provided: true,
      loaderView: () => ({...viewFor(''), blocked: [outside]}),
    });
    expect(screen.getByText(`view: ${PAGE_TEXT}`)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: 'Save ZIP'}));
    await screen.findByText(`view: ${outside.message}`);
    expect(screen.queryByText(`view: ${PAGE_TEXT}`)).toBeNull();
  });
});
