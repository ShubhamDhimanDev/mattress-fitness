import {CartForm} from '~/lib/hydrogen/cart-form';
import {CartActionForm} from '~/components/cart/CartActionForm';
import {useId, useState} from 'react';
import {Button} from '~/components/ui/Button';
import {cn} from '~/components/ui/cn';
import {AlertIcon, ChevronDownIcon, TagIcon} from '~/components/ui/Icons';
import {Input} from '~/components/ui/Input';

type DiscountCode = {readonly code: string; readonly applicable: boolean};

/**
 * Where the code field lives: always open (the desktop summary), folded under a disclosure below the `lg` breakpoint (the
 * phone page), or folded at every width (the drawer, which is short on room).
 */
export type DiscountFold = 'never' | 'below-lg' | 'always';

/**
 * Discount code field (REQ-CART-001). The code is checked by Shopify, never by us: a code that does not
 * apply stays in the list marked as such (icon and words, not colour alone) so the shopper can see why nothing
 * changed, and can remove it. Amounts come back in the cart totals; nothing here computes a discount.
 */
export function CartDiscount({
  codes,
  fold = 'never',
}: {
  codes: readonly DiscountCode[] | undefined;
  fold?: DiscountFold;
}) {
  const listId = useId();
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const applied = codes ?? [];
  // A code already on the cart keeps its row visible even when the field is folded: it is state, not an input.
  const hiddenClass =
    fold === 'always' ? 'hidden' : fold === 'below-lg' ? 'hidden lg:block' : '';

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
                <div
                  className={cn(
                    'flex items-center justify-between gap-2 rounded-choice py-1 pr-1 pl-3',
                    discount.applicable ? 'bg-accent-50' : 'bg-error-bg',
                  )}
                >
                  <span
                    className={cn(
                      'flex min-w-0 items-center gap-2 text-sm',
                      discount.applicable ? 'text-sale-fg' : 'text-error-fg',
                    )}
                  >
                    {discount.applicable ? (
                      <TagIcon className="size-4" />
                    ) : (
                      <AlertIcon className="size-4" />
                    )}
                    <span className="min-w-0">
                      <code className="font-extrabold">{discount.code}</code>
                      <span className="block font-bold">
                        {discount.applicable
                          ? 'Applied'
                          : 'This code does not apply to your cart'}
                      </span>
                    </span>
                  </span>
                  <Button
                    type="submit"
                    variant="link"
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

      {fold !== 'never' ? (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
          className={cn(
            'flex w-full items-center justify-between gap-2 border-t border-line text-left',
            // The drawer's fold is a quiet muted row; the phone page's is a bold one.
            fold === 'always'
              ? 'min-h-11 text-sm font-semibold text-fg-muted'
              : 'min-h-13 text-base font-bold text-fg',
            fold === 'below-lg' && 'lg:hidden',
          )}
        >
          Add a discount code
          <ChevronDownIcon
            className={cn(
              'size-5 motion-safe:transition-transform',
              open && 'rotate-180',
            )}
          />
        </button>
      ) : null}

      <div id={panelId} className={open ? undefined : hiddenClass}>
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
                variant="outline"
                // Flex item: shrink-0 keeps "Apply" whole beside the flexible input; h-13 matches the field's height.
                className="h-13 shrink-0"
                loading={fetcher.state !== 'idle'}
                loadingLabel="Applying"
              >
                Apply
              </Button>
            </div>
          )}
        </CartActionForm>
      </div>
    </section>
  );
}
