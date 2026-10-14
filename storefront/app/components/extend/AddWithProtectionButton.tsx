import {CartForm} from '@shopify/hydrogen';
import {Button} from '~/components/ui/Button';
import {ADD_WITH_PROTECTION_ACTION} from '~/lib/cart/custom-actions';

/**
 * Add the item AND its chosen protection plan in one submission through the shared `/cart` action (P5A-05). It carries a
 * variant id, a quantity and a plan key only; the server re-quotes the plan, picks the coverage variant and price from
 * its own catalog and nests the coverage line under the item. There is no optimistic line: the cart appears when the
 * server has answered, because the server may refuse the plan.
 */
export function AddWithProtectionButton({
  variantId,
  planKey,
  disabled = false,
  onClick,
}: {
  variantId: string;
  planKey: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <CartForm
      route="/cart"
      inputs={{variantId, quantity: 1, planKey}}
      action={ADD_WITH_PROTECTION_ACTION}
    >
      {(fetcher) => (
        <Button
          type="submit"
          variant="accent"
          size="lg"
          fullWidth
          disabled={disabled}
          loading={fetcher.state !== 'idle'}
          loadingLabel="Adding to cart"
          onClick={onClick}
        >
          Add to cart with protection
        </Button>
      )}
    </CartForm>
  );
}
