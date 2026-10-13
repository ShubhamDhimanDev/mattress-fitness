import {useLoaderData, data, type HeadersFunction} from 'react-router';
import type {Route} from './+types/cart';
import type {CartQueryDataReturn} from '@shopify/hydrogen';
import {CartForm} from '@shopify/hydrogen';
import {CartMain} from '~/components/CartMain';
import {formatPageTitle} from '~/components/layout/documentTitle';
import {
  validateAddLines,
  validateDiscountCodes,
  validateLineIds,
  validateUpdateLines,
} from '~/lib/cart/actions';
import {safeRedirectPath} from '~/lib/cart/input';

export const meta: Route.MetaFunction = () => [
  {title: formatPageTitle('Your cart')},
  {name: 'robots', content: 'noindex'},
];

export const headers: HeadersFunction = ({actionHeaders}) => actionHeaders;

function rejected(message: string) {
  return data(
    {
      cart: null,
      errors: [{message}],
      warnings: [],
      analytics: {cartId: undefined},
    },
    {status: 400},
  );
}

/**
 * The one cart endpoint (REQ-CART-001). Every input is validated first (T-01): the browser may name
 * variants, lines, quantities and discount codes, nothing else, and Shopify prices the result. Mutations
 * go through Hydrogen's cart handler; `errors` (userErrors) and `warnings` are returned to the page so a
 * partial failure is visible.
 */
export async function action({request, context}: Route.ActionArgs) {
  const {cart} = context;
  const formData = await request.formData();

  let parsed: ReturnType<typeof CartForm.getFormInput>;
  try {
    parsed = CartForm.getFormInput(formData);
  } catch {
    return rejected('That request could not be read.');
  }
  const {action, inputs} = parsed;

  let result: CartQueryDataReturn;
  switch (action) {
    case CartForm.ACTIONS.LinesAdd: {
      const lines = validateAddLines(inputs.lines);
      if (lines.status === 'invalid') return rejected(lines.reason);
      result = await cart.addLines(lines.value);
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
    default:
      return rejected('That cart action is not supported.');
  }

  const cartId = result?.cart?.id;
  const headers = cartId ? cart.setCartId(cartId) : new Headers();
  const {cart: cartResult, errors, warnings} = result;

  let status = 200;
  const redirectTo = formData.get('redirectTo');
  if (typeof redirectTo === 'string') {
    status = 303;
    headers.set('Location', safeRedirectPath(redirectTo, '/cart'));
  }

  return data(
    {cart: cartResult, errors, warnings, analytics: {cartId}},
    {status, headers},
  );
}

export async function loader({context}: Route.LoaderArgs) {
  return await context.cart.get();
}

export default function Cart() {
  const cart = useLoaderData<typeof loader>();

  return (
    <div className="py-6">
      <h1 className="text-3xl font-bold">Your cart</h1>
      <CartMain layout="page" cart={cart} />
    </div>
  );
}
