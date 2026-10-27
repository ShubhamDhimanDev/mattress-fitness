import {CartForm} from '~/lib/hydrogen/cart-form';
import {CartActionForm} from '~/components/cart/CartActionForm';
import {useCartSubmit} from '~/components/cart/useCartSubmit';
import {Button} from '~/components/ui/Button';
import {cn} from '~/components/ui/cn';
import {TrashIcon} from '~/components/ui/Icons';
import {QuantityStepper} from '~/components/ui/QuantityStepper';
import {MAX_LINE_QUANTITY} from '~/lib/cart/input';

/** The two controls every cart line carries. Both post to `/cart`; the server validates and Shopify prices the result. */

export function LineQuantity({
  line,
  title,
  size,
}: {
  line: {
    readonly id: string;
    readonly quantity: number;
    readonly isOptimistic?: boolean | null;
  };
  title: string;
  size?: 'md' | 'sm';
}) {
  const {submit} = useCartSubmit(`cart-line-${line.id}`);
  return (
    <QuantityStepper
      value={line.quantity}
      min={1}
      max={MAX_LINE_QUANTITY}
      itemName={title}
      disabled={Boolean(line.isOptimistic)}
      size={size}
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
  iconOnly = false,
}: {
  lineId: string;
  title: string;
  disabled: boolean;
  onRemove: () => void;
  className?: string;
  /** The drawer's trash icon instead of the word; the accessible name is the same. */
  iconOnly?: boolean;
}) {
  if (iconOnly) {
    return (
      <CartActionForm
        route="/cart"
        action={CartForm.ACTIONS.LinesRemove}
        inputs={{lineIds: [lineId]}}
      >
        <button
          type="submit"
          disabled={disabled}
          aria-label={`Remove ${title} from cart`}
          onClick={onRemove}
          className={cn(
            'inline-flex size-11 items-center justify-center rounded-pill text-fg-muted motion-safe:transition-colors hover:bg-paper hover:text-error-fg disabled:cursor-not-allowed disabled:opacity-60',
            className,
          )}
        >
          <TrashIcon className="size-5" />
        </button>
      </CartActionForm>
    );
  }
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
