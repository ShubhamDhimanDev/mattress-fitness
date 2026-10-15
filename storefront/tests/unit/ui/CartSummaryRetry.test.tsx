// @vitest-environment jsdom
import {cleanup, fireEvent, render, screen} from '@testing-library/react';
import {createMemoryRouter, RouterProvider} from 'react-router';
import {afterEach, describe, expect, it} from 'vitest';
import {CartSummary} from '~/components/CartSummary';
import {
  OFFERS_UNAVAILABLE_REASON,
  UNVERIFIED_REASON,
  type BlockReason,
} from '~/lib/offers-runtime/messages';
import CheckoutSteps from '~/routes/checkout-steps';

// REQ-PRE-006 / NFR-013: checkout is paused when the cart cannot be verified, and the shopper is given "Try again" at
// once because that state is usually a passing problem (review of d068db6, item E). Both places that pause checkout
// are covered: the cart summary (unverified state) and the /checkout-steps blocked state.
//
// What "Try again" does. Both buttons are links with `reloadDocument`: React Router does not intercept the click, so the
// browser loads the target URL as a new document. A document load runs the route loaders again on the server, which
// re-runs the cart check (revalidation) with nothing cached. The tests prove exactly that: the right href, and a click
// the router leaves alone (not default-prevented, no client-side navigation). A client-side link ("Back to your cart")
// is the control: the router does intercept it. They do NOT prove the server answers differently on the retry; that is
// the loader's job (tests/unit/routes/cart-routes.test.ts and the checkout gate e2e).

afterEach(cleanup);

// A violation a retry cannot fix (the shopper must change the cart), written out so this test does not depend on a factory.
const OTHER_REASON: BlockReason = {
  code: 'invalid-quantity',
  message:
    'One item in your cart has a quantity we cannot check. Remove it and add it again.',
  lineIds: ['gid://shopify/CartLine/1'],
};

/** Clicks and reports whether the click was left to the browser (a document load), without jsdom trying to navigate. */
function clickLeavesNavigationToBrowser(element: HTMLElement): boolean {
  let seenPrevented: boolean | null = null;
  // Registered on the document so it runs after React's own handler (React listens on the root container); it records
  // what React Router decided, then cancels the click so jsdom does not log "navigation not implemented".
  const observe = (event: Event) => {
    seenPrevented = event.defaultPrevented;
    event.preventDefault();
  };
  document.addEventListener('click', observe);
  fireEvent.click(element);
  document.removeEventListener('click', observe);
  return seenPrevented === false;
}

function renderSummary(blocked: readonly BlockReason[]) {
  const router = createMemoryRouter(
    [
      {
        path: '/cart',
        element: (
          <CartSummary
            cart={{lines: {nodes: []}}}
            layout="page"
            blocked={blocked}
          />
        ),
      },
    ],
    {initialEntries: ['/cart']},
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe('cart summary, checkout paused (REQ-PRE-006)', () => {
  it.each([
    ['the unverified reason', UNVERIFIED_REASON],
    ['the offers-unavailable reason', OFFERS_UNAVAILABLE_REASON],
  ])(
    'shows Try again for %s, as a link to /cart that reloads the document',
    (_name, reason) => {
      const router = renderSummary([reason]);

      expect(screen.getByRole('alert')).toHaveTextContent(
        'Checkout is on hold',
      );
      expect(screen.getByRole('alert')).toHaveTextContent(reason.message);
      const retry = screen.getByRole('link', {name: 'Try again'});
      expect(retry).toHaveAttribute('href', '/cart');
      // No Checkout button while paused: an unverified cart must not reach Shopify (ADR-0003, REQ-PRE-006).
      expect(screen.queryByRole('link', {name: 'Checkout'})).toBeNull();

      // The router leaves the click to the browser: a full document load re-runs the loaders (a refetch of the cart check).
      expect(clickLeavesNavigationToBrowser(retry)).toBe(true);
      expect(router.state.location.pathname).toBe('/cart');
      expect(router.state.navigation.state).toBe('idle');
    },
  );

  it('shows Try again when a violation sits next to the unverified reason', () => {
    renderSummary([OTHER_REASON, UNVERIFIED_REASON]);
    expect(screen.getByRole('link', {name: 'Try again'})).toBeVisible();
    expect(screen.getByText(OTHER_REASON.message)).toBeVisible();
  });

  it('does not offer Try again for a reason a retry cannot fix (a quantity the shopper must fix)', () => {
    renderSummary([OTHER_REASON]);
    expect(screen.getByRole('alert')).toHaveTextContent(OTHER_REASON.message);
    expect(screen.queryByRole('link', {name: 'Try again'})).toBeNull();
    expect(screen.queryByRole('link', {name: 'Checkout'})).toBeNull();
  });

  it('shows neither the hold message nor Try again when nothing blocks (control)', () => {
    renderSummary([]);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('link', {name: 'Try again'})).toBeNull();
  });
});

function renderCheckoutSteps(loaderData: unknown) {
  const router = createMemoryRouter(
    [
      {
        path: '/checkout-steps',
        loader: () => loaderData,
        element: <CheckoutSteps />,
      },
      {path: '/cart', element: <p>cart page</p>},
    ],
    {initialEntries: ['/checkout-steps']},
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe('/checkout-steps blocked state (REQ-PRE-006)', () => {
  it('shows Try again for an unverified cart, as a link to the gate that reloads the document', async () => {
    const router = renderCheckoutSteps({
      state: 'blocked',
      reasons: [UNVERIFIED_REASON],
      notices: [],
    });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('We can’t continue to checkout yet');
    expect(alert).toHaveTextContent(UNVERIFIED_REASON.message);
    const retry = screen.getByRole('link', {name: 'Try again'});
    expect(retry).toHaveAttribute('href', '/checkout-steps');

    expect(clickLeavesNavigationToBrowser(retry)).toBe(true);
    expect(router.state.location.pathname).toBe('/checkout-steps');
    expect(router.state.navigation.state).toBe('idle');
  });

  it('keeps "Back to your cart" as a client-side link (control: the router handles that click)', async () => {
    const router = renderCheckoutSteps({
      state: 'blocked',
      reasons: [UNVERIFIED_REASON],
      notices: [],
    });
    const back = await screen.findByRole('link', {name: 'Back to your cart'});
    expect(back).toHaveAttribute('href', '/cart');
    expect(clickLeavesNavigationToBrowser(back)).toBe(false);
    expect(await screen.findByText('cart page')).toBeVisible();
    expect(router.state.location.pathname).toBe('/cart');
  });

  it('does not offer Try again when the block is not an unverified cart', async () => {
    renderCheckoutSteps({
      state: 'blocked',
      reasons: [OTHER_REASON],
      notices: [],
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      OTHER_REASON.message,
    );
    expect(screen.queryByRole('link', {name: 'Try again'})).toBeNull();
    expect(screen.getByRole('link', {name: 'Back to your cart'})).toBeVisible();
  });
});
