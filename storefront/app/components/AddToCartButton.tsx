import {type OptimisticCartLineInput, CartForm} from '~/lib/hydrogen/cart-form';
import {CartActionForm} from '~/components/cart/CartActionForm';
import type {ReactNode} from 'react';
import {Button} from '~/components/ui/Button';

/**
 * Add to cart through the shared `/cart` action. The line carries a variant id and a quantity only;
 * Shopify prices it, and the action validates both (T-01). The `selectedVariant` on a line is used by
 * Hydrogen's optimistic cart for display and is stripped before anything reaches Shopify.
 */
export function AddToCartButton({
  children,
  disabled = false,
  lines,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  lines: OptimisticCartLineInput[];
  onClick?: () => void;
}) {
  return (
    <CartActionForm
      route="/cart"
      inputs={{lines}}
      action={CartForm.ACTIONS.LinesAdd}
    >
      {(fetcher) => (
        <Button
          type="submit"
          variant="primary"
          size="lg"
          fullWidth
          disabled={disabled}
          loading={fetcher.state !== 'idle'}
          loadingLabel="Adding to cart"
          onClick={onClick}
        >
          {children}
        </Button>
      )}
    </CartActionForm>
  );
}
