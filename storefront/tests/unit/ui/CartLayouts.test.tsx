// @vitest-environment jsdom
import {cleanup, render, screen, within} from '@testing-library/react';
import {createMemoryRouter, RouterProvider} from 'react-router';
import {afterEach, describe, expect, it} from 'vitest';
import {Aside} from '~/components/Aside';
import {CartLineItem, type CartLine} from '~/components/CartLineItem';
import {CartCheckoutBar, CartSummary} from '~/components/CartSummary';
import {resetCartResultsForTests} from '~/components/cart/cart-results';
import type {LineItemChildrenMap} from '~/components/CartMain';
import type {ProtectionLineView} from '~/lib/offers-runtime/view';

// CR-31 cart redesign. REQ-CART-001 (lines, remove), REQ-EXT-002 / REQ-PRE-004 (protection sits inside the card of the item it
// covers and has no controls of its own beyond Remove), REQ-PROMO-001 (free gift card), REQ-CART-004 (delivery row), REQ-CHK-001.

afterEach(() => {
  cleanup();
  resetCartResultsForTests();
});

const usd = (amount: string) => ({amount, currencyCode: 'USD' as const});

function line(overrides: Record<string, unknown> = {}): CartLine {
  return {
    id: 'gid://shopify/CartLine/1',
    quantity: 1,
    attributes: [],
    cost: {
      totalAmount: usd('1999.0'),
      subtotalAmount: usd('1999.0'),
      amountPerQuantity: usd('1999.0'),
      compareAtAmountPerQuantity: null,
    },
    discountAllocations: [],
    merchandise: {
      id: 'gid://shopify/ProductVariant/1',
      availableForSale: true,
      compareAtPrice: null,
      price: usd('1999.0'),
      requiresShipping: true,
      title: 'Queen',
      sku: null,
      image: null,
      product: {
        handle: 'cloud',
        title: 'Cloud mattress',
        id: 'gid://shopify/Product/1',
        vendor: 'Tempur-Pedic',
      },
      selectedOptions: [{name: 'Size', value: 'Queen'}],
    },
    ...overrides,
  } as unknown as CartLine;
}

const COVERAGE = line({
  id: 'gid://shopify/CartLine/2',
  attributes: [
    {key: '_extend_plan_id', value: 'MOCK-PLAN'},
    {key: '_extend_term', value: '36'},
  ],
  cost: {totalAmount: usd('129.0')},
  merchandise: {
    ...line().merchandise,
    id: 'gid://shopify/ProductVariant/2',
    price: usd('129.0'),
    product: {
      handle: 'protection',
      title: 'Accident protection',
      id: 'gid://shopify/Product/2',
      vendor: 'Extend',
    },
  },
});

const OFFER: ProtectionLineView = {
  lineId: 'gid://shopify/CartLine/1',
  productTitle: 'Cloud mattress',
  variantTitle: 'Queen',
  quantity: 1,
  uncoveredQuantity: 1,
  plans: [
    {
      planId: 'MOCK-PLAN',
      title: 'Accident plan 3 years',
      priceCents: 12900,
      termMonths: 36,
      termsUrl: 'https://example.com/terms',
      recommended: true,
    },
  ],
};

function mountLine(
  target: CartLine,
  options: {
    layout?: 'page' | 'aside';
    children?: LineItemChildrenMap;
    protection?: Record<string, ProtectionLineView>;
  } = {},
) {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: (
          <Aside.Provider>
            <ul>
              <CartLineItem
                line={target}
                layout={options.layout ?? 'page'}
                childrenMap={options.children ?? {}}
                protection={options.protection}
                onRemove={() => undefined}
              />
            </ul>
          </Aside.Provider>
        ),
      },
    ],
    {initialEntries: ['/']},
  );
  render(<RouterProvider router={router} />);
}

describe('page line card (REQ-CART-001)', () => {
  it('shows brand, name link, total, stepper and a Remove button with the old accessible name', () => {
    mountLine(line());
    const card = screen.getByRole('listitem');
    expect(within(card).getByText('Tempur-Pedic')).toBeVisible();
    expect(
      within(card).getByRole('link', {name: 'Cloud mattress'}),
    ).toHaveAttribute('href', '/products/cloud');
    expect(card).toHaveTextContent('$1,999.00');
    expect(
      within(card).getByRole('textbox', {name: /^Quantity of Cloud mattress/}),
    ).toHaveValue('1');
    expect(
      within(card).getByRole('button', {
        name: 'Remove Cloud mattress from cart',
      }),
    ).toBeEnabled();
  });

  it('shows the Shopify per-unit price and no delivery chip until a method is answered', () => {
    mountLine(line());
    expect(screen.getByRole('listitem')).toHaveTextContent('$1,999.00 each');
    expect(screen.queryByText('Home delivery')).toBeNull();
  });

  it('marks an updating line busy and disables its remove button', () => {
    mountLine(line({isOptimistic: true}));
    expect(screen.getByRole('listitem')).toHaveAttribute('aria-busy', 'true');
    expect(
      screen.getByRole('button', {name: 'Remove Cloud mattress from cart'}),
    ).toBeDisabled();
  });
});

describe('protection plan inside the covered card (REQ-EXT-002, REQ-PRE-004)', () => {
  const parentId = 'gid://shopify/CartLine/1';

  it('draws a covered plan in the same list item as its item, with only a Remove control', () => {
    mountLine(line(), {children: {[parentId]: [COVERAGE]}});
    const card = screen.getByRole('listitem');
    expect(card).toHaveTextContent('Protection plan added');
    expect(card).toHaveTextContent('Covers this item only');
    expect(card).toHaveTextContent('3 years of coverage');
    expect(card).toHaveTextContent('$129.00');
    // The plan is not a line of its own: one list item, one quantity stepper (the plan follows its item's quantity).
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(
      within(card).getByRole('button', {
        name: 'Remove Accident protection from cart',
      }),
    ).toBeVisible();
  });

  it('offers a plan on the card of the item it would cover, naming terms and branding', () => {
    mountLine(line(), {protection: {[parentId]: OFFER}});
    // The quoted plans are a list inside the card, so the card is the first (outermost) list item.
    const [card] = screen.getAllByRole('listitem');
    if (!card) throw new Error('the line card did not render');
    expect(card).toHaveTextContent('Protect this item');
    expect(
      within(card).getByRole('button', {
        name: 'Add Accident plan 3 years protection for Cloud mattress',
      }),
    ).toBeVisible();
    expect(
      within(card).getByRole('link', {name: /Plan details and terms/}),
    ).toHaveAttribute('href', 'https://example.com/terms');
    expect(card).toHaveTextContent('Powered by Extend');
  });

  it('shows no offer on a card whose line has no quote', () => {
    mountLine(line(), {protection: {'gid://shopify/CartLine/9': OFFER}});
    expect(screen.queryByText('Protect this item')).toBeNull();
  });
});

describe('free gift card (REQ-PROMO-001)', () => {
  const gift = line({
    id: 'gid://shopify/CartLine/3',
    cost: {
      totalAmount: usd('0.0'),
      subtotalAmount: usd('59.0'),
      amountPerQuantity: usd('59.0'),
      compareAtAmountPerQuantity: null,
    },
    discountAllocations: [
      {
        targetType: 'LINE_ITEM',
        title: 'Free pillow',
        discountedAmount: usd('59.0'),
      },
    ],
    merchandise: {
      ...line().merchandise,
      product: {
        handle: 'pillow',
        title: 'Sleep pillow',
        id: 'gid://shopify/Product/3',
        vendor: 'Tempur-Pedic',
      },
    },
  });

  it('is its own card with the badge, the promotion name, $0.00 and the value Shopify reported struck through', () => {
    mountLine(gift);
    const card = screen.getByRole('listitem');
    expect(card).toHaveTextContent('Free gift');
    expect(card).toHaveTextContent('Free pillow');
    expect(card).toHaveTextContent('$0.00');
    expect(within(card).getByText('$59.00').tagName).toBe('S');
    expect(
      within(card).getByRole('button', {name: 'Remove Sleep pillow from cart'}),
    ).toBeVisible();
  });
});

describe('drawer row (REQ-CART-001)', () => {
  it('keeps name, total, stepper and Remove in a compact row', () => {
    mountLine(line(), {layout: 'aside'});
    const row = screen.getByRole('listitem');
    expect(
      within(row).getByRole('link', {name: 'Cloud mattress'}),
    ).toBeVisible();
    expect(row).toHaveTextContent('$1,999.00');
    expect(
      within(row).getByRole('button', {name: /^Increase quantity/}),
    ).toBeVisible();
    expect(
      within(row).getByRole('button', {
        name: 'Remove Cloud mattress from cart',
      }),
    ).toBeVisible();
  });
});

describe('page summary (CR-31)', () => {
  const FREE = {
    enabled: true,
    thresholdCents: 99900,
    subtotalCents: 120000,
    remainingCents: 0,
    reached: true,
    percent: 100,
  } as const;
  const cart = {
    lines: {nodes: []},
    checkoutUrl: 'https://shop.example/checkout',
    cost: {
      subtotalAmount: usd('2547.0'),
      totalAmount: usd('2497.0'),
    },
  };

  function mountSummary(
    freeDelivery: Parameters<typeof CartSummary>[0]['freeDelivery'],
  ) {
    const router = createMemoryRouter(
      [
        {
          path: '/cart',
          element: (
            <CartSummary
              cart={cart}
              layout="page"
              freeDelivery={freeDelivery}
            />
          ),
        },
      ],
      {initialEntries: ['/cart']},
    );
    render(<RouterProvider router={router} />);
  }

  it("shows Shopify's subtotal and estimated total as returned, with no figure of our own", () => {
    mountSummary(null);
    expect(
      screen.getByText('Subtotal').closest('div')?.querySelector('dd'),
    ).toHaveTextContent('$2,547.00');
    expect(
      screen.getByText('Estimated total').closest('div')?.querySelector('dd'),
    ).toHaveTextContent('$2,497.00');
    expect(screen.getByText('Tax is calculated at checkout.')).toBeVisible();
  });

  it('says delivery is calculated at checkout until the engine reports free delivery', () => {
    mountSummary({...FREE, reached: false, percent: 50, remainingCents: 1});
    expect(screen.getByText('Calculated at checkout')).toBeVisible();
    cleanup();
    mountSummary(FREE);
    expect(screen.getByText('Free')).toBeVisible();
  });

  it('offers the checkout link in the card, to the server gate (the phone bar is CartCheckoutBar)', () => {
    mountSummary(null);
    const links = screen.getAllByRole('link', {name: 'Checkout securely'});
    expect(links).toHaveLength(1);
    for (const link of links) {
      expect(link).toHaveAttribute('href', '/checkout-steps');
    }
    expect(
      screen.getByText('You pay on Shopify’s secure checkout.'),
    ).toBeVisible();
  });

  it('puts the discount code under a disclosure below lg', () => {
    mountSummary(null);
    const region = screen.getByRole('region', {name: 'Discount code'});
    expect(
      within(region).getByRole('button', {name: 'Add a discount code'}),
    ).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('phone checkout bar (CR-31, REQ-CHK-001)', () => {
  function mountBar(cart: Parameters<typeof CartCheckoutBar>[0]['cart']) {
    const router = createMemoryRouter(
      [{path: '/cart', element: <CartCheckoutBar cart={cart} />}],
      {initialEntries: ['/cart']},
    );
    render(<RouterProvider router={router} />);
  }

  it("shows Shopify's total and a link to the server gate", () => {
    mountBar({
      lines: {nodes: []},
      checkoutUrl: 'https://shop.example/checkout',
      cost: {totalAmount: usd('2497.0')},
    });
    expect(screen.getByText('$2,497.00')).toBeVisible();
    expect(
      screen.getByRole('link', {name: 'Checkout securely'}),
    ).toHaveAttribute('href', '/checkout-steps');
  });

  it('offers no checkout link without a checkout URL, only a way to the summary', () => {
    mountBar({lines: {nodes: []}});
    expect(screen.queryByRole('link', {name: 'Checkout securely'})).toBeNull();
    expect(
      screen.getByRole('link', {name: 'See order summary'}),
    ).toHaveAttribute('href', '#cart-summary-heading-page');
  });
});
