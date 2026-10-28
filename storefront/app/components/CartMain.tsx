import {useOptimisticCart} from '~/lib/hydrogen/cart-form';
import {useEffect, useId, useRef, type ReactNode, type RefObject} from 'react';
import type {CartApiQueryFragment} from 'storefrontapi.generated';
import {useAside} from '~/components/Aside';
import {EmptyCartArt} from '~/components/cart/CartArt';
import {CartDiscount} from '~/components/cart/CartDiscount';
import {CartMessages} from '~/components/cart/CartMessages';
import {CartOffers} from '~/components/cart/CartOffers';
import {itemCountText} from '~/components/cart/cart-view';
import {DeliveryCheck} from '~/components/delivery/DeliveryCheck';
import {FreeDeliveryProgress} from '~/components/cart/FreeDeliveryProgress';
import {useCartOffers} from '~/components/cart/useCartOffers';
import {CartLineItem, type CartLine} from '~/components/CartLineItem';
import {CartCheckoutBar, CartSummary} from '~/components/CartSummary';
import {Button} from '~/components/ui/Button';
import {Card} from '~/components/ui/Card';
import {cn} from '~/components/ui/cn';
import {SLEEP_QUIZ_LINK} from '~/lib/navigation';
import type {
  CartOffersView,
  ProtectionLineView,
} from '~/lib/offers-runtime/view';

export type CartLayout = 'page' | 'aside';

export type CartMainProps = {
  cart: CartApiQueryFragment | null;
  layout: CartLayout;
  /**
   * The offers view from the page loader. The drawer passes none and gets its view from cart action results
   * or a load of `/cart` while it is open (useCartOffers).
   */
  offers?: CartOffersView | null;
  /** Extension points for the pre-checkout work; each renders nothing until its task fills it. */
  slots?: {
    /** Free-delivery progress (REQ-CART-004, P4-07). */
    freeDelivery?: ReactNode;
    /** Size-matched add-ons, gifts and bundles (REQ-CART-002, REQ-CART-003, P4-04). */
    offers?: ReactNode;
  };
};

export type LineItemChildrenMap = {[parentId: string]: CartLine[]};

/** Lines grouped under the line they belong to (nested cart lines, F-26). */
/** Nested lines carry their parent; bundle-component lines do not have the field at all. */
function parentIdOf(line: CartLine): string | undefined {
  return 'parentRelationship' in line
    ? (line.parentRelationship?.parent.id ?? undefined)
    : undefined;
}

function getLineItemChildrenMap(lines: CartLine[]): LineItemChildrenMap {
  const children: LineItemChildrenMap = {};
  for (const line of lines) {
    const parentId = parentIdOf(line);
    if (parentId) {
      (children[parentId] ??= []).push(line);
    }
  }
  return children;
}

/** The server's protection quotes by the id of the line each one covers, so a card can show its own offer. */
function protectionByLine(
  offers: CartOffersView | null,
): Readonly<Record<string, ProtectionLineView>> {
  const byLine: Record<string, ProtectionLineView> = {};
  for (const line of offers?.accidentProtection?.lines ?? []) {
    byLine[line.lineId] = line;
  }
  return byLine;
}

/**
 * The cart, in the drawer and on the page (REQ-CART-001). `useOptimisticCart` applies pending changes so
 * the shopper sees them at once; the server result replaces them when it arrives, and any error or
 * warning Shopify returns is shown in `CartMessages`.
 *
 * Layouts (CR-31): the page is one column on a phone and two from `lg` (lines and offers left, a sticky summary right); the
 * drawer is a compact column with the progress strip on top and a summary footer pinned under the lines.
 */
export function CartMain({
  layout,
  cart: originalCart,
  offers: providedOffers,
  slots,
}: CartMainProps) {
  const cart = useOptimisticCart(originalCart);
  const {type: asideType} = useAside();
  const offers = useCartOffers({
    cartUpdatedAt: originalCart?.updatedAt,
    provided: providedOffers,
    active: layout === 'page' || asideType === 'cart',
  });
  const linesRegion = useRef<HTMLDivElement>(null);
  const headingId = useId();
  // True once this cart view has shown items, so an empty state that follows a removal can take focus (A11Y-002).
  const hadItems = useRef(false);
  const lines = cart?.lines?.nodes ?? [];
  const hasItems = (cart?.totalQuantity ?? 0) > 0 && lines.length > 0;
  const childrenMap = getLineItemChildrenMap(lines);
  const Heading = layout === 'page' ? 'h2' : 'h3';
  const aside = layout === 'aside';

  useEffect(() => {
    if (hasItems) hadItems.current = true;
  }, [hasItems]);

  if (!hasItems) {
    return (
      <>
        <CartMessages />
        <CartEmpty layout={layout} takeFocus={hadItems} />
      </>
    );
  }

  const topLevel = lines.filter((line) => !parentIdOf(line));
  const protection = protectionByLine(offers);
  const choice = offers?.deliveryChoice;
  const deliveryChoice = choice?.status === 'answered' ? choice.choice : null;
  const focusLines = () => linesRegion.current?.focus();

  const progress =
    slots?.freeDelivery ??
    (offers ? (
      <FreeDeliveryProgress
        progress={offers.freeDelivery}
        layout={layout}
        className={aside ? '-mx-4 -mt-4 mb-4' : undefined}
      />
    ) : null);

  const linesList = (
    // After a line is removed its buttons are gone; focus lands here so keyboard users keep their place.
    <div
      ref={linesRegion}
      tabIndex={-1}
      role="region"
      aria-labelledby={headingId}
    >
      <Heading id={headingId} className="sr-only">
        Items in your cart ({cart?.totalQuantity})
      </Heading>
      <ul
        aria-label="Cart items"
        className={cn('flex flex-col', !aside && 'gap-5')}
      >
        {topLevel.map((line) => (
          <CartLineItem
            key={line.id}
            line={line}
            layout={layout}
            childrenMap={childrenMap}
            lineSizes={offers?.lineSizes}
            protection={protection}
            deliveryChoice={deliveryChoice}
            onRemove={focusLines}
          />
        ))}
      </ul>
    </div>
  );

  const offersBlock =
    slots?.offers ??
    (offers ? (
      <CartOffers
        view={offers}
        layout={layout}
        onAdded={focusLines}
        // Plans are drawn in the cards of the items they cover; an offer for a line with no card here still shows.
        protectionPlacedFor={new Set(topLevel.map((line) => line.id))}
        className={aside ? 'mt-5' : undefined}
      />
    ) : null);

  if (aside) {
    return (
      <div className="flex min-h-full flex-col">
        <CartMessages />
        {progress}
        {linesList}
        {offersBlock}
        {/* The ZIP decides the in-home and recycling offers at checkout (P3B-11, P5B-04). */}
        <DeliveryCheck className="mt-5" />
        <CartDiscount codes={cart?.discountCodes} fold="always" />
        <CartSummary
          cart={cart}
          layout={layout}
          blocked={offers?.blocked}
          freeDelivery={offers?.freeDelivery}
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        // Phone: the sticky checkout bar covers the foot of the screen, so a focused control scrolls clear of it (WCAG 2.4.11).
        'max-lg:[&_:is(a,button,input,select,summary,[tabindex])]:scroll-mb-32',
      )}
    >
      <div className="mt-2 mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <p className="text-base text-fg-muted md:text-lead">
          {itemCountText(cart?.totalQuantity)}. Delivery and tax are calculated
          at checkout.
        </p>
        <ol
          aria-label="Checkout steps"
          className="hidden items-center gap-3 text-sm font-bold lg:flex"
        >
          <li aria-current="step" className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-pill bg-primary-500 text-caption text-white">
              1
            </span>
            Cart
          </li>
          <li aria-hidden="true" className="h-0.5 w-9 bg-ink-300" />
          <li className="flex items-center gap-2 text-fg-muted">
            <span className="flex size-7 items-center justify-center rounded-pill border-2 border-line-strong text-caption">
              2
            </span>
            Secure checkout (Shopify)
          </li>
        </ol>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_var(--container-drawer)] lg:items-start lg:gap-8">
        <div className="min-w-0 [&>:last-child]:mb-0 [&>:not(:first-child)]:mb-5">
          <CartMessages />
          {progress}
          {linesList}
          {/* The ZIP decides the in-home and recycling offers at checkout (P3B-11, P5B-04). */}
          <DeliveryCheck />
          {offersBlock}
        </div>
        <CartSummary
          cart={cart}
          layout={layout}
          blocked={offers?.blocked}
          freeDelivery={offers?.freeDelivery}
        />
      </div>
      <CartCheckoutBar cart={cart} blocked={offers?.blocked} />
    </div>
  );
}

function CartEmpty({
  layout,
  takeFocus,
}: {
  layout: CartLayout;
  /** Holds true when the shopper just emptied the cart: the removed button took focus with it. */
  takeFocus: RefObject<boolean>;
}) {
  const {close} = useAside();
  const Heading = layout === 'page' ? 'h2' : 'h3';
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (takeFocus.current) heading.current?.focus();
  }, [takeFocus]);

  const body = (
    <div className="flex flex-col items-start gap-4">
      <Heading
        ref={heading}
        tabIndex={-1}
        className="type-display text-3xl md:text-4xl"
      >
        Your cart is empty
      </Heading>
      <p className="text-base text-fg-muted md:text-lead">
        You haven&rsquo;t added anything yet. Browse our mattresses, or take the
        sleep quiz and we will suggest a match.
      </p>
      <div className="flex flex-wrap gap-3">
        <Button
          to="/collections/all"
          variant="primary"
          size="lg"
          onClick={close}
        >
          Continue shopping
        </Button>
        <Button
          to={SLEEP_QUIZ_LINK.to}
          variant="outline"
          size="lg"
          onClick={close}
        >
          Take the sleep quiz
        </Button>
      </div>
    </div>
  );

  if (layout === 'aside') {
    return (
      <div className="flex flex-col items-start gap-6 py-6">
        <EmptyCartArt className="max-w-48" />
        {body}
      </div>
    );
  }
  return (
    <Card className="mt-2 grid items-center gap-8 md:grid-cols-2 md:gap-12 md:p-12">
      <EmptyCartArt className="mx-auto" />
      {body}
    </Card>
  );
}
