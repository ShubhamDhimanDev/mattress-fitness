// @vitest-environment jsdom
import {cleanup, render, screen, within} from '@testing-library/react';
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

    const subtotal = screen.getByText('Subtotal').closest('div');
    expect(subtotal).not.toBeNull();
    const value = subtotal?.querySelector('dd');
    expect(value).toHaveAttribute('aria-busy', 'true');
    expect(value).toHaveTextContent('Updating price');
    expect(within(subtotal as HTMLElement).queryByText('-')).toBeNull();
    // No "not available, reload" message for a cart that simply has no checkout URL yet.
    expect(
      screen.queryByText(/Checkout is not available right now/),
    ).toBeNull();
    expect(screen.getByRole('button', {name: /Checkout/})).toHaveAttribute(
      'aria-busy',
      'true',
    );
  });

  it('keeps showing the last subtotal, marked as updating, when a line changes', () => {
    renderSummary({
      lines: {nodes: []},
      isOptimistic: true,
      checkoutUrl: 'https://shop.example/checkout',
      cost: {subtotalAmount: money},
    });
    const value = screen
      .getByText('Subtotal')
      .closest('div')
      ?.querySelector('dd');
    expect(value).toHaveAttribute('aria-busy', 'true');
    expect(value).toHaveTextContent('$193.00');
  });

  it('shows the plain amount once Shopify has answered', () => {
    renderSummary({
      lines: {nodes: []},
      checkoutUrl: 'https://shop.example/checkout',
      cost: {subtotalAmount: money},
    });
    const value = screen
      .getByText('Subtotal')
      .closest('div')
      ?.querySelector('dd');
    expect(value).toHaveAttribute('aria-busy', 'false');
    expect(value).toHaveTextContent('$193.00');
    expect(screen.getByRole('link', {name: 'Checkout'})).toBeVisible();
  });
});
