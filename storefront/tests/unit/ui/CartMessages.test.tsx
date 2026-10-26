// @vitest-environment jsdom
import {useState} from 'react';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import {
  createMemoryRouter,
  data,
  RouterProvider,
  type ActionFunctionArgs,
} from 'react-router';
import {CartForm} from '~/lib/hydrogen/cart-form';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {AddToCartButton} from '~/components/AddToCartButton';
import {CartDiscount} from '~/components/cart/CartDiscount';
import {CartMessages} from '~/components/cart/CartMessages';
import {
  currentCartResultSeq,
  resetCartResultsForTests,
} from '~/components/cart/cart-results';
import {useCartSubmit} from '~/components/cart/useCartSubmit';
import {AddWithProtectionButton} from '~/components/extend/AddWithProtectionButton';
import {PROTECTION_STEP_FAILURE_TEXT} from '~/lib/offers-runtime/messages';

// REQ-CART-001 / B-20: a refused cart action must be VISIBLE to the shopper. React Router removes a mounted
// fetcher that has gone idle from `useFetchers()` before the render that could read it, so the message has to come
// from the component that submitted. These tests drive the real data router and the real cart forms.

afterEach(cleanup);
beforeEach(() => resetCartResultsForTests());

const REFUSED = 'Protection is not available for this item right now.';

function cartResult(extra: Record<string, unknown>, status = 200) {
  return data(
    {
      cart: null,
      errors: [],
      warnings: [],
      offers: null,
      analytics: {cartId: undefined},
      ...extra,
    },
    {status},
  );
}

function actionOf(raw: unknown): unknown {
  if (typeof raw !== 'string') return undefined;
  const parsed: unknown = JSON.parse(raw);
  return typeof parsed === 'object' && parsed !== null && 'action' in parsed
    ? parsed.action
    : undefined;
}

/** Stands in for the /cart route action: the form's own action name decides the answer. */
async function cartAction({request}: ActionFunctionArgs) {
  const form = await request.formData();
  const raw = form.get(CartForm.INPUT_NAME);
  const action = actionOf(raw);
  if (action === 'CustomAddWithProtection') {
    return cartResult(
      {
        warnings: [
          {message: PROTECTION_STEP_FAILURE_TEXT['protection-partial']},
        ],
      },
      200,
    );
  }
  if (action === 'LinesUpdate') return cartResult({});
  return cartResult({errors: [{message: REFUSED}]}, 400);
}

function SubmitProbe() {
  const {submit} = useCartSubmit('probe');
  return (
    <>
      <button
        type="button"
        onClick={() => submit(CartForm.ACTIONS.LinesRemove, {lineIds: ['x']})}
      >
        Probe refused
      </button>
      <button
        type="button"
        onClick={() =>
          submit(CartForm.ACTIONS.LinesUpdate, {
            lines: [{id: 'x', quantity: 2}],
          })
        }
      >
        Probe ok
      </button>
    </>
  );
}

function Harness() {
  const [showMessages, setShowMessages] = useState(true);
  return (
    <div>
      {showMessages ? <CartMessages /> : null}
      <button type="button" onClick={() => setShowMessages((shown) => !shown)}>
        Toggle messages
      </button>
      <AddToCartButton
        lines={[{merchandiseId: 'gid://shopify/ProductVariant/1', quantity: 1}]}
      >
        Add to cart
      </AddToCartButton>
      <AddWithProtectionButton
        variantId="gid://shopify/ProductVariant/1"
        planKey="P-1"
      />
      <CartDiscount codes={[{code: 'SAVE', applicable: true}]} />
      <SubmitProbe />
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

const alertRegion = () => screen.getByRole('alert');
const statusRegion = () => screen.getByRole('status');

describe('cart messages reach the shopper (REQ-CART-001, B-20)', () => {
  it('keeps both live regions mounted and empty before anything happens', () => {
    mount();
    expect(alertRegion()).toBeEmptyDOMElement();
    expect(statusRegion()).toBeEmptyDOMElement();
  });

  it.each([
    ['add to cart (CartForm render prop)', 'Add to cart'],
    ['discount apply (CartForm render prop)', 'Apply'],
    [
      'discount remove (CartForm with plain children)',
      /Remove discount code SAVE/,
    ],
    ['stepper, size and protection controls (useCartSubmit)', 'Probe refused'],
  ])(
    'a refused %s shows the error in the alert region',
    async (_name, button) => {
      mount();
      fireEvent.click(screen.getByRole('button', {name: button}));
      expect(
        await screen.findByText(REFUSED, {exact: false}),
      ).toBeInTheDocument();
      expect(alertRegion()).toHaveTextContent(REFUSED);
    },
  );

  it('shows the protection-partial notice in the status region', async () => {
    mount();
    fireEvent.click(
      screen.getByRole('button', {name: 'Add to cart with protection'}),
    );
    expect(
      await screen.findByText(
        PROTECTION_STEP_FAILURE_TEXT['protection-partial'],
        {
          exact: false,
        },
      ),
    ).toBeInTheDocument();
    expect(statusRegion()).toHaveTextContent(
      'we could not add its protection plan',
    );
    expect(alertRegion()).toBeEmptyDOMElement();
  });

  it('a later success replaces an earlier error', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', {name: 'Probe refused'}));
    await screen.findByText(REFUSED, {exact: false});
    fireEvent.click(screen.getByRole('button', {name: 'Probe ok'}));
    await screen.findByRole('button', {name: 'Probe ok'});
    await expect.poll(() => alertRegion().textContent).toBe('');
  });

  it('Dismiss clears the message', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', {name: 'Probe refused'}));
    await screen.findByText(REFUSED, {exact: false});
    fireEvent.click(screen.getByRole('button', {name: 'Dismiss'}));
    expect(alertRegion()).toBeEmptyDOMElement();
    expect(screen.queryByRole('button', {name: 'Dismiss'})).toBeNull();
  });

  it('a message that arrived before this component mounted is not shown (a drawer opened later)', async () => {
    mount();
    // Hide the messages, refuse an action while no one is looking, then show them again.
    fireEvent.click(screen.getByRole('button', {name: 'Toggle messages'}));
    fireEvent.click(screen.getByRole('button', {name: 'Probe refused'}));
    // The answer is reported while nobody is looking; wait for that, not for a fixed time.
    await waitFor(() => expect(currentCartResultSeq()).toBe(1));
    fireEvent.click(screen.getByRole('button', {name: 'Toggle messages'}));
    expect(alertRegion()).toBeEmptyDOMElement();
    // The next result is shown as usual.
    fireEvent.click(screen.getByRole('button', {name: 'Probe refused'}));
    expect(
      await screen.findByText(REFUSED, {exact: false}),
    ).toBeInTheDocument();
  });
});
