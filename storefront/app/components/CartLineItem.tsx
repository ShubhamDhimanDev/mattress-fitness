import type {OptimisticCartLine} from '~/lib/hydrogen/cart-form';
import {Image} from '~/lib/hydrogen/image';
import {Link} from 'react-router';
import type {CartApiQueryFragment} from 'storefrontapi.generated';
import {useAside} from '~/components/Aside';
import {
  freeGiftValue,
  isCoverageLine,
  isFreeGiftLine,
  moneyText,
} from '~/components/cart/cart-view';
import {CartSizeSelect} from '~/components/cart/CartSizeSelect';
import {LineQuantity, RemoveButton} from '~/components/cart/LineActions';
import {ProtectionStrip} from '~/components/cart/ProtectionStrip';
import type {CartLayout, LineItemChildrenMap} from '~/components/CartMain';
import {Badge} from '~/components/ui/Badge';
import {Card} from '~/components/ui/Card';
import {Chip} from '~/components/ui/Chip';
import {cn} from '~/components/ui/cn';
import {Price} from '~/components/ui/Price';
import {
  linePromotions,
  visibleLineProperties,
  visibleOptions,
} from '~/lib/cart/lines';
import {fromCents, toCents} from '~/lib/money';
import type {DeliveryChoice} from '~/lib/offers/types';
import type {ProtectionLineView, SizeChoice} from '~/lib/offers-runtime/view';

export type CartLine = OptimisticCartLine<CartApiQueryFragment>;

type CartLineItemProps = {
  layout: CartLayout;
  line: CartLine;
  childrenMap: LineItemChildrenMap;
  /** Cart line id -> sizes it can be swapped to, from the offers view (empty until it loads). */
  lineSizes?: Readonly<Record<string, readonly SizeChoice[]>>;
  /** Called after a remove is submitted, so the cart can move focus somewhere that still exists. */
  onRemove: () => void;
  /** Cart line id -> the server's protection quote for the units that have none yet (the offers view). */
  protection?: Readonly<Record<string, ProtectionLineView>>;
  /** The shopper's answered delivery method, to label lines that ship. Absent until the question is answered. */
  deliveryChoice?: DeliveryChoice | null;
  /** A line nested under another (not a coverage plan): drawn as a quiet row inside its parent's card. */
  nested?: boolean;
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

const DELIVERY_LABEL: Record<DeliveryChoice, string> = {
  'in-home': 'Home delivery',
  pickup: 'Store pickup',
};

/**
 * One cart line (REQ-CART-001): image, name, the options and properties the shopper chose, quantity, remove, and the
 * line total exactly as Shopify returned it. Three looks of the same data: a card on the page, a compact row in the drawer,
 * and a dashed amber card for the free gift. Protection plans (nested lines the server linked) are drawn inside the card
 * of the item they cover; any other nested line is a quiet row beneath it.
 */
export function CartLineItem(props: CartLineItemProps) {
  if (!props.nested && isFreeGiftLine(props.line)) {
    return <GiftLine {...props} />;
  }
  return props.layout === 'aside' || props.nested ? (
    <CompactLine {...props} />
  ) : (
    <PageLine {...props} />
  );
}

/** Splits the nested lines into the plans that cover this item and everything else. */
function splitChildren(children: readonly CartLine[] | undefined) {
  const covering: CartLine[] = [];
  const others: CartLine[] = [];
  for (const child of children ?? []) {
    (isCoverageLine(child) ? covering : others).push(child);
  }
  return {covering, others};
}

function LineMedia({
  image,
  sizes,
  className,
}: {
  image: CartLine['merchandise']['image'];
  sizes: string;
  className: string;
}) {
  return (
    <div
      className={cn(
        'shrink-0 overflow-hidden rounded-choice border border-line bg-paper',
        className,
      )}
    >
      {image ? (
        <Image
          alt=""
          aspectRatio="1/1"
          data={image}
          sizes={sizes}
          loading="lazy"
          className="size-full object-cover"
        />
      ) : null}
    </div>
  );
}

/** The small muted brand label above a name. Absent when the product has no vendor. */
function Brand({vendor}: {vendor: string | null | undefined}) {
  const brand = vendor?.trim();
  if (!brand) return null;
  return <span className="type-eyebrow text-fg-muted">{brand}</span>;
}

function LineTitle({
  line,
  layout,
  className,
}: {
  line: CartLine;
  layout: CartLayout;
  className: string;
}) {
  const {close} = useAside();
  const {product} = line.merchandise;
  return (
    <h3 className={className}>
      <Link
        to={`/products/${product.handle}`}
        prefetch="intent"
        onClick={layout === 'aside' ? close : undefined}
        className="inline-flex min-h-touch items-center hover:underline"
      >
        {product.title}
      </Link>
    </h3>
  );
}

/** Options and properties the shopper chose. The size is the select's job once the sizes have loaded. */
function LineDetails({
  line,
  hideSize,
  compact = false,
}: {
  line: CartLine;
  hideSize: boolean;
  compact?: boolean;
}) {
  const options = visibleOptions(line.merchandise.selectedOptions).filter(
    (option) => !(hideSize && option.name.toLowerCase() === 'size'),
  );
  const properties = visibleLineProperties(line.attributes);
  const promotions = linePromotions(line.discountAllocations);
  if (options.length + properties.length + promotions.length === 0) return null;
  return (
    <div
      className={cn(
        'flex flex-col text-fg-muted',
        compact ? 'text-xs' : 'text-sm',
      )}
    >
      {options.length > 0 ? (
        <p>
          {options
            .map((option) => `${option.name}: ${option.value}`)
            .join(' / ')}
        </p>
      ) : null}
      {properties.length > 0 ? (
        <ul>
          {properties.map((property) => (
            <li key={property.label}>
              {property.label}: {property.value}
            </li>
          ))}
        </ul>
      ) : null}
      {promotions.length > 0 ? (
        <ul className="font-bold text-sale-fg">
          {promotions.map((promotion) => (
            <li key={promotion.title}>
              {promotion.title}: -{promotion.amount}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function LinePrice({
  line,
  size,
  className,
  hideEach = false,
}: {
  line: CartLine;
  size: 'sm' | 'md' | 'lg';
  className?: string;
  /** The drawer shows the each-price under the name instead. */
  hideEach?: boolean;
}) {
  const pending = Boolean(line.isOptimistic);
  const each = moneyText(line.cost?.amountPerQuantity);
  return (
    <div className={className}>
      <Price
        price={line.cost?.totalAmount ?? line.merchandise.price}
        compareAt={lineCompareAt(line)}
        size={size}
        stale={pending}
        className="md:justify-end"
      />
      {each && !hideEach ? (
        <p className="text-sm text-fg-muted">{each} each</p>
      ) : null}
    </div>
  );
}

function NestedLines({
  parent,
  lines,
  ...rest
}: Omit<CartLineItemProps, 'line' | 'nested'> & {
  parent: CartLine;
  lines: readonly CartLine[];
}) {
  if (lines.length === 0) return null;
  return (
    <ul
      aria-label={`Added with ${parent.merchandise.product.title}`}
      className="mx-4 mb-4 flex flex-col border-t border-line md:mx-6"
    >
      {lines.map((child) => (
        <CartLineItem key={child.id} {...rest} line={child} nested />
      ))}
    </ul>
  );
}

function PageLine(props: CartLineItemProps) {
  const {line, layout, childrenMap, lineSizes, onRemove, protection} = props;
  const {id, merchandise} = line;
  const {product} = merchandise;
  const pending = Boolean(line.isOptimistic);
  const sizeChoices = lineSizes?.[id];
  const {covering, others} = splitChildren(childrenMap[id]);
  const shipsAs =
    props.deliveryChoice && merchandise.requiresShipping
      ? DELIVERY_LABEL[props.deliveryChoice]
      : null;

  return (
    <Card
      as="li"
      padding="none"
      aria-busy={pending || undefined}
      className="overflow-hidden"
    >
      <div className="grid grid-cols-[calc(var(--spacing)*24)_minmax(0,1fr)] gap-x-4 gap-y-3 p-4 md:grid-cols-[calc(var(--spacing)*37.5)_minmax(0,1fr)_auto] md:gap-x-6 md:p-6">
        <LineMedia
          image={merchandise.image}
          sizes="(min-width: 768px) 150px, 96px"
          className="row-span-2 size-24 md:row-span-3 md:size-37.5"
        />
        <div className="flex min-w-0 flex-col items-start gap-1">
          <Brand vendor={product.vendor} />
          <LineTitle
            line={line}
            layout={layout}
            className="type-display text-lg md:text-title"
          />
          <LineDetails line={line} hideSize={Boolean(sizeChoices)} />
          {shipsAs ? <Chip tone="outline">{shipsAs}</Chip> : null}
        </div>
        <LinePrice
          line={line}
          size="md"
          className="col-start-2 md:col-start-3 md:row-start-1 md:row-span-3 md:text-right"
        />
        <div className="col-span-2 flex flex-wrap items-end gap-x-4 gap-y-3 md:col-span-1 md:col-start-2 md:row-start-2">
          {sizeChoices ? (
            <CartSizeSelect
              lineId={id}
              title={product.title}
              currentVariantId={merchandise.id}
              choices={sizeChoices}
              disabled={pending}
              className="w-full md:w-64"
            />
          ) : null}
          <LineQuantity line={line} title={product.title} />
          <RemoveButton
            lineId={id}
            title={product.title}
            disabled={pending}
            onRemove={onRemove}
          />
        </div>
      </div>
      <ProtectionStrip
        covering={covering}
        offer={protection?.[id]}
        pending={pending}
        onRemove={onRemove}
      />
      <NestedLines
        parent={line}
        lines={others}
        layout={layout}
        childrenMap={childrenMap}
        lineSizes={lineSizes}
        onRemove={onRemove}
        protection={protection}
      />
    </Card>
  );
}

/** The drawer row, and the quiet row for any nested line that is not a protection plan. */
function CompactLine(props: CartLineItemProps) {
  const {line, layout, childrenMap, lineSizes, onRemove, protection} = props;
  const {id, merchandise} = line;
  const {product} = merchandise;
  const pending = Boolean(line.isOptimistic);
  const sizeChoices = lineSizes?.[id];
  const {covering, others} = splitChildren(childrenMap[id]);

  const each = moneyText(line.cost?.amountPerQuantity);

  // Drawer row (CR-31 follow-up): image left, name and price on one line, then the trash and the quantity pill under the
  // name. Type is one step smaller than on the page; every control keeps its 44 px target.
  return (
    <li
      aria-busy={pending || undefined}
      className="border-b border-line py-4 first:pt-0 last:border-b-0"
    >
      <div className="grid grid-cols-[calc(var(--spacing)*18)_minmax(0,1fr)_auto] gap-x-3">
        <LineMedia image={merchandise.image} sizes="72px" className="size-18" />
        <div className="flex min-w-0 flex-col items-start">
          <Brand vendor={product.vendor} />
          <LineTitle
            line={line}
            layout={layout}
            className="text-sm leading-snug font-bold text-fg"
          />
          <LineDetails line={line} hideSize={Boolean(sizeChoices)} compact />
          {each ? <p className="text-xs text-fg-muted">{each} each</p> : null}
        </div>
        <LinePrice line={line} size="sm" className="text-right" hideEach />
        <div className="col-span-2 col-start-2 flex flex-col gap-1">
          {sizeChoices ? (
            <CartSizeSelect
              lineId={id}
              title={product.title}
              currentVariantId={merchandise.id}
              choices={sizeChoices}
              disabled={pending}
              className="mt-2"
            />
          ) : null}
          <div className="mt-1 flex items-center gap-2">
            <RemoveButton
              lineId={id}
              title={product.title}
              disabled={pending}
              onRemove={onRemove}
              iconOnly
              className="-ml-2"
            />
            <LineQuantity line={line} title={product.title} size="sm" />
          </div>
        </div>
      </div>
      <ProtectionStrip
        compact
        covering={covering}
        offer={protection?.[id]}
        pending={pending}
        onRemove={onRemove}
      />
      {others.length > 0 ? (
        <ul
          aria-label={`Added with ${product.title}`}
          className="mt-3 ml-6 flex flex-col border-l-2 border-line pl-3"
        >
          {others.map((child) => (
            <CartLineItem key={child.id} {...props} line={child} nested />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * The free gift (REQ-CART-002, REQ-PROMO-001): its own dashed amber card. The price is whatever Shopify charged (zero) with
 * the value Shopify reports before the discount struck through; the card is labelled a gift because a named line discount took
 * the whole price off. The server removes the gift when the item that earned it leaves the cart, so this card goes with it.
 */
function GiftLine(props: CartLineItemProps) {
  const {line, layout, onRemove} = props;
  const {id, merchandise} = line;
  const {product} = merchandise;
  const pending = Boolean(line.isOptimistic);
  const value = freeGiftValue(line);
  const promotions = linePromotions(line.discountAllocations);
  const aside = layout === 'aside';

  return (
    <Card
      as="li"
      variant="dashed-amber"
      padding="sm"
      aria-busy={pending || undefined}
      className={cn(aside && 'my-4')}
    >
      <div className="grid grid-cols-[calc(var(--spacing)*18)_minmax(0,1fr)_auto] items-center gap-x-3 md:grid-cols-[calc(var(--spacing)*24)_minmax(0,1fr)_auto] md:gap-x-5">
        <LineMedia
          image={merchandise.image}
          sizes="96px"
          className="size-18 md:size-24"
        />
        <div className="flex min-w-0 flex-col items-start gap-1">
          <Badge variant="gift">Free gift</Badge>
          <LineTitle
            line={line}
            layout={layout}
            className="type-display text-base md:text-lg"
          />
          {promotions[0] ? (
            <p className="text-sm text-fg-muted">{promotions[0].title}</p>
          ) : null}
        </div>
        <div className="text-right">
          <Price
            price={line.cost?.totalAmount ?? merchandise.price}
            compareAt={value}
            size="md"
            className="justify-end"
          />
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-4">
        <LineQuantity line={line} title={product.title} />
        <RemoveButton
          lineId={id}
          title={product.title}
          disabled={pending}
          onRemove={onRemove}
        />
      </div>
    </Card>
  );
}
