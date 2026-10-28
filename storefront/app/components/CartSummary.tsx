import type {ReactNode} from 'react';
import type {OptimisticCart} from '~/lib/hydrogen/cart-form';
import type {CartApiQueryFragment} from 'storefrontapi.generated';
import {LockIcon} from '~/components/cart/CartArt';
import {CartDiscount} from '~/components/cart/CartDiscount';
import {deliverySummary, totalView} from '~/components/cart/cart-view';
import {FinancingMessage} from '~/components/cart/FinancingMessage';
import type {CartLayout} from '~/components/CartMain';
import {Button} from '~/components/ui/Button';
import {Card} from '~/components/ui/Card';
import {cn} from '~/components/ui/cn';
import {AlertIcon, CheckIcon} from '~/components/ui/Icons';
import {Price} from '~/components/ui/Price';
import {Skeleton} from '~/components/ui/Skeleton';
import {CHECKOUT_STEPS_PATH, getCheckoutHref} from '~/lib/cart/checkout';
import {subtotalView, type SubtotalView} from '~/lib/cart/subtotal';
import {REASSURANCE_ITEMS} from '~/lib/navigation';
import {useLeavingPage} from '~/lib/use-leaving-page';
import type {FreeDeliveryProgress} from '~/lib/offers/types';
import type {BlockReason} from '~/lib/offers-runtime/messages';

type CartSummaryProps = {
  cart: OptimisticCart<CartApiQueryFragment | null>;
  layout: CartLayout;
  /** Free-delivery progress from the offer engine; decides the delivery row. Absent until the offers view has loaded. */
  freeDelivery?: FreeDeliveryProgress | null;
  /** Why checkout is withheld, from the server's revalidation (REQ-PRE-006); empty or absent when it may proceed. */
  blocked?: readonly BlockReason[];
};

/**
 * Totals and the checkout button. The subtotal and the estimated total are Shopify's, shown as returned; taxes, delivery and
 * discount allocation are calculated by Shopify at checkout, so the page says so instead of estimating.
 * "Checkout securely" opens the server gate (`CHECKOUT_STEPS_PATH`), which revalidates the cart and asks the
 * pre-checkout questions before redirecting to Shopify (P4-09, P4-11). `getCheckoutHref` withholds the
 * link when revalidation found a violation, and the reason is shown instead.
 *
 * Three looks of the same data (CR-31): on the page from `lg` a raised card in the right column; on a phone the same card
 * without its button plus a sticky bottom bar that keeps the total and the checkout button in reach; in the drawer a footer
 * pinned under the lines.
 */
export function CartSummary({
  cart,
  layout,
  freeDelivery,
  blocked = [],
}: CartSummaryProps) {
  const subtotal = subtotalView(cart);
  const total = totalView(cart);
  const optimistic = Boolean(cart?.isOptimistic);
  const state = checkoutStateOf(cart, blocked);
  const delivery = deliverySummary(freeDelivery);
  const headingId = `cart-summary-heading-${layout}`;
  const financing = (
    <FinancingMessage
      placement="cart"
      amount={subtotal.status === 'ready' ? subtotal.amount : null}
    />
  );

  if (layout === 'aside') {
    return (
      <section
        aria-labelledby={headingId}
        // Inside the drawer's padded scroller: it bleeds to the panel edges and sticks to the bottom (the shell's `footer` prop
        // would do the same job; this keeps the cart independent of it).
        className="sticky bottom-0 z-10 -mx-4 -mb-4 mt-auto flex flex-col gap-2 border-t border-line bg-surface p-4 shadow-md"
      >
        <h3 id={headingId} className="sr-only">
          Order summary
        </h3>
        {financing}
        {/* Estimated total at the left, checkout button at the right (the cart page's "View full cart" is in the drawer header),
            then the delivery and tax note under the button. A blocked or unavailable cart shows its message full width instead,
            so the alert never sits in a narrow column. */}
        {state === 'ready' ? (
          <div className="flex items-center gap-4">
            <EstimatedTotal total={total} className="shrink-0" />
            <CheckoutPanel
              state={state}
              blocked={blocked}
              optimistic={optimistic}
              buttonSize="md"
              className="min-w-0 flex-1"
            />
          </div>
        ) : (
          <>
            <EstimatedTotal total={total} />
            <CheckoutPanel
              state={state}
              blocked={blocked}
              optimistic={optimistic}
            />
          </>
        )}
        <p className="text-center text-xs text-fg-muted">
          {delivery.free
            ? 'Delivery is free. Tax is calculated at checkout.'
            : 'Delivery and tax are calculated at checkout.'}
        </p>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-4 lg:sticky lg:top-6">
      <Card
        as="section"
        variant="raised"
        aria-labelledby={headingId}
        className="flex flex-col gap-5 lg:p-7"
      >
        <h2 id={headingId} className="type-display text-xl md:text-2xl">
          Order summary
        </h2>
        <dl className="flex flex-col gap-3 text-base">
          <SubtotalRow subtotal={subtotal} />
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-fg-muted">Delivery</dt>
            <dd
              className={cn(
                'font-bold',
                delivery.free ? 'text-success-fg' : 'text-fg',
              )}
            >
              {delivery.text}
            </dd>
          </div>
        </dl>
        <div>
          <dl className="flex items-baseline justify-between gap-3 border-t-2 border-ink-900 pt-5">
            <dt className="text-lg font-extrabold">Estimated total</dt>
            <dd>
              {total.status === 'ready' ? (
                <Price price={total.amount} size="lg" stale={total.updating} />
              ) : (
                <Skeleton className="h-9 w-32" />
              )}
            </dd>
          </dl>
          <p className="mt-1 text-right text-sm text-fg-muted">
            Tax is calculated at checkout.
          </p>
        </div>
        <CartDiscount codes={cart?.discountCodes} fold="below-lg" />
        {financing}
        <CheckoutPanel
          state={state}
          blocked={blocked}
          optimistic={optimistic}
          // The phone has the sticky bar; showing both buttons a scroll apart would be noise.
          buttonClassName="max-lg:hidden"
        />
        <p className="text-center text-sm text-fg-muted">
          You pay on Shopify&rsquo;s secure checkout.
        </p>
      </Card>
      <Reassurance />
    </div>
  );
}

type CheckoutState = 'ready' | 'blocked' | 'unavailable';

function checkoutStateOf(
  cart: CartSummaryProps['cart'],
  blocked: readonly BlockReason[],
): CheckoutState {
  if (blocked.length > 0) return 'blocked';
  return getCheckoutHref(cart, {blocked}) || cart?.isOptimistic
    ? 'ready'
    : 'unavailable';
}

function SubtotalRow({subtotal}: {subtotal: SubtotalView}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-fg-muted">Subtotal</dt>
      {/* While Shopify answers there is either an out-of-date amount (kept, in italic, never dimmed: dimming would drop
          the text under 4.5:1) or none (a busy placeholder of the final size): never a bare dash that reads as a
          missing price (RS-02). The status element is always mounted and only its text changes, so a screen reader
          that is already watching it announces "Updating price"; `aria-busy` on the <dd> would not be announced. */}
      <dd className="font-bold">
        {subtotal.status === 'ready' ? (
          <Price price={subtotal.amount} size="md" stale={subtotal.updating} />
        ) : (
          <Skeleton className="h-7 w-24" />
        )}
        <span role="status" className="sr-only">
          {subtotal.status === 'pending' || subtotal.updating
            ? 'Updating price'
            : ''}
        </span>
      </dd>
    </div>
  );
}

/**
 * The drawer's one total. It carries the same always-mounted live region as the subtotal row, so a change in flight is
 * announced as "Updating price" (RS-02).
 */
function EstimatedTotal({
  total,
  className,
}: {
  total: SubtotalView;
  className?: string;
}) {
  return (
    <dl className={className}>
      <div>
        <dt className="block text-xs font-semibold text-fg-muted">
          Estimated total
        </dt>
        <dd>
          {total.status === 'ready' ? (
            <Price price={total.amount} size="md" stale={total.updating} />
          ) : (
            <Skeleton className="h-7 w-24" />
          )}
          <span role="status" className="sr-only">
            {total.status === 'pending' || total.updating
              ? 'Updating price'
              : ''}
          </span>
        </dd>
      </div>
    </dl>
  );
}

/**
 * The block that carries the checkout decision: the "on hold" alert (REQ-PRE-006, ADR-0006), the checkout button, or the
 * reload hint. The button is one element for both the busy and the ready state, so a keyboard user who is focused on it keeps
 * focus when the cart arrives (m5).
 */
function CheckoutPanel({
  state,
  blocked,
  optimistic,
  buttonClassName,
  buttonSize,
  className,
  extra,
}: {
  state: CheckoutState;
  blocked: readonly BlockReason[];
  optimistic: boolean;
  buttonClassName?: string;
  buttonSize?: 'md' | 'lg';
  className?: string;
  extra?: ReactNode;
}) {
  if (state === 'blocked') {
    return (
      <div
        role="alert"
        className="flex flex-col gap-2 rounded-choice bg-error-bg p-3 text-sm text-error-fg"
      >
        <p className="flex items-center gap-2 font-bold">
          <AlertIcon className="size-4" />
          Checkout is on hold
        </p>
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
    );
  }
  if (state === 'unavailable') {
    return (
      <p className="text-sm text-fg-muted">
        Checkout is not available right now. Please reload the page.
      </p>
    );
  }
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <CheckoutButton
        optimistic={optimistic}
        className={buttonClassName}
        size={buttonSize}
      />
      {extra}
    </div>
  );
}

function CheckoutButton({
  optimistic,
  className,
  size = 'lg',
}: {
  optimistic: boolean;
  className?: string;
  size?: 'md' | 'lg';
}) {
  // One link in both states. A first add has no checkout URL until Shopify answers; the control is the same element
  // meanwhile (inert, with a spinner), so a keyboard user who is focused on it keeps focus when the cart arrives.
  // Swapping a busy button for a link would drop focus to the page.
  const leaving = useLeavingPage();
  return (
    <Button
      to={CHECKOUT_STEPS_PATH}
      reloadDocument
      variant="primary"
      size={size}
      fullWidth
      className={cn('whitespace-nowrap', className)}
      loading={optimistic || leaving.active}
      loadingLabel={optimistic ? 'Updating cart' : 'Checking your cart'}
      leadingIcon={<LockIcon />}
      onClick={leaving.start}
    >
      Checkout securely
    </Button>
  );
}

/**
 * Phone page only: the total and the checkout button stay at the foot of the screen while the cart scrolls. It is a sticky
 * element in the page's flow (not fixed), so at the end of the page it rests above the footer and never covers the last
 * content. Its safe-area padding keeps the button clear of a phone's home indicator. CartMain renders it as the last child of
 * the page wrapper, not inside the two-column grid: a sticky item is held inside its own grid area and would not follow
 * the screen.
 */
export function CartCheckoutBar({
  cart,
  blocked = [],
}: Pick<CartSummaryProps, 'cart' | 'blocked'>) {
  const total = totalView(cart);
  const state = checkoutStateOf(cart, blocked);
  const optimistic = Boolean(cart?.isOptimistic);
  return (
    <div className="sticky bottom-0 z-10 -mx-4 flex items-center gap-4 border-t border-line bg-surface px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-lift md:-mx-6 md:px-6 lg:hidden">
      <div className="min-w-24">
        <span className="block text-caption font-semibold text-fg-muted">
          Total
        </span>
        {total.status === 'ready' ? (
          <Price price={total.amount} size="md" stale={total.updating} />
        ) : (
          <Skeleton className="h-7 w-24" />
        )}
      </div>
      {state === 'ready' ? (
        // 48 px in the bar: the 56 px size does not fit beside the total at 360 px without wrapping the label.
        <CheckoutButton optimistic={optimistic} size="md" className="flex-1" />
      ) : (
        // The reason is in the order summary, which holds the alert; this takes the shopper to it.
        <Button
          href="#cart-summary-heading-page"
          variant="outline"
          size="lg"
          className="flex-1"
        >
          See order summary
        </Button>
      )}
    </div>
  );
}

/** Only content the client has published (B-15, REQ-CNT-001): with none supplied, nothing is promised here. */
function Reassurance() {
  if (REASSURANCE_ITEMS.length === 0) return null;
  return (
    <ul className="flex flex-col gap-3 rounded-card border border-line bg-surface px-5 py-4 text-sm font-semibold text-ink-700">
      {REASSURANCE_ITEMS.map((item) => (
        <li key={item.id} className="flex items-center gap-3">
          <CheckIcon className="size-5 text-success-solid" />
          {item.text}
        </li>
      ))}
    </ul>
  );
}
