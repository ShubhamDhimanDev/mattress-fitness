import {useEffect, useId, useRef} from 'react';
import {useFetchers} from 'react-router';
import {CartActionForm} from '~/components/cart/CartActionForm';
import {useCartVariantIds} from '~/components/product/useCartVariantIds';
import {useProductAddOns} from '~/components/product/useProductAddOns';
import {Button} from '~/components/ui/Button';
import {Card} from '~/components/ui/Card';
import {Chip} from '~/components/ui/Chip';
import {Price} from '~/components/ui/Price';
import {Skeleton} from '~/components/ui/Skeleton';
import {ADD_ADDON_ACTION} from '~/lib/cart/custom-actions';
import {PRODUCT_ADDON_COPY} from '~/lib/offers-runtime/messages';
import {
  itemsForSize,
  type ProductAddOnItem,
} from '~/lib/offers-runtime/product-addons';

/**
 * Held while the list loads, for a product the server already knows has add-ons (the loader's `addOnsExpected`), so
 * what sits below the slot does not jump when the answer arrives (NFR-002). One fixed height (about one row plus the
 * heading) on purpose: the row count per size is only known once the list arrives, and a guess from the rules would
 * need another loader field for a few pixels of difference.
 */
const RESERVED = 'min-h-48';

export type AddOnMattress = {
  /** The selected mattress variant: the only thing besides the add-on's own id that the add posts. */
  readonly variantId: string;
  /** The selected Size option value; null when the product has none. */
  readonly size: string | null;
  readonly available: boolean;
};

/**
 * Size-matched foundations, adjustable bases and frames for the mattress being viewed (P4-03, REQ-ADD-001). Which items
 * are offered is the server's answer from the admin-configured relations; the page only picks the ones that fit the
 * selected size, so changing size swaps the list with no request. Prices are Shopify's, shown as returned. Each button
 * posts two variant ids to the shared `/cart` action (`CustomAddAddOn`); the server proves the pair against the rules and
 * Shopify, adds the mattress too when it is not in the cart yet, and the cart gate runs again after. No quantity or price
 * leaves the browser.
 *
 * States: loading (skeleton, space held), error (message and a retry), empty for this size (nothing renders), sold-out
 * mattress (buttons disabled with the reason). The result of an add is announced in the row's own status region; an
 * error is shown by the buy box's shared cart message region, which listens to every cart form.
 */
export function ProductAddOns({
  productId,
  mattress,
  onViewCart,
}: {
  productId: string;
  mattress: AddOnMattress;
  /** Opens the cart (the buy box owns the cart drawer). */
  onViewCart: () => void;
}) {
  const {state, retry} = useProductAddOns(productId);
  const items =
    state.status === 'ready' ? itemsForSize(state.items, mattress.size) : [];
  const announcement =
    items.length === 0
      ? ''
      : items.length === 1
        ? '1 foundation, base or frame is available for this size.'
        : `${items.length} foundations, bases or frames are available for this size.`;

  return (
    <div>
      {/* Mounted before it has text, so the change is announced (WCAG 4.1.3). */}
      <p role="status" className="sr-only">
        {announcement}
      </p>
      {state.status === 'loading' ? (
        <div
          aria-busy="true"
          className={`${RESERVED} flex flex-col gap-3 rounded-card bg-paper p-4`}
        >
          <span className="sr-only">{PRODUCT_ADDON_COPY.loading}</span>
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : null}
      {state.status === 'error' ? (
        <div className="flex flex-col items-start gap-2 rounded-card border border-line p-4">
          {/* An alert is announced when it is inserted, which is what a failed load needs. */}
          <p role="alert" className="text-sm">
            {PRODUCT_ADDON_COPY.error}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={retry}>
            {PRODUCT_ADDON_COPY.retry}
          </Button>
        </div>
      ) : null}
      {items.length > 0 ? (
        <AddOnList items={items} mattress={mattress} onViewCart={onViewCart} />
      ) : null}
    </div>
  );
}

function AddOnList({
  items,
  mattress,
  onViewCart,
}: {
  items: readonly ProductAddOnItem[];
  mattress: AddOnMattress;
  onViewCart: () => void;
}) {
  const headingId = useId();
  const reasonId = useId();
  // What the cart holds comes from the root loader, so it follows changes made anywhere (the drawer, another page).
  const cartIds = useCartVariantIds();
  // Cart writes are serialised: while any cart form is in flight every row waits, so two rows cannot race on the
  // "mattress not in the cart yet" decision.
  const busy = useFetchers().some(
    (fetcher) => fetcher.state !== 'idle' && fetcher.formAction === '/cart',
  );
  return (
    <Card
      as="section"
      variant="tinted"
      padding="sm"
      aria-labelledby={headingId}
      className="flex flex-col gap-3"
    >
      <h2 id={headingId} className="type-display text-title">
        {PRODUCT_ADDON_COPY.heading}
      </h2>
      <p id={reasonId} className="text-sm text-fg-muted">
        {mattress.available
          ? PRODUCT_ADDON_COPY.help
          : PRODUCT_ADDON_COPY.soldOutMattress}
      </p>
      <ul className="flex flex-col gap-3">
        {items.map((item) => (
          <AddOnRow
            key={item.variant.variantId}
            item={item}
            mattress={mattress}
            // Both lines are in the cart: this exact mattress size and this add-on. A size-independent add-on that
            // was added with Queen is therefore not "added" for King.
            added={
              cartIds !== null &&
              cartIds.has(item.variant.variantId) &&
              cartIds.has(mattress.variantId)
            }
            busy={busy}
            reasonId={mattress.available ? undefined : reasonId}
            onViewCart={onViewCart}
          />
        ))}
      </ul>
    </Card>
  );
}

function AddOnRow({
  item,
  mattress,
  added,
  busy,
  reasonId,
  onViewCart,
}: {
  item: ProductAddOnItem;
  mattress: AddOnMattress;
  added: boolean;
  /** Some cart form is in flight (this row's or another's). */
  busy: boolean;
  /** Id of the text that says why the buttons are off (sold-out mattress), when they are. */
  reasonId: string | undefined;
  onViewCart: () => void;
}) {
  const {variant} = item;
  const name = variant.variantTitle
    ? `${variant.productTitle}, ${variant.variantTitle}`
    : variant.productTitle;
  const viewCart = useRef<HTMLSpanElement>(null);
  const wasAdded = useRef(added);
  useEffect(() => {
    // The Add button unmounts when the add lands; keep the shopper in the row instead of dropping focus to the page.
    if (added && !wasAdded.current) {
      const active = document.activeElement;
      if (active === null || active === document.body) {
        viewCart.current?.querySelector('button')?.focus();
      }
    }
    wasAdded.current = added;
  }, [added]);

  return (
    <li className="rounded-card border border-line bg-surface p-4">
      <CartActionForm
        route="/cart"
        action={ADD_ADDON_ACTION}
        inputs={{
          variantId: variant.variantId,
          mattressVariantId: mattress.variantId,
        }}
      >
        {(fetcher) => {
          const pending = fetcher.state !== 'idle';
          return (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="flex min-w-0 flex-col">
                <span className="text-lg font-extrabold">
                  {variant.productTitle}
                </span>
                {variant.variantTitle ? (
                  <span className="text-sm text-fg-muted">
                    {variant.variantTitle}
                  </span>
                ) : null}
                <Price price={variant.price} size="sm" />
              </span>
              {added ? (
                <span ref={viewCart} className="flex items-center gap-2">
                  <Chip tone="success">{PRODUCT_ADDON_COPY.added}</Chip>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="shrink-0"
                    onClick={onViewCart}
                  >
                    {PRODUCT_ADDON_COPY.viewCart}
                  </Button>
                </span>
              ) : (
                <Button
                  type="submit"
                  variant="outline"
                  size="sm"
                  // Flex item: shrink-0 keeps the label from squeezing below its longest word.
                  className="shrink-0"
                  disabled={!mattress.available || (busy && !pending)}
                  loading={pending}
                  loadingLabel={PRODUCT_ADDON_COPY.adding}
                  aria-describedby={reasonId}
                  // The visible label is the same for every row, so the name says which item.
                  aria-label={`${PRODUCT_ADDON_COPY.add}: ${name}`}
                >
                  {PRODUCT_ADDON_COPY.add}
                </Button>
              )}
              <span role="status" className="sr-only">
                {added ? `${PRODUCT_ADDON_COPY.added}: ${name}` : ''}
              </span>
            </div>
          );
        }}
      </CartActionForm>
    </li>
  );
}
