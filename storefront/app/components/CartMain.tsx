import {useOptimisticCart} from '@shopify/hydrogen';
import {useEffect, useId, useRef, type ReactNode, type RefObject} from 'react';
import type {CartApiQueryFragment} from 'storefrontapi.generated';
import {useAside} from '~/components/Aside';
import {CartMessages} from '~/components/cart/CartMessages';
import {CartOffers} from '~/components/cart/CartOffers';
import {DeliveryCheck} from '~/components/delivery/DeliveryCheck';
import {FreeDeliveryProgress} from '~/components/cart/FreeDeliveryProgress';
import {useCartOffers} from '~/components/cart/useCartOffers';
import {CartLineItem, type CartLine} from '~/components/CartLineItem';
import {CartSummary} from '~/components/CartSummary';
import {Button} from '~/components/ui/Button';
import {cn} from '~/components/ui/cn';
import {SLEEP_QUIZ_LINK} from '~/lib/navigation';
import type {CartOffersView} from '~/lib/offers-runtime/view';

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

/**
 * The cart, in the drawer and on the page (REQ-CART-001). `useOptimisticCart` applies pending changes so
 * the shopper sees them at once; the server result replaces them when it arrives, and any error or
 * warning Shopify returns is shown in `CartMessages`.
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

  return (
    <div
      className={cn(
        'flex flex-col gap-6',
        // The page title above has a rule under it; without this the first line and the summary card touch it (BV-007).
        layout === 'page' &&
          'pt-4 lg:grid lg:grid-cols-[1fr_22rem] lg:items-start',
      )}
    >
      <div>
        <CartMessages />
        {/* After a line is removed its buttons are gone; focus lands here so keyboard users keep their place. */}
        <div
          ref={linesRegion}
          tabIndex={-1}
          role="region"
          aria-labelledby={headingId}
        >
          <Heading id={headingId} className="sr-only">
            Items in your cart ({cart?.totalQuantity})
          </Heading>
          <ul aria-label="Cart items">
            {lines.map((line) =>
              parentIdOf(line) ? null : (
                <CartLineItem
                  key={line.id}
                  line={line}
                  layout={layout}
                  childrenMap={childrenMap}
                  lineSizes={offers?.lineSizes}
                  onRemove={() => linesRegion.current?.focus()}
                />
              ),
            )}
          </ul>
        </div>
        {slots?.offers ??
          (offers ? (
            <CartOffers
              view={offers}
              onAdded={() => linesRegion.current?.focus()}
            />
          ) : null)}
        {/* The ZIP decides the in-home and recycling offers at checkout (P3B-11, P5B-04). */}
        <DeliveryCheck className="mt-6" />
      </div>
      <CartSummary
        cart={cart}
        layout={layout}
        blocked={offers?.blocked}
        freeDeliverySlot={
          slots?.freeDelivery ??
          (offers ? (
            <FreeDeliveryProgress progress={offers.freeDelivery} />
          ) : null)
        }
      />
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
  return (
    <div className="flex flex-col items-start gap-4 py-6">
      <Heading ref={heading} tabIndex={-1} className="type-display text-2xl">
        Your cart is empty
      </Heading>
      <p className="text-base text-fg-muted">
        You haven&rsquo;t added anything yet. Browse our mattresses, or take the
        sleep quiz and we will suggest a match.
      </p>
      <div className="flex flex-wrap gap-3">
        <Button to="/collections/all" variant="primary" onClick={close}>
          Continue shopping
        </Button>
        <Button to={SLEEP_QUIZ_LINK.to} variant="secondary" onClick={close}>
          Take the sleep quiz
        </Button>
      </div>
    </div>
  );
}
