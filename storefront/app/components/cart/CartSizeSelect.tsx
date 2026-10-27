import {useCartSubmit} from '~/components/cart/useCartSubmit';
import {Select} from '~/components/ui/Select';
import {CHANGE_SIZE_ACTION} from '~/lib/cart/custom-actions';
import type {SizeChoice} from '~/lib/offers-runtime/view';

/**
 * Size swap on a cart line (REQ-CART-001). Only sizes of the same product the server listed are offered; the
 * server checks the choice again (same product, in stock, a regular line) before it changes anything, and
 * keeps the line's quantity. Sold-out sizes are shown but cannot be chosen.
 */
export function CartSizeSelect({
  lineId,
  title,
  currentVariantId,
  choices,
  disabled,
  className,
}: {
  lineId: string;
  title: string;
  currentVariantId: string;
  choices: readonly SizeChoice[];
  disabled: boolean;
  /** Layout only (width, placement); the control's own look comes from the shared Select. */
  className?: string;
}) {
  const {submit, pending} = useCartSubmit(`cart-size-${lineId}`);
  return (
    <Select
      label={`Size of ${title}`}
      className={className}
      value={currentVariantId}
      disabled={disabled || pending}
      options={choices.map((choice) => ({
        value: choice.variantId,
        label: choice.available ? choice.size : `${choice.size} (sold out)`,
        disabled: !choice.available && choice.variantId !== currentVariantId,
      }))}
      onChange={(event) => {
        if (event.target.value !== currentVariantId) {
          submit(CHANGE_SIZE_ACTION, {
            lineId,
            merchandiseId: event.target.value,
          });
        }
      }}
    />
  );
}
