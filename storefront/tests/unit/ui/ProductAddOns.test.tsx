// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import {CartForm} from '@shopify/hydrogen';
import {useState} from 'react';
import {createMemoryRouter, data, RouterProvider} from 'react-router';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {CartMessages} from '~/components/cart/CartMessages';
import {resetCartResultsForTests} from '~/components/cart/cart-results';
import {ProductAddOns} from '~/components/product/ProductAddOns';
import {PICKER_STEP_FAILURE_TEXT} from '~/lib/offers-runtime/messages';
import type {ProductAddOnItem} from '~/lib/offers-runtime/product-addons';

// REQ-ADD-001 (P4-03): the product page's add-on slot. Real data router and real cart form; the list route and `/cart`
// are stubs. It shows what the server listed, picks by the selected size, posts ids only, and has loading, empty and
// error states. Not run in a browser: layout and focus order are the e2e spec's.

const MATTRESS_QUEEN = 'gid://shopify/ProductVariant/11';
const MATTRESS_KING = 'gid://shopify/ProductVariant/12';
const FOUND_QUEEN = 'gid://shopify/ProductVariant/71';
const FOUND_KING = 'gid://shopify/ProductVariant/72';

function item(
  variantId: string,
  size: string | null,
  title: string,
  amount = '349.00',
): ProductAddOnItem {
  return {
    category: 'foundation',
    size,
    variant: {
      variantId,
      productTitle: title,
      productHandle: 'handle',
      variantTitle: size,
      price: {amount, currencyCode: 'USD'},
    },
  };
}

const FRAME = 'gid://shopify/ProductVariant/80';

const ITEMS = [
  item(FOUND_QUEEN, 'Queen', 'Steel foundation'),
  item(FOUND_KING, 'King', 'Steel foundation', '399.00'),
  item('gid://shopify/ProductVariant/80', null, 'Platform frame', '199.00'),
];

type Posted = {action: unknown; inputs: unknown};
const posted: Posted[] = [];
const requested: string[] = [];

function stubList(
  responder: () => Promise<Response> | Response,
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    requested.push(String(input));
    return Promise.resolve(responder());
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const ok = (items: readonly ProductAddOnItem[] = ITEMS) =>
  new Response(JSON.stringify({status: 'ok', items}), {status: 200});

/** Variant ids the stand-in cart holds; the root loader below reads it, so every action reloads it like the real root. */
let cartHolds: string[] = [];
/** When set, the next cart action waits for it (to look at the page while an add is in flight). */
let hold: Promise<void> | null = null;

function cartAction(answer: {errors?: string[]; warnings?: string[]}) {
  return async ({request}: {request: Request}) => {
    const form = await request.formData();
    const raw = form.get(CartForm.INPUT_NAME);
    const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : null;
    if (typeof parsed === 'object' && parsed !== null) {
      const inputs = 'inputs' in parsed ? parsed.inputs : undefined;
      posted.push({
        action: 'action' in parsed ? parsed.action : undefined,
        inputs,
      });
      if (hold) await hold;
      if (!answer.errors?.length && typeof inputs === 'object' && inputs) {
        for (const key of ['mattressVariantId', 'variantId']) {
          const id: unknown = Reflect.get(inputs, key);
          if (typeof id === 'string' && !cartHolds.includes(id)) {
            cartHolds.push(id);
          }
        }
      }
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

/** Holds the selected size like the buy box does, so a size change re-renders the slot with the same list. */
function Harness({
  onViewCart,
  available = true,
}: {
  onViewCart: () => void;
  available?: boolean;
}) {
  const [size, setSize] = useState<'Queen' | 'King'>('Queen');
  return (
    <div>
      <button type="button" onClick={() => setSize('King')}>
        Choose King
      </button>
      <CartMessages />
      <ProductAddOns
        productId="gid://shopify/Product/1"
        mattress={{
          variantId: size === 'Queen' ? MATTRESS_QUEEN : MATTRESS_KING,
          size,
          available,
        }}
        onViewCart={onViewCart}
      />
    </div>
  );
}

function mount(
  options: {
    answer?: {errors?: string[]; warnings?: string[]};
    onViewCart?: () => void;
    available?: boolean;
    cart?: string[];
  } = {},
) {
  posted.length = 0;
  cartHolds = [...(options.cart ?? [])];
  hold = null;
  const router = createMemoryRouter(
    [
      {
        id: 'root',
        path: '/',
        // Like the real root loader: the cart is a promise, and it is read again after every action.
        loader: () => ({
          cart: Promise.resolve({
            lines: {
              nodes: cartHolds.map((id) => ({merchandise: {id}})),
            },
          }),
        }),
        element: (
          <Harness
            onViewCart={options.onViewCart ?? (() => {})}
            available={options.available}
          />
        ),
      },
      {path: '/cart', action: cartAction(options.answer ?? {})},
    ],
    {initialEntries: ['/']},
  );
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(() => {
  resetCartResultsForTests();
  requested.length = 0;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const slot = () => screen.findByRole('region', {name: /Foundations, bases/});

describe('ProductAddOns (REQ-ADD-001)', () => {
  it('asks for the list with the product id and nothing else, then shows the items that fit the size with Shopify prices', async () => {
    stubList(() => ok());
    mount();
    const region = await slot();
    expect(requested).toEqual([
      '/api/product-addons?productId=gid%3A%2F%2Fshopify%2FProduct%2F1',
    ]);
    // Queen: the Queen foundation and the size-independent frame; not the King foundation.
    const rows = within(region).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Steel foundation');
    expect(rows[0]).toHaveTextContent('$349.00');
    expect(rows[1]).toHaveTextContent('Platform frame');
    expect(rows[1]).toHaveTextContent('$199.00');
  });

  it('changing the size swaps the offered variants without another request', async () => {
    stubList(() => ok());
    mount();
    await slot();
    fireEvent.click(screen.getByRole('button', {name: 'Choose King'}));
    const rows = within(await slot()).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('$399.00');
    expect(requested).toHaveLength(1);
  });

  it('shows a labelled skeleton while loading and holds its space', async () => {
    let release: (response: Response) => void = () => {};
    stubList(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    mount();
    expect(await screen.findByText(/Loading foundations/)).toBeInTheDocument();
    expect(
      screen.getByText(/Loading foundations/).closest('[aria-busy="true"]'),
    ).toHaveClass('min-h-48');
    release(ok());
    await slot();
    expect(screen.queryByText(/Loading foundations/)).toBeNull();
  });

  it('renders nothing for a size with no matching item', async () => {
    stubList(() => ok([item(FOUND_KING, 'King', 'Steel foundation')]));
    mount();
    // The slot mounted and asked (not a vacuous pass before the page rendered), then it settled.
    await waitFor(() => expect(requested).toHaveLength(1));
    await waitFor(() =>
      expect(screen.queryByText(/Loading foundations/)).toBeNull(),
    );
    expect(screen.queryByRole('region')).toBeNull();
    expect(
      screen.queryByRole('button', {name: /Add with mattress/}),
    ).toBeNull();
  });

  it('renders nothing when the server lists nothing', async () => {
    stubList(() => ok([]));
    mount();
    // The slot mounted and asked (not a vacuous pass before the page rendered), then it settled.
    await waitFor(() => expect(requested).toHaveLength(1));
    await waitFor(() =>
      expect(screen.queryByText(/Loading foundations/)).toBeNull(),
    );
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('shows an announced error with a retry, and a retry loads the list', async () => {
    let calls = 0;
    stubList(() => {
      calls += 1;
      return calls === 1 ? new Response('no', {status: 500}) : ok();
    });
    mount();
    expect(
      await screen.findByText(/could not load the matching/),
    ).toBeInTheDocument();
    expect(screen.getByText(/could not load the matching/)).toHaveAttribute(
      'role',
      'alert',
    );
    fireEvent.click(screen.getByRole('button', {name: 'Try again'}));
    await slot();
    expect(requested).toHaveLength(2);
  });

  it('treats a network failure and a body that is not an answer as errors', async () => {
    stubList(() => {
      throw new Error('offline');
    });
    mount();
    expect(
      await screen.findByText(/could not load the matching/),
    ).toBeInTheDocument();
    cleanup();
    stubList(() => new Response(JSON.stringify({nope: true}), {status: 200}));
    mount();
    expect(
      await screen.findByText(/could not load the matching/),
    ).toBeInTheDocument();
  });

  it('announces how many options fit the selected size', async () => {
    stubList(() => ok());
    mount();
    await slot();
    expect(
      screen
        .getAllByRole('status')
        .some((region) =>
          /2 foundations, bases or frames are available/.test(
            region.textContent ?? '',
          ),
        ),
    ).toBe(true);
  });
});

describe('ProductAddOns add (REQ-ADD-001, T-01)', () => {
  it('posts the add-on variant and the viewed mattress variant, and no price, quantity or title', async () => {
    stubList(() => ok());
    mount();
    const region = await slot();
    fireEvent.click(
      within(region).getAllByRole('button', {name: /Add with mattress/})[0],
    );
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({
      action: 'CustomAddAddOn',
      inputs: {variantId: FOUND_QUEEN, mattressVariantId: MATTRESS_QUEEN},
    });
  });

  it('posts the King pair after the size changes', async () => {
    stubList(() => ok());
    mount();
    await slot();
    fireEvent.click(screen.getByRole('button', {name: 'Choose King'}));
    const region = await slot();
    fireEvent.click(
      within(region).getAllByRole('button', {name: /Add with mattress/})[0],
    );
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]?.inputs).toEqual({
      variantId: FOUND_KING,
      mattressVariantId: MATTRESS_KING,
    });
  });

  it('gives each button the item name in its accessible name, which contains the visible label', async () => {
    stubList(() => ok());
    mount();
    const region = await slot();
    const buttons = within(region).getAllByRole('button', {
      name: /Add with mattress/,
    });
    expect(buttons[0]).toHaveAccessibleName(
      'Add with mattress: Steel foundation, Queen',
    );
    expect(buttons[1]).toHaveAccessibleName(
      'Add with mattress: Platform frame',
    );
  });

  it('after a successful add the row says so, announces it, offers View cart and keeps focus in the row', async () => {
    stubList(() => ok());
    const onViewCart = vi.fn();
    mount({onViewCart});
    const region = await slot();
    const add = within(region).getAllByRole('button', {
      name: /Add with mattress/,
    })[0];
    add.focus();
    fireEvent.click(add);
    const view = await within(region).findByRole('button', {name: 'View cart'});
    expect(within(region).getAllByText('Added to cart')[0]).toBeVisible();
    // The Add button of that row is gone, and focus moved to the control that replaced it (it did not drop to the body).
    expect(
      within(region).queryByRole('button', {name: /Add with mattress: Steel/}),
    ).toBeNull();
    await waitFor(() => expect(view).toHaveFocus());
    expect(
      within(region)
        .getAllByRole('status')
        .some((node) =>
          /Added to cart: Steel foundation, Queen/.test(node.textContent ?? ''),
        ),
    ).toBe(true);
    fireEvent.click(view);
    expect(onViewCart).toHaveBeenCalledTimes(1);
  });

  it('is added only while the cart holds BOTH the add-on and this mattress: removing the add-on in the cart brings the Add button back', async () => {
    stubList(() => ok());
    const router = mount({cart: [MATTRESS_QUEEN, FOUND_QUEEN]});
    const region = await slot();
    // Back on the page with both lines already in the cart.
    expect(
      await within(region).findAllByRole('button', {name: 'View cart'}),
    ).toHaveLength(1);
    expect(
      within(region).queryByRole('button', {name: /Add with mattress: Steel/}),
    ).toBeNull();
    // The shopper removes the foundation in the cart; the root cart reloads.
    cartHolds = [MATTRESS_QUEEN];
    await act(() => router.revalidate());
    expect(
      await within(region).findByRole('button', {
        name: /Add with mattress: Steel foundation, Queen/,
      }),
    ).toBeEnabled();
    expect(
      within(region).queryByRole('button', {name: 'View cart'}),
    ).toBeNull();
  });

  it('a size-independent add-on added with Queen is not shown as added for King', async () => {
    stubList(() => ok());
    mount({cart: [MATTRESS_QUEEN, FRAME]});
    const region = await slot();
    expect(
      await within(region).findAllByRole('button', {name: 'View cart'}),
    ).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', {name: 'Choose King'}));
    const king = await slot();
    // The frame is still listed (it fits every size) but it can be added again with the King mattress.
    await waitFor(() =>
      expect(
        within(king).getByRole('button', {
          name: /Add with mattress: Platform frame/,
        }),
      ).toBeEnabled(),
    );
    expect(within(king).queryByRole('button', {name: 'View cart'})).toBeNull();
  });

  it('an empty cart claims no add', async () => {
    stubList(() => ok());
    mount();
    const region = await slot();
    expect(
      within(region).queryByRole('button', {name: 'View cart'}),
    ).toBeNull();
  });

  it('while one row is adding every other row waits, so two adds cannot race', async () => {
    stubList(() => ok());
    let release: () => void = () => {};
    mount();
    const region = await slot();
    hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const buttons = () =>
      within(region).getAllByRole('button', {name: /Add with mattress/});
    fireEvent.click(buttons()[0]);
    await waitFor(() => expect(buttons()[1]).toBeDisabled());
    // The row that is adding keeps its button (inert, busy), so focus stays where it was.
    expect(buttons()[0]).toHaveAttribute('aria-disabled', 'true');
    release();
    await waitFor(() => expect(posted).toHaveLength(1));
    await within(region).findAllByRole('button', {name: 'View cart'});
    await waitFor(() =>
      expect(
        within(region).getByRole('button', {
          name: /Add with mattress: Platform frame/,
        }),
      ).toBeEnabled(),
    );
  });

  it('a refused add shows the fixed message in the shared cart messages and leaves the button usable', async () => {
    stubList(() => ok());
    mount({
      answer: {errors: [PICKER_STEP_FAILURE_TEXT['addon-not-offered']]},
    });
    const region = await slot();
    fireEvent.click(
      within(region).getAllByRole('button', {name: /Add with mattress/})[0],
    );
    expect(
      await screen.findByText(PICKER_STEP_FAILURE_TEXT['addon-not-offered']),
    ).toBeInTheDocument();
    expect(
      within(region).getAllByRole('button', {name: /Add with mattress/})[0],
    ).toBeEnabled();
    expect(
      within(region).queryByRole('button', {name: 'View cart'}),
    ).toBeNull();
  });

  it('with the mattress size sold out the buttons are disabled and the reason is shown', async () => {
    stubList(() => ok());
    mount({available: false});
    const region = await slot();
    const reason = within(region).getByText(/back in stock/);
    for (const button of within(region).getAllByRole('button', {
      name: /Add with mattress/,
    })) {
      expect(button).toBeDisabled();
      // The reason is announced with the button, not only shown next to it.
      expect(button).toHaveAccessibleDescription(reason.textContent ?? '');
    }
  });
});
