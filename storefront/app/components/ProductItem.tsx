import {Image} from '@shopify/hydrogen';
import {Link} from 'react-router';
import {Badge} from '~/components/ui/Badge';
import {getPriceView, Price} from '~/components/ui/Price';
import {Rating} from '~/components/ui/Rating';
import type {ProductCardView} from '~/lib/shopify/types';

type ProductItemProps = {
  product: ProductCardView;
  loading?: 'eager' | 'lazy';
  /** Position in the list, used by "Load more" to move focus to the first new card. */
  index?: number;
};

/**
 * A product card (REQ-COL-001). The whole card is one link, named by the product title through the
 * heading, so a screen reader hears "Queen mattress, link" once. Everything optional is shown only when
 * the data exists: the sale badge needs compare-at above price, the rating needs a reviews source, the
 * attribute badges need the metafields.
 */
export function ProductItem({product, loading, index}: ProductItemProps) {
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
      className="group relative flex h-full flex-col gap-2"
    >
      <div className="relative aspect-square overflow-hidden rounded-card bg-surface-muted">
        {product.image ? (
          <Image
            alt=""
            aspectRatio="1/1"
            data={product.image}
            loading={loading}
            sizes="(min-width: 1280px) 22vw, (min-width: 768px) 30vw, 46vw"
            className="size-full object-cover transition-transform group-hover:scale-105"
          />
        ) : null}
        <div className="absolute top-2 left-2 flex flex-col items-start gap-1">
          {sale ? <Badge variant="sale">Save {sale.percentOff}%</Badge> : null}
          {product.soldOut ? <Badge variant="neutral">Sold out</Badge> : null}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-1">
        {product.vendor ? (
          <p className="text-xs font-bold tracking-wide text-fg-muted uppercase">
            {product.vendor}
          </p>
        ) : null}
        <h3 className="text-base font-bold text-fg">
          {/* The link's ::after covers the card, so the full card is the target without nesting links. */}
          <Link
            to={`/products/${product.handle}`}
            prefetch="intent"
            className="after:absolute after:inset-0 hover:underline"
          >
            {product.title}
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
            size="sm"
            className="mt-auto pt-1"
          />
        ) : null}
      </div>
    </article>
  );
}
