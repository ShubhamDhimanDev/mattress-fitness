import {useLoaderData, data, type HeadersFunction} from 'react-router';
import type {Route} from './+types/cart';
import {CartForm} from '@shopify/hydrogen';
import {CartMain} from '~/components/CartMain';
import {formatPageTitle} from '~/components/layout/documentTitle';
import {
  validateAddLines,
  validateAddProtection,
  validateAddWithProtection,
  validateDiscountCodes,
  validateLineIds,
  validateSizeChange,
  validateUpdateLines,
} from '~/lib/cart/actions';
import {
  ADD_PROTECTION_ACTION,
  ADD_WITH_PROTECTION_ACTION,
  CHANGE_SIZE_ACTION,
} from '~/lib/cart/custom-actions';
import {isSameOriginRequest, noStoreHeaders} from '~/lib/cart/http';
import {safeRedirectPath} from '~/lib/cart/input';
import {
  revalidateCartOffers,
  stepFailureText,
  swapLineSize,
  type CartMutationResult,
} from '~/lib/offers-runtime/server';
import {readSmallForm} from '~/lib/delivery-runtime/form';
import {
  addItemWithProtection,
  addProtectionToLine,
} from '~/lib/offers-runtime/protection-steps';
import {offerRuntimeOf} from '~/lib/offers-runtime/runtime';

export const meta: Route.MetaFunction = () => [
  {title: formatPageTitle('Your cart')},
  {name: 'robots', content: 'noindex'},
];

// The cart cookie is read and set here: nothing about this route may sit in a shared cache (P-L3).
export const headers: HeadersFunction = ({actionHeaders}) =>
  noStoreHeaders(actionHeaders);

function rejected(message: string, status = 400) {
  return data(
    {
      cart: null,
      errors: [{message}],
      warnings: [],
      offers: null,
      analytics: {cartId: undefined},
    },
    {status, headers: noStoreHeaders()},
  );
}

/**
 * The one cart endpoint (REQ-CART-001). Every input is validated first (T-01): the browser may name
 * variants, lines, quantities and discount codes, nothing else, and Shopify prices the result. Mutations
 * go through Hydrogen's cart handler; `errors` (userErrors) and `warnings` are returned to the page so a
 * partial failure is visible.
 *
 * After every mutation the offer engine runs against the real cart and repairs it (REQ-PRE-006): an
 * orphaned gift, an over-limit service line or a protector without its mattress never survives a request,
 * whatever the browser sent. What was repaired comes back as notices in `warnings`.
 */
const CART_FORM_MAX_BYTES = 32 * 1024;

export async function action({request, context}: Route.ActionArgs) {
  if (!isSameOriginRequest(request)) {
    return rejected('That request could not be verified.', 403);
  }
  const {cart} = context;
  const runtime = await offerRuntimeOf(context, request);
  // A cart post carries a few lines and short properties; refuse anything bigger before buffering it (T-13).
  const body = await readSmallForm(request, CART_FORM_MAX_BYTES);
  if (body.status !== 'ok') {
    return body.status === 'too-large'
      ? rejected('That request was too large.', 413)
      : rejected('That request could not be read.');
  }
  const formData = body.form;

  let parsed: ReturnType<typeof CartForm.getFormInput>;
  try {
    parsed = CartForm.getFormInput(formData);
  } catch {
    return rejected('That request could not be read.');
  }
  const {action, inputs} = parsed;

  let result: CartMutationResult;
  // Fixed texts for a change that went through only in part (never anything from the request).
  const partial: string[] = [];
  switch (action) {
    case CartForm.ACTIONS.LinesAdd: {
      const lines = validateAddLines(inputs.lines);
      if (lines.status === 'invalid') return rejected(lines.reason);
      result = await cart.addLines(lines.value);
      // A stale or unknown cart cookie answers with no cart and no error; the shopper must not be unable to
      // add for the life of the cookie. Start a fresh cart with the same validated lines; its id replaces the cookie.
      if (!result.cart?.id && !result.errors?.length) {
        result = await cart.create({lines: lines.value});
      }
      break;
    }
    case CartForm.ACTIONS.LinesUpdate: {
      const lines = validateUpdateLines(inputs.lines);
      if (lines.status === 'invalid') return rejected(lines.reason);
      result = await cart.updateLines(lines.value);
      break;
    }
    case CartForm.ACTIONS.LinesRemove: {
      const ids = validateLineIds(inputs.lineIds);
      if (ids.status === 'invalid') return rejected(ids.reason);
      result = await cart.removeLines(ids.value);
      break;
    }
    case CartForm.ACTIONS.DiscountCodesUpdate: {
      const codes = validateDiscountCodes(
        inputs.discountCode,
        inputs.discountCodes,
      );
      if (codes.status === 'invalid') return rejected(codes.reason);
      result = await cart.updateDiscountCodes(codes.value);
      break;
    }
    case CHANGE_SIZE_ACTION: {
      const change = validateSizeChange(inputs);
      if (change.status === 'invalid') return rejected(change.reason);
      const swapped = await swapLineSize(runtime, await cart.get(), {
        lineId: change.value.lineId,
        merchandiseId: change.value.merchandiseId,
      });
      if (swapped.status === 'rejected') return rejected(swapped.reason);
      result = swapped.result;
      break;
    }
    case ADD_WITH_PROTECTION_ACTION: {
      // Variant, quantity and plan key only (T-01): the server re-quotes the plan and derives the coverage variant,
      // its price, its attributes and its parent line (P5A-05).
      const input = validateAddWithProtection(inputs);
      if (input.status === 'invalid') return rejected(input.reason);
      const added = await addItemWithProtection(
        runtime,
        await cart.get(),
        input.value,
        (created) => cart.create(created),
      );
      if (added.status === 'rejected') return rejected(added.reason);
      result = added.result;
      if (added.warning) partial.push(stepFailureText(added.warning));
      break;
    }
    case ADD_PROTECTION_ACTION: {
      const input = validateAddProtection(inputs);
      if (input.status === 'invalid') return rejected(input.reason);
      const added = await addProtectionToLine(
        runtime,
        await cart.get(),
        input.value,
      );
      if (added.status === 'rejected') return rejected(added.reason);
      result = added.result;
      break;
    }
    default:
      return rejected('That cart action is not supported.');
  }

  // Repair the cart the mutation produced. A failure here must not lose the shopper's change: the hand-off
  // runs the same check again (checkout-steps), so an unverified cart still cannot reach checkout.
  // The mutation's own cart is minimal (no lines); the full cart is what gets checked and returned.
  let finalCart = result.cart;
  let offers = null;
  let notices: string[] = [];
  try {
    const checked = await revalidateCartOffers(runtime, await cart.get());
    finalCart = checked.cart ?? finalCart;
    offers = checked.view;
    notices = [...(checked.view?.notices ?? [])];
  } catch (error) {
    console.error(
      'Cart revalidation failed:',
      error instanceof Error ? error.message : 'unknown error',
    );
  }

  const cartId = finalCart?.id;
  const headers = noStoreHeaders(cartId ? cart.setCartId(cartId) : undefined);
  const errors = result.errors;
  const warnings = [
    ...(result.warnings ?? []),
    ...partial.map((message) => ({message})),
    ...notices.map((message) => ({message})),
  ];

  let status = 200;
  const redirectTo = formData.get('redirectTo');
  if (typeof redirectTo === 'string') {
    status = 303;
    headers.set('Location', safeRedirectPath(redirectTo, '/cart'));
  }

  return data(
    {cart: finalCart, errors, warnings, offers, analytics: {cartId}},
    {status, headers},
  );
}

export async function loader({context, request}: Route.LoaderArgs) {
  const current = await context.cart.get();
  // The page shows the repaired cart and the reasons for any repair or refusal. A failed check shows the
  // cart as Shopify has it; the hand-off still revalidates.
  try {
    const checked = await revalidateCartOffers(
      await offerRuntimeOf(context, request),
      current,
    );
    return data(
      {cart: checked.cart, offers: checked.view},
      {headers: noStoreHeaders()},
    );
  } catch (error) {
    console.error(
      'Cart revalidation failed:',
      error instanceof Error ? error.message : 'unknown error',
    );
    return data({cart: current, offers: null}, {headers: noStoreHeaders()});
  }
}

export default function Cart() {
  const {cart, offers} = useLoaderData<typeof loader>();

  return (
    <div className="py-6">
      <h1 className="text-3xl font-bold">Your cart</h1>
      <CartMain layout="page" cart={cart} offers={offers} />
    </div>
  );
}
