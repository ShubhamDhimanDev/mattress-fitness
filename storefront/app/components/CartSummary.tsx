import type {ReactNode} from 'react';
import type {OptimisticCart} from '@shopify/hydrogen';
import type {CartApiQueryFragment} from 'storefrontapi.generated';
import {CartDiscount} from '~/components/cart/CartDiscount';
import type {CartLayout} from '~/components/CartMain';
import {Button} from '~/components/ui/Button';
import {cn} from '~/components/ui/cn';
import {Price} from '~/components/ui/Price';
import {getCheckoutHref} from '~/lib/cart/checkout';

type CartSummaryProps = {
  cart: OptimisticCart<CartApiQueryFragment | null>;
  layout: CartLayout;
  /** Free-delivery progress message (REQ-CART-004, P4-07). Renders nothing until that task fills it. */
  freeDeliverySlot?: ReactNode;
};

/**
 * Totals and the checkout button. The subtotal is Shopify's, shown as returned; taxes, delivery and
 * discount allocation are calculated by Shopify at checkout, so the page says so instead of estimating.
 * "Checkout" goes through `getCheckoutHref`, the one place the pre-checkout steps will be added (P4-11).
 */
export function CartSummary({
  cart,
  layout,
  freeDeliverySlot,
}: CartSummaryProps) {
  const subtotal = cart?.cost?.subtotalAmount;
  const checkoutHref = getCheckoutHref(cart);
  const Heading = layout === 'page' ? 'h2' : 'h3';

  return (
    <section
      aria-labelledby={`cart-summary-heading-${layout}`}
      className={cn(
        'flex flex-col gap-4 bg-surface',
        layout === 'page'
          ? 'rounded-panel border border-line p-4 lg:sticky lg:top-4'
          : 'sticky bottom-0 -mx-4 -mb-4 border-t border-line p-4 shadow-md',
      )}
    >
      <Heading
        id={`cart-summary-heading-${layout}`}
        className="text-lg font-bold"
      >
        Order summary
      </Heading>

      {freeDeliverySlot}

      <CartDiscount codes={cart?.discountCodes} />

      <dl className="flex items-baseline justify-between gap-2">
        <dt className="text-base font-bold">Subtotal</dt>
        <dd>
          {subtotal?.amount && subtotal.currencyCode ? (
            <Price
              price={{
                amount: subtotal.amount,
                currencyCode: subtotal.currencyCode,
              }}
              size="md"
            />
          ) : (
            <span>-</span>
          )}
        </dd>
      </dl>
      <p className="text-sm text-fg-muted">
        Taxes, delivery and any discounts are calculated at checkout.
      </p>

      {checkoutHref ? (
        <Button
          href={checkoutHref}
          variant="primary"
          size="lg"
          fullWidth
          loading={Boolean(cart?.isOptimistic)}
          loadingLabel="Updating cart"
        >
          Checkout
        </Button>
      ) : (
        <p className="text-sm text-fg-muted">
          Checkout is not available right now. Please reload the page.
        </p>
      )}
    </section>
  );
}
