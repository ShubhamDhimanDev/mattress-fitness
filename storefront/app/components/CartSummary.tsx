import type {ReactNode} from 'react';
import type {OptimisticCart} from '@shopify/hydrogen';
import type {CartApiQueryFragment} from 'storefrontapi.generated';
import {CartDiscount} from '~/components/cart/CartDiscount';
import type {CartLayout} from '~/components/CartMain';
import {Button} from '~/components/ui/Button';
import {cn} from '~/components/ui/cn';
import {Price} from '~/components/ui/Price';
import {Skeleton} from '~/components/ui/Skeleton';
import {CHECKOUT_STEPS_PATH, getCheckoutHref} from '~/lib/cart/checkout';
import {subtotalView} from '~/lib/cart/subtotal';
import type {BlockReason} from '~/lib/offers-runtime/messages';

type CartSummaryProps = {
  cart: OptimisticCart<CartApiQueryFragment | null>;
  layout: CartLayout;
  /** Free-delivery progress message (REQ-CART-004, P4-07). Renders nothing until that task fills it. */
  freeDeliverySlot?: ReactNode;
  /** Why checkout is withheld, from the server's revalidation (REQ-PRE-006); empty or absent when it may proceed. */
  blocked?: readonly BlockReason[];
};

/**
 * Totals and the checkout button. The subtotal is Shopify's, shown as returned; taxes, delivery and
 * discount allocation are calculated by Shopify at checkout, so the page says so instead of estimating.
 * "Checkout" opens the server gate (`CHECKOUT_STEPS_PATH`), which revalidates the cart and asks the
 * pre-checkout questions before redirecting to Shopify (P4-09, P4-11). `getCheckoutHref` withholds the
 * link when revalidation found a violation, and the reason is shown instead.
 */
export function CartSummary({
  cart,
  layout,
  freeDeliverySlot,
  blocked = [],
}: CartSummaryProps) {
  const subtotal = subtotalView(cart);
  const checkoutHref = getCheckoutHref(cart, {blocked});
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
        className="type-display text-lg"
      >
        Order summary
      </Heading>

      {freeDeliverySlot}

      <CartDiscount codes={cart?.discountCodes} />

      <dl className="flex items-baseline justify-between gap-2">
        <dt className="text-base font-bold">Subtotal</dt>
        {/* While Shopify answers there is either an out-of-date amount (kept, in italic, never dimmed: dimming would drop
            the text under 4.5:1) or none (a busy placeholder of the final size): never a bare dash that reads as a
            missing price (RS-02). The status element is always mounted and only its text changes, so a screen reader
            that is already watching it announces "Updating price"; `aria-busy` on the <dd> would not be announced. */}
        <dd>
          {subtotal.status === 'ready' ? (
            <Price
              price={subtotal.amount}
              size="md"
              stale={subtotal.updating}
            />
          ) : (
            <Skeleton className="h-7 w-24" />
          )}
          <span role="status" className="sr-only">
            {subtotal.status === 'pending' || subtotal.updating
              ? 'Updating price'
              : ''}
          </span>
        </dd>
      </dl>
      <p className="text-sm text-fg-muted">
        Taxes, delivery and any discounts are calculated at checkout.
      </p>

      {blocked.length > 0 ? (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-choice bg-error-bg p-3 text-sm text-error-fg"
        >
          <p className="font-bold">Checkout is on hold</p>
          <ul className="list-disc pl-5">
            {blocked.map((reason) => (
              <li key={`${reason.code}:${reason.lineIds.join(',')}`}>
                {reason.message}
              </li>
            ))}
          </ul>
          {/* A cart that could not be checked is usually a passing problem: offer the retry (review of d068db6, item E). */}
          {blocked.some((reason) => reason.code === 'unverified') ? (
            <Button
              to="/cart"
              reloadDocument
              variant="secondary"
              size="sm"
              className="self-start"
            >
              Try again
            </Button>
          ) : null}
        </div>
      ) : checkoutHref || cart?.isOptimistic ? (
        // One link in both states. A first add has no checkout URL until Shopify answers; the control is the same
        // element meanwhile (inert, with a spinner), so a keyboard user who is focused on it keeps focus when the
        // cart arrives. Swapping a busy button for a link would drop focus to the page.
        <Button
          to={CHECKOUT_STEPS_PATH}
          reloadDocument
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
