import {useId} from 'react';
import {CartActionForm} from '~/components/cart/CartActionForm';
import {useProductAddOns} from '~/components/product/useProductAddOns';
import {Button} from '~/components/ui/Button';
import {Price} from '~/components/ui/Price';
import {Skeleton} from '~/components/ui/Skeleton';
import {ADD_ADDON_ACTION} from '~/lib/cart/custom-actions';
import {isCartActionResult, readCartMessages} from '~/lib/cart/messages';
import {PRODUCT_ADDON_COPY} from '~/lib/offers-runtime/messages';
import {
  itemsForSize,
  type ProductAddOnItem,
} from '~/lib/offers-runtime/product-addons';

/**
 * Held while the list loads, for a product the server already knows has add-ons (the loader's `addOnsExpected`), so
 * what sits below the slot does not jump when the answer arrives (NFR-002).
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
        <div aria-busy="true" className={`${RESERVED} flex flex-col gap-3 p-4`}>
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
          <Button type="button" variant="secondary" size="sm" onClick={retry}>
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
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-card border border-line p-4"
    >
      <h2 id={headingId} className="type-display text-base">
        {PRODUCT_ADDON_COPY.heading}
      </h2>
      <p className="text-sm text-fg-muted">
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
            onViewCart={onViewCart}
          />
        ))}
      </ul>
    </section>
  );
}

function AddOnRow({
  item,
  mattress,
  onViewCart,
}: {
  item: ProductAddOnItem;
  mattress: AddOnMattress;
  onViewCart: () => void;
}) {
  const {variant} = item;
  const name = variant.variantTitle
    ? `${variant.productTitle}, ${variant.variantTitle}`
    : variant.productTitle;
  return (
    <li className="rounded-choice border border-line p-3">
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
          // An answer with no error is an add (warnings alone still mean the lines landed).
          const added =
            !pending &&
            isCartActionResult(fetcher.data) &&
            readCartMessages(fetcher.data).every(
              (message) => message.kind !== 'error',
            );
          return (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="flex min-w-0 flex-col">
                <span className="font-bold">{variant.productTitle}</span>
                {variant.variantTitle ? (
                  <span className="text-sm text-fg-muted">
                    {variant.variantTitle}
                  </span>
                ) : null}
                <Price price={variant.price} size="sm" />
              </span>
              <span className="flex items-center gap-2">
                {added ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="shrink-0"
                    onClick={onViewCart}
                  >
                    {PRODUCT_ADDON_COPY.viewCart}
                  </Button>
                ) : null}
                <Button
                  type="submit"
                  variant="secondary"
                  size="sm"
                  // Flex item: shrink-0 keeps the label from squeezing below its longest word.
                  className="shrink-0"
                  disabled={!mattress.available || added}
                  loading={pending}
                  loadingLabel={PRODUCT_ADDON_COPY.adding}
                  // The visible label is the same for every row, so the name says which item. Not set once added: the
                  // visible text then changes and the name must follow it (WCAG 2.5.3).
                  aria-label={
                    added ? undefined : `${PRODUCT_ADDON_COPY.add}: ${name}`
                  }
                >
                  {added ? PRODUCT_ADDON_COPY.added : PRODUCT_ADDON_COPY.add}
                </Button>
              </span>
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
