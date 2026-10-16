import {CartForm, Image, type OptimisticCartLine} from '@shopify/hydrogen';
import {CartActionForm} from '~/components/cart/CartActionForm';
import {Link} from 'react-router';
import type {CartApiQueryFragment} from 'storefrontapi.generated';
import {useAside} from '~/components/Aside';
import {CartSizeSelect} from '~/components/cart/CartSizeSelect';
import {useCartSubmit} from '~/components/cart/useCartSubmit';
import type {CartLayout, LineItemChildrenMap} from '~/components/CartMain';
import {Button} from '~/components/ui/Button';
import {Price} from '~/components/ui/Price';
import {QuantityStepper} from '~/components/ui/QuantityStepper';
import {MAX_LINE_QUANTITY} from '~/lib/cart/input';
import {
  linePromotions,
  visibleLineProperties,
  visibleOptions,
} from '~/lib/cart/lines';
import {fromCents, toCents} from '~/lib/money';
import type {SizeChoice} from '~/lib/offers-runtime/view';

export type CartLine = OptimisticCartLine<CartApiQueryFragment>;

type CartLineItemProps = {
  layout: CartLayout;
  line: CartLine;
  childrenMap: LineItemChildrenMap;
  /** Cart line id -> sizes it can be swapped to, from the offers view (empty until it loads). */
  lineSizes?: Readonly<Record<string, readonly SizeChoice[]>>;
  /** Called after a remove is submitted, so the cart can move focus somewhere that still exists. */
  onRemove: () => void;
};

/** Compare-at total of a line, in integer cents arithmetic, only when it is above what is charged. */
function lineCompareAt(line: CartLine) {
  // An optimistic line (just added, not yet answered by Shopify) has no cost yet.
  const each = line.cost?.compareAtAmountPerQuantity;
  const charged = line.cost?.totalAmount;
  if (!each || !charged) return null;
  try {
    const total = toCents(each.amount) * line.quantity;
    return total > toCents(charged.amount)
      ? {amount: fromCents(total), currencyCode: each.currencyCode}
      : null;
  } catch {
    return null;
  }
}

/**
 * One cart line (REQ-CART-001): image, name, the options and properties the shopper chose, quantity,
 * remove, and the line total exactly as Shopify returned it. Lines nested under this one (add-ons, Extend
 * coverage) are rendered beneath it.
 */
export function CartLineItem({
  layout,
  line,
  childrenMap,
  lineSizes,
  onRemove,
}: CartLineItemProps) {
  const {id, merchandise} = line;
  const {product, image, selectedOptions} = merchandise;
  const {close} = useAside();
  const children = childrenMap[id];
  const options = visibleOptions(selectedOptions);
  const properties = visibleLineProperties(line.attributes);
  const promotions = linePromotions(line.discountAllocations);
  const pending = Boolean(line.isOptimistic);
  const href = `/products/${product.handle}`;
  const sizeChoices = lineSizes?.[id];

  return (
    <li
      aria-busy={pending || undefined}
      className="flex flex-col gap-3 border-b border-line py-4 first:pt-0 last:border-b-0"
    >
      <div className="flex gap-3">
        <div className="size-24 shrink-0 overflow-hidden rounded-card bg-surface-muted">
          {image ? (
            <Image
              alt=""
              aspectRatio="1/1"
              data={image}
              sizes="96px"
              loading="lazy"
              className="size-full object-cover"
            />
          ) : null}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Link
            to={href}
            prefetch="intent"
            onClick={layout === 'aside' ? close : undefined}
            className="flex min-h-touch w-fit items-center text-base font-bold text-fg hover:underline"
          >
            {product.title}
          </Link>
          {options.length > 0 ? (
            <p className="text-sm text-fg-muted">
              {options
                .map((option) => `${option.name}: ${option.value}`)
                .join(' / ')}
            </p>
          ) : null}
          {properties.length > 0 ? (
            <ul className="text-sm text-fg-muted">
              {properties.map((property) => (
                <li key={property.label}>
                  {property.label}: {property.value}
                </li>
              ))}
            </ul>
          ) : null}
          <Price
            price={line.cost?.totalAmount ?? merchandise.price}
            compareAt={lineCompareAt(line)}
            size="sm"
            className={pending ? 'opacity-60' : undefined}
          />
          {promotions.length > 0 ? (
            <ul className="text-sm text-fg-muted">
              {promotions.map((promotion) => (
                <li key={promotion.title}>
                  {promotion.title}: -{promotion.amount}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>

      {sizeChoices ? (
        <CartSizeSelect
          lineId={id}
          title={product.title}
          currentVariantId={merchandise.id}
          choices={sizeChoices}
          disabled={pending}
        />
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <LineQuantity line={line} title={product.title} />
        <RemoveButton
          lineId={id}
          title={product.title}
          disabled={pending}
          onRemove={onRemove}
        />
      </div>

      {children ? (
        <ul
          aria-label={`Added with ${product.title}`}
          className="ml-6 flex flex-col border-l-2 border-line pl-3"
        >
          {children.map((child) => (
            <CartLineItem
              key={child.id}
              childrenMap={childrenMap}
              lineSizes={lineSizes}
              line={child}
              layout={layout}
              onRemove={onRemove}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function LineQuantity({line, title}: {line: CartLine; title: string}) {
  const {submit} = useCartSubmit(`cart-line-${line.id}`);
  return (
    <QuantityStepper
      value={line.quantity}
      min={1}
      max={MAX_LINE_QUANTITY}
      itemName={title}
      disabled={Boolean(line.isOptimistic)}
      onChange={(quantity) =>
        submit(CartForm.ACTIONS.LinesUpdate, {
          lines: [{id: line.id, quantity}],
        })
      }
    />
  );
}

function RemoveButton({
  lineId,
  title,
  disabled,
  onRemove,
}: {
  lineId: string;
  title: string;
  disabled: boolean;
  onRemove: () => void;
}) {
  return (
    <CartActionForm
      route="/cart"
      action={CartForm.ACTIONS.LinesRemove}
      inputs={{lineIds: [lineId]}}
    >
      <Button
        type="submit"
        variant="ghost"
        size="sm"
        disabled={disabled}
        aria-label={`Remove ${title} from cart`}
        onClick={onRemove}
      >
        Remove
      </Button>
    </CartActionForm>
  );
}
