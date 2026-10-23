import {Image} from '@shopify/hydrogen';
import {Link} from 'react-router';
import {CompareToggle} from '~/components/compare/CompareToggle';
import {Badge} from '~/components/ui/Badge';
import {cn} from '~/components/ui/cn';
import {getPriceView, Price} from '~/components/ui/Price';
import {Rating} from '~/components/ui/Rating';
import {cardSelectItemAttributes} from '~/lib/listing-analytics';
import type {ProductCardView} from '~/lib/shopify/types';

type ProductItemProps = {
  product: ProductCardView;
  loading?: 'eager' | 'lazy';
  /** Position in the list, used by "Load more" to move focus to the first new card. */
  index?: number;
  /**
   * `stack` puts the image above the text. `row` puts them side by side below 768 px and stacks from there
   * (listings and search). The DOM order is the same either way, so reading and focus order never change.
   */
  layout?: 'stack' | 'row';
  /**
   * Where the card sits in its list, so a click is reported as select_item (REQ-ANL-001). `position` is the
   * zero-based place among the products (promo tiles do not count). Without it the card reports nothing.
   */
  analytics?: {readonly listId?: string; readonly position: number};
};

// The `sizes` hint follows the layout: a row card's image is about two fifths of a phone, a stacked card's about
// half of it (two columns).
const IMAGE_SIZES: Record<NonNullable<ProductItemProps['layout']>, string> = {
  stack: '(min-width: 1280px) 22vw, (min-width: 768px) 30vw, 46vw',
  row: '(min-width: 1280px) 22vw, (min-width: 768px) 30vw, 40vw',
};

/**
 * A product card (REQ-COL-001). The whole card is one link, named by the product title through the
 * heading, so a screen reader hears "Queen mattress, link" once. Everything optional is shown only when
 * the data exists: the sale tag needs compare-at above price, the rating needs a reviews source, the
 * attribute badges need the metafields. The sale tag sits under the image, not on it, so a long offer line stays
 * readable (BRAND_APPLICATION_SPEC 5.5).
 */
export function ProductItem({
  product,
  loading,
  index,
  layout = 'stack',
  analytics,
}: ProductItemProps) {
  const saleView =
    product.price && product.compareAt
      ? getPriceView(product.price, product.compareAt)
      : null;
  const sale = saleView?.kind === 'sale' ? saleView : null;
  const attributes = [
    product.comfortLevel,
    product.mattressType,
    ...product.benefits.slice(0, 1),
  ].flatMap((value) => (value ? [value] : []));

  return (
    <article
      data-product-index={index}
      className={cn(
        'group relative flex h-full flex-col gap-2 rounded-card border border-line bg-surface p-2.5 md:p-3 motion-safe:transition-shadow hover:shadow-md',
        layout === 'row' &&
          'max-md:grid max-md:grid-cols-5 max-md:items-start max-md:gap-3',
      )}
    >
      <div
        className={cn(
          'flex flex-col gap-2',
          layout === 'row' && 'max-md:col-span-2',
        )}
      >
        <div className="relative aspect-square overflow-hidden rounded-choice bg-surface-muted">
          {product.image ? (
            <Image
              alt=""
              aspectRatio="1/1"
              data={product.image}
              loading={loading}
              sizes={IMAGE_SIZES[layout]}
              className="size-full object-cover motion-safe:transition-transform motion-safe:group-hover:scale-105"
            />
          ) : null}
          {/* Availability stays on the image: it is not a promotion. */}
          {product.soldOut ? (
            <div className="absolute top-2 left-2">
              <Badge variant="neutral">Sold out</Badge>
            </div>
          ) : null}
        </div>
        {sale ? (
          <div className="flex flex-wrap gap-1">
            <Badge variant="sale" size="tag">
              Save {sale.percentOff}%
            </Badge>
          </div>
        ) : null}
      </div>

      <div
        className={cn(
          'flex flex-1 flex-col gap-1',
          layout === 'row' && 'max-md:col-span-3 max-md:self-stretch',
        )}
      >
        {/* break-words: a single long vendor name wraps inside the card instead of crossing its border (BV-005). */}
        {product.vendor ? (
          <p className="text-xs font-extrabold tracking-wide break-words text-fg-muted uppercase">
            {product.vendor}
          </p>
        ) : null}
        <h3 className="text-base font-bold text-fg md:text-lg">
          {/* The link's ::after covers the card, so the full card is the target without nesting links. The focus ring is the global one on this link (the e2e tab-walk checks the focused element paints it). The four-line clamp sits on the span INSIDE the link, not on the heading: an `overflow: hidden` ancestor would cut the 3 px ring off (BV-001). The link is a block so the ring surrounds the whole title box. */}
          {/* On the link, not the article: the compare toggle sits inside the article and must not count as opening the product. */}
          <Link
            to={`/products/${product.handle}`}
            prefetch="intent"
            {...(analytics ? cardSelectItemAttributes(product, analytics) : {})}
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
        {attributes.length > 0 ? (
          <ul className="flex flex-wrap gap-1">
            {attributes.map((attribute) => (
              <li key={attribute}>
                <Badge variant="neutral">{attribute}</Badge>
              </li>
            ))}
          </ul>
        ) : null}
        {product.price ? (
          <Price
            price={product.price}
            compareAt={product.compareAt}
            prefix={product.priceIsFrom ? 'From' : undefined}
            size="md"
            // The price block sits at the bottom of equal-height cards; its parts wrap as a row (BV-008).
            className="mt-auto pt-1"
          />
        ) : null}
        {/* Above the cover link (z-10) so it can be pressed; it is not part of the card link (REQ-CMP-001). */}
        <CompareToggle
          handle={product.handle}
          title={product.title}
          className="relative z-10"
        />
      </div>
    </article>
  );
}
