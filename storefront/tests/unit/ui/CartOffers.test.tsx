// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import {CartForm} from '~/lib/hydrogen/cart-form';
import {createMemoryRouter, data, RouterProvider} from 'react-router';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {CartMessages} from '~/components/cart/CartMessages';
import {CartOffers} from '~/components/cart/CartOffers';
import {resetCartResultsForTests} from '~/components/cart/cart-results';
import {PICKER_STEP_FAILURE_TEXT} from '~/lib/offers-runtime/messages';
import {
  unverifiedView,
  type CartOffersView,
  type OfferedVariant,
} from '~/lib/offers-runtime/view';

// REQ-CART-002 / REQ-CART-003 / REQ-ADD-002 / REQ-PROMO-001: the cart pickers render from the offers view, post only
// ids taken from it, show their result through CartMessages and never claim a price. Real data router and real cart forms.

afterEach(cleanup);
beforeEach(() => resetCartResultsForTests());

const variant = (
  id: number,
  productTitle: string,
  variantTitle: string | null = null,
  amount = '49.00',
): OfferedVariant => ({
  variantId: `gid://shopify/ProductVariant/${id}`,
  productTitle,
  productHandle: `product-${id}`,
  variantTitle,
  price: {amount, currencyCode: 'USD'},
});

const BASE: CartOffersView = {
  ...unverifiedView('v1', {code: 'unverified', message: 'x', lineIds: []}),
  blocked: [],
  freeDelivery: {enabled: false},
};

function viewWith(overrides: Partial<CartOffersView>): CartOffersView {
  return {...BASE, ...overrides};
}

type Posted = {action: unknown; inputs: unknown};
const posted: Posted[] = [];

/** Stands in for `/cart`: records what the form posted, answers with the text the test chose. */
function cartAction(answer: {errors?: string[]; warnings?: string[]}) {
  return async ({request}: {request: Request}) => {
    const form = await request.formData();
    const raw = form.get(CartForm.INPUT_NAME);
    const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : null;
    if (typeof parsed === 'object' && parsed !== null) {
      posted.push({
        action: 'action' in parsed ? parsed.action : undefined,
        inputs: 'inputs' in parsed ? parsed.inputs : undefined,
      });
    }
    return data(
      {
        cart: null,
        errors: (answer.errors ?? []).map((message) => ({message})),
        warnings: (answer.warnings ?? []).map((message) => ({message})),
        offers: null,
        analytics: {cartId: undefined},
      },
      {status: answer.errors?.length ? 400 : 200},
    );
  };
}

function mount(
  view: CartOffersView,
  answer: {errors?: string[]; warnings?: string[]} = {},
  onAdded?: () => void,
) {
  posted.length = 0;
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: (
          <div>
            <CartMessages />
            <CartOffers view={view} onAdded={onAdded} />
          </div>
        ),
      },
      {path: '/cart', action: cartAction(answer)},
    ],
    {initialEntries: ['/']},
  );
  render(<RouterProvider router={router} />);
}

const GIFT_VIEW = viewWith({
  gifts: [
    {
      ruleId: 'gift-pillow',
      name: 'Pillow gift',
      remainingQuantity: 1,
      sizes: [
        {size: 'Standard', variant: variant(31, 'Cloud pillow')},
        {size: 'King', variant: variant(32, 'Cloud pillow')},
      ],
    },
  ],
});

describe('gift picker (REQ-CART-002, REQ-PROMO-001)', () => {
  it('is a labelled group with a choose-one radio group, the first choice preselected', () => {
    mount(GIFT_VIEW);
    const group = screen.getByRole('group', {name: /Pillow gift/});
    const radios = within(group).getAllByRole('radio');
    expect(radios).toHaveLength(2);
    expect(radios[0]).toBeChecked();
    expect(radios[1]).not.toBeChecked();
    expect(
      within(group).getByRole('group', {name: 'Choose your gift'}),
    ).toBeInTheDocument();
  });

  it('posts the rule id and the chosen variant id, nothing else (no quantity, no price)', async () => {
    mount(GIFT_VIEW);
    fireEvent.click(screen.getByRole('radio', {name: /King/}));
    fireEvent.click(screen.getByRole('button', {name: /Add gift to cart/}));
    await expect.poll(() => posted.length).toBe(1);
    expect(posted[0]).toEqual({
      action: 'CustomAddGift',
      inputs: {
        ruleId: 'gift-pillow',
        variantId: 'gid://shopify/ProductVariant/32',
      },
    });
  });

  it('makes no price claim: no "free" wording and no price before Shopify has priced the line', () => {
    mount(GIFT_VIEW);
    const group = screen.getByRole('group', {name: /Pillow gift/});
    expect(group.textContent ?? '').not.toMatch(/free/i);
    expect(group.textContent ?? '').not.toMatch(/\$/);
  });

  it('shows one gift as text, not as a one-option radio group', () => {
    mount(
      viewWith({
        gifts: [
          {
            ruleId: 'g',
            name: 'Sheet gift',
            remainingQuantity: 1,
            sizes: [{size: 'Queen', variant: variant(40, 'Sheets')}],
          },
        ],
      }),
    );
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.getByText('Sheets (Queen)')).toBeInTheDocument();
  });

  it('shows the server refusal in the alert region', async () => {
    mount(GIFT_VIEW, {errors: [PICKER_STEP_FAILURE_TEXT['gift-not-offered']]});
    fireEvent.click(screen.getByRole('button', {name: /Add gift to cart/}));
    expect(
      await screen.findByText(PICKER_STEP_FAILURE_TEXT['gift-not-offered'], {
        exact: false,
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      PICKER_STEP_FAILURE_TEXT['gift-not-offered'],
    );
  });
});

describe('add-on picker (REQ-CART-003)', () => {
  const ADD_ON_VIEW = viewWith({
    addOns: [
      {
        category: 'foundation',
        mattressLineId: 'gid://shopify/CartLine/m',
        size: 'Queen',
        variant: variant(71, 'Foundation', 'Queen', '199.00'),
      },
      {
        category: 'pillow',
        mattressLineId: 'gid://shopify/CartLine/m',
        size: null,
        variant: variant(51, 'Cloud pillow', null, '49.00'),
      },
    ],
  });

  it('lists each add-on with its category, size match and Shopify price', () => {
    mount(ADD_ON_VIEW);
    const list = screen.getByRole('list', {name: 'Goes with your mattress'});
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent(
      'Matching foundation for your Queen mattress',
    );
    expect(items[0]).toHaveTextContent('$199.00');
    expect(items[1]).not.toHaveTextContent('for your');
  });

  it('posts the variant id only', async () => {
    mount(ADD_ON_VIEW);
    fireEvent.click(
      screen.getByRole('button', {name: 'Add Foundation to cart'}),
    );
    await expect.poll(() => posted.length).toBe(1);
    expect(posted[0]).toEqual({
      action: 'CustomAddAddOn',
      inputs: {variantId: 'gid://shopify/ProductVariant/71'},
    });
  });
});

describe('bundle offer (REQ-ADD-002, REQ-PROMO-002)', () => {
  const INCOMPLETE = viewWith({
    bundles: [
      {
        bundleId: 'sleep-set',
        name: 'Sleep set',
        anchorLineId: 'gid://shopify/CartLine/m',
        anchorTitle: 'Cloud mattress',
        status: 'incomplete',
        missing: [
          {variant: variant(71, 'Foundation', 'Queen', '199.00'), quantity: 1},
          {variant: variant(51, 'Cloud pillow', null, '49.00'), quantity: 2},
        ],
        savings: null,
      },
    ],
  });

  it('lists what is missing and posts the bundle id and the anchor line id only', async () => {
    mount(INCOMPLETE);
    const group = screen.getByRole('group', {name: /Sleep set/});
    expect(group).toHaveTextContent('Foundation, Queen');
    expect(group).toHaveTextContent('2 x Cloud pillow');
    expect(group.textContent ?? '').not.toMatch(/save \$|you save|% off/i);
    fireEvent.click(
      screen.getByRole('button', {name: /Add missing items to complete/}),
    );
    await expect.poll(() => posted.length).toBe(1);
    expect(posted[0]).toEqual({
      action: 'CustomAddBundle',
      inputs: {
        bundleId: 'sleep-set',
        anchorLineId: 'gid://shopify/CartLine/m',
      },
    });
  });

  it('shows the saving Shopify reported on a complete bundle', () => {
    mount(
      viewWith({
        bundles: [
          {
            bundleId: 'sleep-set',
            name: 'Sleep set',
            anchorLineId: 'gid://shopify/CartLine/m',
            anchorTitle: 'Cloud mattress',
            status: 'complete',
            missing: [],
            savings: {amount: '85.00', currencyCode: 'USD'},
          },
        ],
      }),
    );
    const group = screen.getByRole('group', {name: /Sleep set/});
    expect(group).toHaveTextContent('Savings on these items: $85.00');
    expect(within(group).queryByRole('button')).toBeNull();
  });

  it('renders nothing at all when the view has no offers', () => {
    mount(BASE);
    expect(screen.queryByRole('region')).toBeNull();
    expect(screen.queryByText('Complete your set')).toBeNull();
  });

  it('shows the partial-add notice in the status region', async () => {
    mount(INCOMPLETE, {warnings: [PICKER_STEP_FAILURE_TEXT['bundle-partial']]});
    fireEvent.click(
      screen.getByRole('button', {name: /Add missing items to complete/}),
    );
    expect(
      await screen.findByText(PICKER_STEP_FAILURE_TEXT['bundle-partial'], {
        exact: false,
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      PICKER_STEP_FAILURE_TEXT['bundle-partial'],
    );
  });
});

describe('focus after an add and wording (m8, m9)', () => {
  it('asks the cart to move focus once an add succeeded, and not when it was refused', async () => {
    let added = 0;
    mount(GIFT_VIEW, {}, () => (added += 1));
    fireEvent.click(screen.getByRole('button', {name: /Add gift to cart/}));
    await expect.poll(() => added).toBe(1);

    cleanup();
    resetCartResultsForTests();
    let refusedAdded = 0;
    mount(
      GIFT_VIEW,
      {errors: [PICKER_STEP_FAILURE_TEXT['gift-not-offered']]},
      () => (refusedAdded += 1),
    );
    fireEvent.click(screen.getByRole('button', {name: /Add gift to cart/}));
    await screen.findByRole('alert');
    await expect
      .poll(() => screen.getByRole('alert').textContent)
      .toContain(PICKER_STEP_FAILURE_TEXT['gift-not-offered']);
    expect(refusedAdded).toBe(0);
  });

  it('labels a unit price "each" when the row asks for more than one', () => {
    mount(
      viewWith({
        bundles: [
          {
            bundleId: 'b',
            name: 'Sleep set',
            anchorLineId: 'gid://shopify/CartLine/m',
            anchorTitle: 'Mattress',
            status: 'incomplete',
            missing: [
              {
                variant: variant(51, 'Cloud pillow', null, '49.00'),
                quantity: 2,
              },
              {
                variant: variant(71, 'Foundation', 'Queen', '199.00'),
                quantity: 1,
              },
            ],
            savings: null,
          },
        ],
      }),
    );
    const rows = screen.getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('2 x Cloud pillow$49.00each');
    expect(rows[1]).not.toHaveTextContent('each');
  });

  it('says "the store" and not "Shopify" where it describes how the promotion is applied', () => {
    mount(GIFT_VIEW);
    expect(
      screen.getByRole('group', {name: /Pillow gift/}).textContent ?? '',
    ).not.toMatch(/shopify/i);
  });
});
