import {useEffect, useId, useRef} from 'react';
import {useFetchers} from 'react-router';
import {CartActionForm} from '~/components/cart/CartActionForm';
import {useCartVariantIds} from '~/components/product/useCartVariantIds';
import {useProductBundle} from '~/components/product/useProductBundle';
import {Button} from '~/components/ui/Button';
import {Card} from '~/components/ui/Card';
import {Chip} from '~/components/ui/Chip';
import {Price} from '~/components/ui/Price';
import {Skeleton} from '~/components/ui/Skeleton';
import {readCartMessages} from '~/lib/cart/messages';
import {ADD_PRODUCT_BUNDLE_ACTION} from '~/lib/cart/custom-actions';
import {formatMoney, type MoneyV2Like} from '~/lib/format';
import {PRODUCT_BUNDLE_COPY} from '~/lib/offers-runtime/messages';
import {
  readBundleSavings,
  setForSize,
  setInCart,
  type ProductBundleSet,
} from '~/lib/offers-runtime/product-bundle';

/**
 * Held while the set loads, for a product the server already knows anchors a bundle (the loader's `bundleExpected`), so
 * what sits below the card does not jump when the answer arrives (NFR-002). One fixed height on purpose: the item count
 * per size is only known once the answer arrives.
 */
const RESERVED = 'min-h-48';

export type BundleAnchor = {
  /** The selected variant of the page's product: the only thing besides the bundle id that "Add all" posts. */
  readonly variantId: string;
  readonly productTitle: string;
  /** The selected Size option value; null when the product has none. */
  readonly size: string | null;
  readonly available: boolean;
  /** Shown as returned by Shopify's product query; never summed or discounted here. */
  readonly price: MoneyV2Like;
};

/**
 * "Frequently bought together" with an Add-all button (P4-06, REQ-ADD-002). Which products form the set is the server's
 * answer from the admin-configured bundle rule; the page only picks the set for the selected size, so changing size swaps
 * it with no request. Prices are Shopify's, shown as returned, and NO total or saving is calculated here: the saving is a
 * Shopify automatic discount and appears only after the cart (priced by Shopify) reports it for this bundle. "Add all"
 * posts the bundle id and the viewed variant to the shared `/cart` action (`CustomAddProductBundle`); the server derives
 * the lines, sizes and quantities again, refuses the whole add when any member is missing or sold out, and the cart gate
 * runs afterwards.
 *
 * States: loading (skeleton, space held), error (message and a retry), no set for this size (renders nothing), sold-out
 * size (button off with the reason), adding, added (with View cart), refused or partial (the server's fixed text, in the
 * card's own live region).
 */
export function FrequentlyBoughtTogether({
  productId,
  anchor,
  onViewCart,
}: {
  productId: string;
  anchor: BundleAnchor;
  /** Opens the cart (the page owns the cart drawer). */
  onViewCart: () => void;
}) {
  const {state, retry} = useProductBundle(productId);
  const set =
    state.status === 'ready' && state.bundle
      ? setForSize(state.bundle.sets, anchor.size)
      : null;

  return (
    <>
      {state.status === 'loading' ? (
        <div
          aria-busy="true"
          className={`${RESERVED} flex flex-col gap-3 rounded-card bg-paper p-4`}
        >
          <span className="sr-only">{PRODUCT_BUNDLE_COPY.loading}</span>
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : null}
      {state.status === 'error' ? (
        <div className="flex flex-col items-start gap-2 rounded-card border border-line p-4">
          {/* An alert is announced when it is inserted, which is what a failed load needs. */}
          <p role="alert" className="text-sm">
            {PRODUCT_BUNDLE_COPY.error}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={retry}>
            {PRODUCT_BUNDLE_COPY.retry}
          </Button>
        </div>
      ) : null}
      {state.status === 'ready' && state.bundle && set ? (
        <BundleCard
          bundleId={state.bundle.bundleId}
          set={set}
          anchor={anchor}
          onViewCart={onViewCart}
        />
      ) : null}
    </>
  );
}

function BundleCard({
  bundleId,
  set,
  anchor,
  onViewCart,
}: {
  bundleId: string;
  set: ProductBundleSet;
  anchor: BundleAnchor;
  onViewCart: () => void;
}) {
  const headingId = useId();
  const reasonId = useId();
  // What the cart holds comes from the root loader, so it follows changes made anywhere (the drawer, another page).
  const cartIds = useCartVariantIds();
  const inCart = setInCart(cartIds, anchor.variantId, set);
  // Cart writes are serialised: while any cart form is in flight this one waits, so two adds cannot race.
  const busy = useFetchers().some(
    (fetcher) => fetcher.state !== 'idle' && fetcher.formAction === '/cart',
  );
  const viewCart = useRef<HTMLSpanElement>(null);
  const wasInCart = useRef(inCart);
  useEffect(() => {
    // The Add all button unmounts when the add lands; keep the shopper in the card instead of dropping focus to the page.
    if (inCart && !wasInCart.current) {
      const active = document.activeElement;
      if (active === null || active === document.body) {
        viewCart.current?.querySelector('button')?.focus();
      }
    }
    wasInCart.current = inCart;
  }, [inCart]);

  return (
    <Card
      as="section"
      variant="flat"
      aria-labelledby={headingId}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-1">
        <h2 id={headingId} className="type-display text-title">
          {PRODUCT_BUNDLE_COPY.heading}
        </h2>
        <p className="text-sm text-fg-muted">{PRODUCT_BUNDLE_COPY.help}</p>
      </div>
      <ul className="flex flex-col divide-y divide-line">
        <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 pb-3">
          <span className="flex min-w-0 flex-col">
            <span className="text-xs font-bold uppercase text-fg-muted">
              {PRODUCT_BUNDLE_COPY.thisItem}
            </span>
            <span className="font-extrabold">{anchor.productTitle}</span>
            {anchor.size ? (
              <span className="text-sm text-fg-muted">{anchor.size}</span>
            ) : null}
          </span>
          <Price price={anchor.price} size="sm" />
        </li>
        {set.items.map(({quantity, variant}) => (
          <li
            key={variant.variantId}
            className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 last:pb-0"
          >
            <span className="flex min-w-0 flex-col">
              <span className="font-extrabold">
                {quantity > 1 ? `${quantity} x ` : ''}
                {variant.productTitle}
              </span>
              {variant.variantTitle ? (
                <span className="text-sm text-fg-muted">
                  {variant.variantTitle}
                </span>
              ) : null}
            </span>
            <span className="flex items-baseline gap-1">
              <Price price={variant.price} size="sm" />
              {quantity > 1 ? (
                <span className="text-sm text-fg-muted">each</span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      <CartActionForm
        route="/cart"
        action={ADD_PRODUCT_BUNDLE_ACTION}
        inputs={{bundleId, anchorVariantId: anchor.variantId}}
      >
        {(fetcher) => {
          const pending = fetcher.state !== 'idle';
          const idle = !pending;
          const messages = idle ? readCartMessages(fetcher.data) : [];
          const errors = messages.filter((message) => message.kind === 'error');
          const warnings = messages.filter(
            (message) => message.kind === 'warning',
          );
          // Shopify's own figure from the priced cart; null unless it reported one for this bundle.
          const savings =
            idle && inCart ? readBundleSavings(fetcher.data, bundleId) : null;
          return (
            <div className="flex flex-col gap-3">
              {inCart ? (
                <span
                  ref={viewCart}
                  className="flex flex-wrap items-center gap-3"
                >
                  <Chip tone="success">{PRODUCT_BUNDLE_COPY.added}</Chip>
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    onClick={onViewCart}
                  >
                    {PRODUCT_BUNDLE_COPY.viewCart}
                  </Button>
                </span>
              ) : (
                <div>
                  <Button
                    type="submit"
                    size="lg"
                    fullWidth
                    className="sm:w-auto"
                    disabled={!anchor.available || (busy && !pending)}
                    loading={pending}
                    loadingLabel={PRODUCT_BUNDLE_COPY.adding}
                    aria-describedby={anchor.available ? undefined : reasonId}
                  >
                    {PRODUCT_BUNDLE_COPY.addAll}
                  </Button>
                </div>
              )}
              {!anchor.available ? (
                <p id={reasonId} className="text-sm text-fg-muted">
                  {PRODUCT_BUNDLE_COPY.soldOut}
                </p>
              ) : null}
              {/* Mounted before it has text, so a change is announced (WCAG 4.1.3). */}
              <div
                role="status"
                aria-live="polite"
                className="flex flex-col gap-2"
              >
                {errors.map((message) => (
                  <p
                    key={message.text}
                    className="text-sm font-bold text-error-fg"
                  >
                    <span className="sr-only">Error: </span>
                    {message.text}
                  </p>
                ))}
                {warnings.map((message) => (
                  <p
                    key={message.text}
                    className="text-sm font-semibold text-warning-fg"
                  >
                    <span className="sr-only">Notice: </span>
                    {message.text}
                  </p>
                ))}
                {errors.length === 0 && inCart && idle && fetcher.data ? (
                  <p className="sr-only">{PRODUCT_BUNDLE_COPY.added}</p>
                ) : null}
                {savings ? (
                  <p className="text-sm font-bold text-sale-fg">
                    {PRODUCT_BUNDLE_COPY.savings}: {formatMoney(savings)}
                  </p>
                ) : null}
              </div>
            </div>
          );
        }}
      </CartActionForm>
    </Card>
  );
}
