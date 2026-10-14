import {CartForm} from '@shopify/hydrogen';
import {CartActionForm} from '~/components/cart/CartActionForm';
import {useId} from 'react';
import {Button} from '~/components/ui/Button';
import {Input} from '~/components/ui/Input';

type DiscountCode = {readonly code: string; readonly applicable: boolean};

/**
 * Discount code field (REQ-CART-001). The code is checked by Shopify, never by us: a code that does not
 * apply stays in the list marked as such so the shopper can see why nothing changed, and can remove it.
 * Amounts come back in the cart totals; nothing here computes a discount.
 */
export function CartDiscount({
  codes,
}: {
  codes: readonly DiscountCode[] | undefined;
}) {
  const listId = useId();
  const applied = codes ?? [];

  return (
    <section aria-label="Discount code" className="flex flex-col gap-3">
      {applied.length > 0 ? (
        <ul id={listId} className="flex flex-col gap-2">
          {applied.map((discount) => (
            <li key={discount.code}>
              <CartActionForm
                route="/cart"
                action={CartForm.ACTIONS.DiscountCodesUpdate}
                inputs={{
                  discountCodes: applied
                    .filter((other) => other.code !== discount.code)
                    .map((other) => other.code),
                }}
              >
                <div className="flex items-center justify-between gap-2 rounded-choice bg-surface-muted px-3 py-1">
                  <span className="text-sm">
                    <code className="font-bold">{discount.code}</code>
                    <span className="block text-fg-muted">
                      {discount.applicable
                        ? 'Applied'
                        : 'This code does not apply to your cart'}
                    </span>
                  </span>
                  <Button
                    type="submit"
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove discount code ${discount.code}`}
                  >
                    Remove
                  </Button>
                </div>
              </CartActionForm>
            </li>
          ))}
        </ul>
      ) : null}

      <CartActionForm
        route="/cart"
        action={CartForm.ACTIONS.DiscountCodesUpdate}
        inputs={{discountCodes: applied.map((discount) => discount.code)}}
      >
        {(fetcher) => (
          <div className="flex items-end gap-2">
            <Input
              label="Discount code"
              name="discountCode"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={64}
              className="flex-1"
            />
            <Button
              type="submit"
              variant="secondary"
              loading={fetcher.state !== 'idle'}
              loadingLabel="Applying"
            >
              Apply
            </Button>
          </div>
        )}
      </CartActionForm>
    </section>
  );
}
