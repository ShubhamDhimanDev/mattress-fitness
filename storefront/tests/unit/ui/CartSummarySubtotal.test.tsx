// @vitest-environment jsdom
import {act, cleanup, render, screen, within} from '@testing-library/react';
import {useState} from 'react';
import {createMemoryRouter, RouterProvider} from 'react-router';
import {afterEach, describe, expect, it} from 'vitest';
import {CartSummary} from '~/components/CartSummary';
import {subtotalView} from '~/lib/cart/subtotal';

// RS-02: after the first "Add to cart" the drawer listed the line while the subtotal read "-" for about a second.
// Cause: Hydrogen's useOptimisticCart adds the line but never touches `cost`, so a cart that did not exist yet has no
// subtotal until Shopify answers. The browser must not estimate a price (ADR-0003), so the summary shows a busy
// placeholder there, and keeps Shopify's last amount (marked as updating) when it has one.

afterEach(cleanup);

const money = {amount: '193.0', currencyCode: 'USD'} as const;

describe('subtotalView (RS-02)', () => {
  it.each([
    ['no cart', null],
    ['a cart without cost', {}],
    ['a first optimistic add (lines only, no cost)', {isOptimistic: true}],
    ['cost without a subtotal', {cost: {}}],
    [
      'a subtotal with no amount',
      {cost: {subtotalAmount: {currencyCode: 'USD'}}},
    ],
    [
      'a subtotal with an empty amount',
      {cost: {subtotalAmount: {amount: '', currencyCode: 'USD'}}},
    ],
    ['a subtotal with no currency', {cost: {subtotalAmount: {amount: '1.0'}}}],
  ])('is pending for %s, never a value', (_name, cart) => {
    expect(subtotalView(cart)).toEqual({status: 'pending'});
  });

  it('is ready and settled for Shopify answer', () => {
    expect(subtotalView({cost: {subtotalAmount: money}})).toEqual({
      status: 'ready',
      amount: money,
      updating: false,
    });
  });

  it('keeps the last answer, flagged as updating, while a change is in flight', () => {
    expect(
      subtotalView({isOptimistic: true, cost: {subtotalAmount: money}}),
    ).toEqual({status: 'ready', amount: money, updating: true});
  });
});

function renderSummary(cart: Parameters<typeof CartSummary>[0]['cart']) {
  const router = createMemoryRouter(
    [
      {
        path: '/cart',
        element: <CartSummary cart={cart} layout="aside" />,
      },
    ],
    {initialEntries: ['/cart']},
  );
  render(<RouterProvider router={router} />);
}

describe('cart summary while the cart is being updated (RS-02)', () => {
  it('shows a busy placeholder, not "-", and a busy Checkout button on the first add', () => {
    renderSummary({lines: {nodes: []}, isOptimistic: true});

    const subtotal = screen.getByText('Estimated total').closest('div');
    expect(subtotal).not.toBeNull();
    const value = subtotal?.querySelector('dd');
    // The announcement is a live region (role="status"); aria-busy on the <dd> would not be announced (m5).
    expect(value).not.toHaveAttribute('aria-busy');
    expect(within(value as HTMLElement).getByRole('status')).toHaveTextContent(
      'Updating price',
    );
    expect(value).toHaveTextContent('Updating price');
    expect(within(subtotal as HTMLElement).queryByText('-')).toBeNull();
    // No "not available, reload" message for a cart that simply has no checkout URL yet.
    expect(
      screen.queryByText(/Checkout is not available right now/),
    ).toBeNull();
    // The busy control is already the Checkout link (inert), so it can keep keyboard focus (m5).
    const checkout = screen.getByRole('link', {name: /Checkout/});
    expect(checkout).toHaveAttribute('aria-busy', 'true');
    expect(checkout).toHaveAttribute('aria-disabled', 'true');
  });

  it('keeps showing the last subtotal, marked as updating, when a line changes', () => {
    renderSummary({
      lines: {nodes: []},
      isOptimistic: true,
      checkoutUrl: 'https://shop.example/checkout',
      cost: {totalAmount: money},
    });
    const value = screen
      .getByText('Estimated total')
      .closest('div')
      ?.querySelector('dd');
    expect(value).not.toHaveAttribute('aria-busy');
    expect(value).toHaveTextContent('$193.00');
    expect(within(value as HTMLElement).getByRole('status')).toHaveTextContent(
      'Updating price',
    );
    // Stale cue is italic, not dimmed text (dimming drops the contrast below 4.5:1, n3).
    expect(value?.querySelector('.italic')).not.toBeNull();
    expect(value?.querySelector('[class*="opacity"]')).toBeNull();
  });

  it('shows the plain amount once Shopify has answered', () => {
    renderSummary({
      lines: {nodes: []},
      checkoutUrl: 'https://shop.example/checkout',
      cost: {totalAmount: money},
    });
    const value = screen
      .getByText('Estimated total')
      .closest('div')
      ?.querySelector('dd');
    expect(value).not.toHaveAttribute('aria-busy');
    expect(value).toHaveTextContent('$193.00');
    // The live region stays mounted but empty, so the next change is announced.
    expect(
      within(value as HTMLElement).getByRole('status'),
    ).toBeEmptyDOMElement();
    expect(value?.querySelector('.italic')).toBeNull();
    expect(screen.getByRole('link', {name: 'Checkout securely'})).toBeVisible();
  });
});

describe('Checkout keeps keyboard focus when the checkout URL arrives (m5)', () => {
  type Cart = Parameters<typeof CartSummary>[0]['cart'];
  const busy: Cart = {lines: {nodes: []}, isOptimistic: true};
  const ready: Cart = {
    lines: {nodes: []},
    checkoutUrl: 'https://shop.example/checkout',
    cost: {totalAmount: money},
  };

  it('is the same element before and after, and focus stays on it', () => {
    let settle: () => void = () => undefined;
    function Harness() {
      const [cart, setCart] = useState<Cart>(busy);
      settle = () => setCart(ready);
      return <CartSummary cart={cart} layout="aside" />;
    }
    const router = createMemoryRouter([{path: '/cart', element: <Harness />}], {
      initialEntries: ['/cart'],
    });
    render(<RouterProvider router={router} />);
    const before = screen.getByRole('link', {name: /Checkout/});
    before.focus();
    expect(document.activeElement).toBe(before);

    act(() => settle());

    const after = screen.getByRole('link', {name: 'Checkout securely'});
    expect(after).toBe(before);
    expect(document.activeElement).toBe(after);
    expect(after).not.toHaveAttribute('aria-busy');
    expect(after).not.toHaveAttribute('aria-disabled');
  });
});
