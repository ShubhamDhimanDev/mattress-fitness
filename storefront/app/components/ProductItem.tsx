import {Image} from '~/lib/hydrogen/image';
import {Link} from 'react-router';
import {CompareToggle} from '~/components/compare/CompareToggle';
import {Badge} from '~/components/ui/Badge';
import {cardStyles} from '~/components/ui/Card';
import {Chip} from '~/components/ui/Chip';
import {cn} from '~/components/ui/cn';
import {getPriceView} from '~/components/ui/Price';
import {Rating} from '~/components/ui/Rating';
import {cardSelectItemAttributes} from '~/lib/listing-analytics';
import type {ProductCardView} from '~/lib/shopify/types';

type ProductItemProps = {
  product: ProductCardView;
  loading?: 'eager' | 'lazy';
  /**
   * Zero-based position among the list's products (promo tiles do not count). "Load more" uses it to move focus to
   * the first new card, and a card that has one reports a click as select_item (REQ-ANL-001); without it the card
   * reports nothing.
   */
  index?: number;
  /** The list the card belongs to, for the select_item event (a collection handle, `search`, `all`, `brand-<handle>`). */
  listId?: string;
  /**
   * Kept so existing callers still compile. The redesigned card always stacks the picture above the text (two columns
   * on a phone), so both values now look the same.
   */
  layout?: 'stack' | 'row';
};

// The `sizes` hint follows the listing grid: four columns from 1280 px, three from 1024 px, two below.
const IMAGE_SIZES = '(min-width: 1280px) 22vw, (min-width: 1024px) 30vw, 46vw';

// At most two chips (feel, then type or the first benefit) so a card stays compact in a two-column phone grid.
const MAX_CHIPS = 2;

/**
 * A product card (REQ-COL-001). The whole card is one link, named by the product title through the
 * heading, so a screen reader hears "Queen mattress, link" once. Everything optional is shown only when
 * the data exists: the sale badge needs compare-at above price, the rating needs a reviews source, the
 * chips need the metafields. The amber badge sits on the image's top right (CR-31); availability stays top left.
 */
export function ProductItem({
  product,
  loading,
  index,
  listId,
}: ProductItemProps) {
  const view = product.price
    ? getPriceView(product.price, product.compareAt)
    : null;
  const sale = view?.kind === 'sale' ? view : null;
  const chips = [
    product.comfortLevel,
    product.mattressType,
    ...product.benefits.slice(0, 1),
  ]
    .flatMap((value) => (value ? [value] : []))
    .slice(0, MAX_CHIPS);

  return (
    <article
      data-product-index={index}
      className={cn(
        cardStyles({padding: 'none', interactive: true}),
        'group relative flex h-full flex-col overflow-hidden',
      )}
    >
      <div className="relative aspect-square overflow-hidden bg-surface-muted">
        {product.image ? (
          <Image
            alt=""
            aspectRatio="1/1"
            data={product.image}
            loading={loading}
            sizes={IMAGE_SIZES}
            className="size-full object-cover motion-safe:transition-transform motion-safe:group-hover:scale-105"
          />
        ) : null}
        {/* Availability is not a promotion: it stays on the left, the offer on the right. */}
        {product.soldOut ? (
          <div className="absolute top-3 left-3">
            <Badge variant="neutral">Sold out</Badge>
          </div>
        ) : null}
        {sale ? (
          <div className="absolute top-3 right-3">
            <Badge variant="sale">Save {sale.percentOff}%</Badge>
          </div>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-4 md:p-5">
        {/* break-words: a single long vendor name wraps inside the card instead of crossing its border (BV-005). */}
        {product.vendor ? (
          <p className="text-caption font-bold tracking-wide break-words text-fg-muted uppercase">
            {product.vendor}
          </p>
        ) : null}
        <h3 className="text-lg font-extrabold text-fg">
          {/* The link's ::after covers the card, so the full card is the target without nesting links. The focus ring is the global one on this link (the e2e tab-walk checks the focused element paints it). The four-line clamp sits on the span INSIDE the link, not on the heading: an `overflow: hidden` ancestor would cut the 3 px ring off (BV-001). The link is a block so the ring surrounds the whole title box. The card itself clips its image corners, so the text block keeps 16 px of padding around the ring. */}
          {/* On the link, not the article: the compare toggle sits inside the article and must not count as opening the product. */}
          <Link
            to={`/products/${product.handle}`}
            prefetch="intent"
            {...cardSelectItemAttributes(product, index, listId)}
            className="group/title block after:absolute after:inset-0"
          >
            <span className="group-hover/title:underline md:line-clamp-4">
              {product.title}
            </span>
          </Link>
        </h3>
        {product.rating ? (
          <Rating value={product.rating.average} count={product.rating.count} />
        ) : null}
        {chips.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {chips.map((chip) => (
              <li key={chip}>
                <Chip>{chip}</Chip>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="mt-auto flex flex-col gap-1 pt-3 md:flex-row md:items-end md:justify-between md:gap-3">
          {view ? (
            <CardPrice view={view} from={product.priceIsFrom} />
          ) : (
            <span />
          )}
          {/* Above the cover link (z-10) so it can be pressed; it is not part of the card link (REQ-CMP-001). */}
          <CompareToggle
            handle={product.handle}
            title={product.title}
            className="relative z-10"
          />
        </div>
      </div>
    </article>
  );
}

type PriceViewOf = NonNullable<ReturnType<typeof getPriceView>>;

/**
 * The card's price block: a muted "From", the amount large, and for a sale the struck-through compare-at and the saving in
 * the sale colour (never brand red). Every figure is formatted by `getPriceView` from Shopify's own amounts; nothing is
 * computed here (BV-008: the parts wrap as a row).
 */
function CardPrice({view, from}: {view: PriceViewOf; from: boolean}) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="flex flex-wrap items-baseline gap-x-2">
        {from ? (
          <span className="text-sm font-semibold text-fg-muted">From</span>
        ) : null}
        <span
          className={cn(
            'text-xl font-extrabold md:text-2xl',
            view.kind === 'sale' ? 'text-sale-fg' : 'text-fg',
          )}
        >
          {view.kind === 'sale' ? (
            <span className="sr-only">Sale price: </span>
          ) : null}
          {view.price}
        </span>
      </span>
      {view.kind === 'sale' ? (
        <span className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <s className="text-fg-muted">
            <span className="sr-only">Original price: </span>
            {view.compareAt}
          </s>
          <span className="font-bold text-sale-fg">Save {view.savings}</span>
        </span>
      ) : null}
    </div>
  );
}
