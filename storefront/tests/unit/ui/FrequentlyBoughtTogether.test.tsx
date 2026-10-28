// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import {useState} from 'react';
import {createMemoryRouter, data, RouterProvider} from 'react-router';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {resetCartResultsForTests} from '~/components/cart/cart-results';
import {FrequentlyBoughtTogether} from '~/components/product/FrequentlyBoughtTogether';
import {CartForm} from '~/lib/hydrogen/cart-form';
import {PICKER_STEP_FAILURE_TEXT} from '~/lib/offers-runtime/messages';
import type {ProductBundle} from '~/lib/offers-runtime/product-bundle';

// REQ-ADD-002 (P4-06): the product page's "Frequently bought together" card. Real data router and real cart form; the list
// route and `/cart` are stubs. It shows what the server listed with Shopify's prices, picks the set by the selected size,
// posts the bundle id and the viewed variant only, shows a saving only when the cart result carries one, and has loading,
// empty and error states. Not run in a browser: layout and focus order are not seen.

const MATTRESS_QUEEN = 'gid://shopify/ProductVariant/11';
const MATTRESS_KING = 'gid://shopify/ProductVariant/12';
const FOUND_QUEEN = 'gid://shopify/ProductVariant/71';
const FOUND_KING = 'gid://shopify/ProductVariant/72';
const PILLOW = 'gid://shopify/ProductVariant/51';

function item(variantId: string, title: string, amount: string, quantity = 1) {
  return {
    quantity,
    variant: {
      variantId,
      productTitle: title,
      productHandle: 'handle',
      variantTitle: null,
      price: {amount, currencyCode: 'USD'},
    },
  };
}

const BUNDLE: ProductBundle = {
  bundleId: 'sleep-set',
  sets: [
    {
      size: 'Queen',
      items: [
        item(FOUND_QUEEN, 'Steel foundation', '349.00'),
        item(PILLOW, 'Cloud pillow', '49.00', 2),
      ],
    },
    {
      size: 'King',
      items: [
        item(FOUND_KING, 'Steel foundation', '399.00'),
        item(PILLOW, 'Cloud pillow', '49.00', 2),
      ],
    },
  ],
};

type Posted = {action: unknown; inputs: unknown};
const posted: Posted[] = [];
const requested: string[] = [];

function stubList(responder: () => Promise<Response> | Response) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      requested.push(String(input));
      return Promise.resolve(responder());
    }),
  );
}

const ok = (bundle: ProductBundle | null = BUNDLE) =>
  new Response(JSON.stringify({status: 'ok', bundle}), {status: 200});

let cartHolds: string[] = [];
let hold: Promise<void> | null = null;

type Answer = {
  errors?: string[];
  warnings?: string[];
  /** The offers view the cart gate built after the add (Shopify's saving, if it reported one). */
  offers?: unknown;
};

function cartAction(answer: Answer) {
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
      if (!answer.errors?.length) {
        // The server added the whole set; the root loader reads it back.
        cartHolds = [MATTRESS_QUEEN, FOUND_QUEEN, PILLOW];
      }
    }
    return data(
      {
        cart: null,
        errors: (answer.errors ?? []).map((message) => ({message})),
        warnings: (answer.warnings ?? []).map((message) => ({message})),
        offers: answer.offers ?? null,
        analytics: {cartId: undefined},
      },
      {status: answer.errors?.length ? 400 : 200},
    );
  };
}

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
      <FrequentlyBoughtTogether
        productId="gid://shopify/Product/1"
        anchor={{
          variantId: size === 'Queen' ? MATTRESS_QUEEN : MATTRESS_KING,
          productTitle: 'Cloud mattress',
          size,
          available,
          price: {amount: '999.00', currencyCode: 'USD'},
        }}
        onViewCart={onViewCart}
      />
    </div>
  );
}

function mount(
  options: {
    answer?: Answer;
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
        loader: () => ({
          cart: Promise.resolve({
            lines: {nodes: cartHolds.map((id) => ({merchandise: {id}}))},
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

const card = () =>
  screen.findByRole('region', {name: 'Frequently bought together'});
const addAll = (region: HTMLElement) =>
  within(region).getByRole('button', {name: 'Add all to cart'});

describe('FrequentlyBoughtTogether (REQ-ADD-002)', () => {
  it('asks with the product id and nothing else, then lists this item and the companions with Shopify prices and no total', async () => {
    stubList(() => ok());
    mount();
    const region = await card();
    expect(requested).toEqual([
      '/api/product-bundle?productId=gid%3A%2F%2Fshopify%2FProduct%2F1',
    ]);
    const rows = within(region).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('Cloud mattress');
    expect(rows[0]).toHaveTextContent('$999.00');
    expect(rows[1]).toHaveTextContent('Steel foundation');
    expect(rows[1]).toHaveTextContent('$349.00');
    expect(rows[2]).toHaveTextContent('2 x Cloud pillow');
    expect(rows[2]).toHaveTextContent('$49.00');
    expect(rows[2]).toHaveTextContent('each');
    // 999 + 349 + 98 = 1,446: no browser-side total, and no saving claim before the cart reports one.
    expect(region).not.toHaveTextContent('1,446');
    expect(region).not.toHaveTextContent(/save|savings/i);
  });

  it('changing the size swaps the companions without another request', async () => {
    stubList(() => ok());
    mount();
    await card();
    fireEvent.click(screen.getByRole('button', {name: 'Choose King'}));
    const rows = within(await card()).getAllByRole('listitem');
    expect(rows[1]).toHaveTextContent('$399.00');
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
    const note = await screen.findByText(/Loading the set/);
    expect(note.closest('[aria-busy="true"]')).toHaveClass('min-h-48');
    release(ok());
    await card();
    expect(screen.queryByText(/Loading the set/)).toBeNull();
  });

  it.each([
    ['the server lists nothing', () => ok(null)],
    [
      'no set fits the selected size',
      () =>
        ok({
          bundleId: 'b',
          sets: [{size: 'Twin', items: BUNDLE.sets[0]?.items ?? []}],
        }),
    ],
  ])('renders nothing when %s', async (_name, response) => {
    stubList(response);
    mount();
    await waitFor(() => expect(requested).toHaveLength(1));
    await waitFor(() =>
      expect(screen.queryByText(/Loading the set/)).toBeNull(),
    );
    expect(screen.queryByRole('region')).toBeNull();
    expect(screen.queryByRole('button', {name: /Add all/})).toBeNull();
  });

  it('shows an announced error with a retry, and a retry loads the set', async () => {
    let calls = 0;
    stubList(() => {
      calls += 1;
      return calls === 1 ? new Response('no', {status: 500}) : ok();
    });
    mount();
    const message = await screen.findByText(/could not load this set/);
    expect(message).toHaveAttribute('role', 'alert');
    fireEvent.click(screen.getByRole('button', {name: 'Try again'}));
    await card();
    expect(requested).toHaveLength(2);
  });

  it('treats a network failure and a body that is not an answer as errors', async () => {
    stubList(() => {
      throw new Error('offline');
    });
    mount();
    expect(
      await screen.findByText(/could not load this set/),
    ).toBeInTheDocument();
    cleanup();
    stubList(() => new Response(JSON.stringify({nope: true}), {status: 200}));
    mount();
    expect(
      await screen.findByText(/could not load this set/),
    ).toBeInTheDocument();
  });
});

describe('FrequentlyBoughtTogether add all (REQ-ADD-002, T-01)', () => {
  it('posts the bundle id and the viewed variant, and no price, quantity or title', async () => {
    stubList(() => ok());
    mount();
    fireEvent.click(addAll(await card()));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({
      action: 'CustomAddProductBundle',
      inputs: {bundleId: 'sleep-set', anchorVariantId: MATTRESS_QUEEN},
    });
  });

  it('posts the King variant after the size changes', async () => {
    stubList(() => ok());
    mount();
    await card();
    fireEvent.click(screen.getByRole('button', {name: 'Choose King'}));
    fireEvent.click(addAll(await card()));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]?.inputs).toEqual({
      bundleId: 'sleep-set',
      anchorVariantId: MATTRESS_KING,
    });
  });

  it('after a successful add says so, announces it and offers View cart', async () => {
    stubList(() => ok());
    const onViewCart = vi.fn();
    mount({onViewCart});
    const region = await card();
    const add = addAll(region);
    add.focus();
    fireEvent.click(add);
    const view = await within(region).findByRole('button', {name: 'View cart'});
    // The Add all button is gone (nothing left to add) and focus moved to the control that replaced it, not to the body.
    expect(
      within(region).queryByRole('button', {name: 'Add all to cart'}),
    ).toBeNull();
    await waitFor(() => expect(view).toHaveFocus());
    expect(within(region).getAllByText('Added to cart').length).toBeGreaterThan(
      0,
    );
    expect(
      within(region)
        .getAllByRole('status')
        .some((node) => /Added to cart/.test(node.textContent ?? '')),
    ).toBe(true);
    fireEvent.click(view);
    expect(onViewCart).toHaveBeenCalledTimes(1);
  });

  it('is shown as added only while the cart holds the viewed variant and every companion', async () => {
    stubList(() => ok());
    mount({cart: [MATTRESS_QUEEN, FOUND_QUEEN]});
    // The pillow is missing, so the set is not complete and Add all stays available.
    const region = await card();
    expect(addAll(region)).toBeEnabled();
    expect(
      within(region).queryByRole('button', {name: 'View cart'}),
    ).toBeNull();
  });

  it("shows the saving only when the cart result carries Shopify's figure for this bundle", async () => {
    stubList(() => ok());
    mount({
      answer: {
        offers: {
          bundles: [
            {
              bundleId: 'sleep-set',
              status: 'complete',
              savings: {amount: '85.00', currencyCode: 'USD'},
            },
          ],
        },
      },
    });
    const region = await card();
    fireEvent.click(addAll(region));
    expect(
      await within(region).findByText(/Savings on these items: \$85\.00/),
    ).toBeInTheDocument();
  });

  it('shows no saving when Shopify reported none', async () => {
    stubList(() => ok());
    mount({answer: {offers: {bundles: []}}});
    const region = await card();
    fireEvent.click(addAll(region));
    await within(region).findByRole('button', {name: 'View cart'});
    expect(region).not.toHaveTextContent(/Savings/);
  });

  it('a refused add shows the fixed message in the card and leaves the button usable', async () => {
    stubList(() => ok());
    mount({
      answer: {errors: [PICKER_STEP_FAILURE_TEXT['bundle-not-offered']]},
    });
    const region = await card();
    fireEvent.click(addAll(region));
    expect(
      await within(region).findByText(
        PICKER_STEP_FAILURE_TEXT['bundle-not-offered'],
      ),
    ).toBeInTheDocument();
    expect(addAll(region)).toBeEnabled();
    expect(
      within(region).queryByRole('button', {name: 'View cart'}),
    ).toBeNull();
  });

  it('a partial add shows the notice and the card still reports the cart truthfully', async () => {
    stubList(() => ok());
    mount({
      answer: {warnings: [PICKER_STEP_FAILURE_TEXT['bundle-partial']]},
    });
    const region = await card();
    fireEvent.click(addAll(region));
    expect(
      await within(region).findByText(
        PICKER_STEP_FAILURE_TEXT['bundle-partial'],
      ),
    ).toBeInTheDocument();
  });

  it('while adding, the button is busy and inert', async () => {
    stubList(() => ok());
    let release: () => void = () => {};
    mount();
    const region = await card();
    hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    fireEvent.click(addAll(region));
    await waitFor(() =>
      expect(
        within(region).getByRole('button', {name: /Adding/}),
      ).toHaveAttribute('aria-busy', 'true'),
    );
    release();
    await within(region).findByRole('button', {name: 'View cart'});
  });

  it('with the viewed size sold out the button is off and the reason is announced with it', async () => {
    stubList(() => ok());
    mount({available: false});
    const region = await card();
    const reason = within(region).getByText(/back in stock/);
    expect(addAll(region)).toBeDisabled();
    expect(addAll(region)).toHaveAccessibleDescription(
      reason.textContent ?? '',
    );
  });
});
