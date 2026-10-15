// @vitest-environment jsdom
import {useState} from 'react';
import {cleanup, fireEvent, render, screen} from '@testing-library/react';
import {CartForm} from '@shopify/hydrogen';
import {createMemoryRouter, data, RouterProvider} from 'react-router';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {CartActionForm} from '~/components/cart/CartActionForm';
import {CartMessages} from '~/components/cart/CartMessages';
import {resetCartResultsForTests} from '~/components/cart/cart-results';

// REQ-CART-001 / review item m4: the drawer and the product buy box both show cart messages. While the drawer is open
// the buy box's copy is suppressed, so one error is one announcement (one role=alert with text), not two.

afterEach(cleanup);
beforeEach(() => resetCartResultsForTests());

const REFUSED = 'That item could not be added right now.';

function cartAction() {
  return data(
    {
      cart: null,
      errors: [{message: REFUSED}],
      warnings: [],
      offers: null,
      analytics: {cartId: undefined},
    },
    {status: 400},
  );
}

function Harness() {
  const [drawerOpen, setDrawerOpen] = useState(true);
  return (
    <div>
      <section aria-label="Drawer copy">
        <CartMessages />
      </section>
      <section aria-label="Buy box copy">
        <CartMessages suppressed={drawerOpen} />
      </section>
      <button type="button" onClick={() => setDrawerOpen((open) => !open)}>
        Toggle drawer
      </button>
      <CartActionForm
        route="/cart"
        action={CartForm.ACTIONS.LinesAdd}
        inputs={{lines: []}}
      >
        <button type="submit">Add</button>
      </CartActionForm>
    </div>
  );
}

function mount() {
  const router = createMemoryRouter(
    [
      {path: '/', Component: Harness},
      {path: '/cart', action: cartAction},
    ],
    {initialEntries: ['/']},
  );
  render(<RouterProvider router={router} />);
}

const region = (name: string) => screen.getByRole('region', {name});

describe('cart messages announce once while the drawer is open (REQ-CART-001, m4)', () => {
  it('shows an error in the drawer copy only, while the buy box copy is suppressed', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', {name: 'Add'}));
    await screen.findByText(REFUSED, {exact: false});
    expect(region('Drawer copy')).toHaveTextContent(REFUSED);
    expect(region('Buy box copy')).not.toHaveTextContent(REFUSED);
    expect(screen.getAllByText(REFUSED, {exact: false})).toHaveLength(1);
  });

  it('does not repeat an error when the drawer closes, but shows the next one in the buy box', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', {name: 'Add'}));
    await screen.findByText(REFUSED, {exact: false});
    fireEvent.click(screen.getByRole('button', {name: 'Toggle drawer'}));
    expect(region('Buy box copy')).not.toHaveTextContent(REFUSED);

    // With the drawer closed the buy box is the only place a new result can be shown in, and it is.
    fireEvent.click(screen.getByRole('button', {name: 'Add'}));
    await expect
      .poll(() => region('Buy box copy').textContent)
      .toContain(REFUSED);
  });

  it('stays in the DOM, empty, while suppressed so a later message is still announced', () => {
    mount();
    expect(
      region('Buy box copy').querySelector('[role="alert"]'),
    ).toBeEmptyDOMElement();
  });
});
