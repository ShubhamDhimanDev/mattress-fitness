import {CartForm} from '~/lib/hydrogen/cart-form';
import {CartActionForm} from '~/components/cart/CartActionForm';
import {useCartSubmit} from '~/components/cart/useCartSubmit';
import {Button} from '~/components/ui/Button';
import {QuantityStepper} from '~/components/ui/QuantityStepper';
import {MAX_LINE_QUANTITY} from '~/lib/cart/input';

/** The two controls every cart line carries. Both post to `/cart`; the server validates and Shopify prices the result. */

export function LineQuantity({
  line,
  title,
}: {
  line: {
    readonly id: string;
    readonly quantity: number;
    readonly isOptimistic?: boolean | null;
  };
  title: string;
}) {
  const {submit} = useCartSubmit(`cart-line-${line.id}`);
  return (
    <QuantityStepper
      value={line.quantity}
      min={1}
      max={MAX_LINE_QUANTITY}
      itemName={title}
      disabled={Boolean(line.isOptimistic)}
      onChange={(quantity) =>
        submit(CartForm.ACTIONS.LinesUpdate, {
          lines: [{id: line.id, quantity}],
        })
      }
    />
  );
}

export function RemoveButton({
  lineId,
  title,
  disabled,
  onRemove,
  className,
}: {
  lineId: string;
  title: string;
  disabled: boolean;
  onRemove: () => void;
  className?: string;
}) {
  return (
    <CartActionForm
      route="/cart"
      action={CartForm.ACTIONS.LinesRemove}
      inputs={{lineIds: [lineId]}}
    >
      <Button
        type="submit"
        variant="link"
        size="sm"
        className={className}
        disabled={disabled}
        aria-label={`Remove ${title} from cart`}
        onClick={onRemove}
      >
        Remove
      </Button>
    </CartActionForm>
  );
}
