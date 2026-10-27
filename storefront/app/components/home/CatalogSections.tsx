import {Link} from 'react-router';
import {ProductItem} from '~/components/ProductItem';
import {Button} from '~/components/ui/Button';
import {cardStyles} from '~/components/ui/Card';
import {cn} from '~/components/ui/cn';
import {displayHeadingClass} from '~/lib/display-type';
import {Image} from '~/lib/hydrogen/image';
import {COMPARE_PATH} from '~/lib/pages/compare-view';
import {bedBoxStyle} from '~/lib/shopify/home-sizes';
import type {HomeData} from '~/lib/shopify/home-data';

// The four home blocks whose content comes from the catalog (REQ-HOME-001, CR-31). Each is left out when its data
// is missing, so a new or half-configured store still gets a working page; the heading can be replaced from
// the `homepage_section` entry in admin.

type SectionProps = {
  id: string;
  /** Heading set in admin, or null for the default. */
  heading: string | null;
};

const H2 = 'text-3xl md:text-heading';

// Section headings use the display type unless the admin text is long (lib/display-type.ts).
function headingClass(text: string, extra: string): string {
  return cn(displayHeadingClass(text), extra);
}

export function SizeTiles({
  id,
  heading,
  tiles,
}: SectionProps & {tiles: HomeData['sizeTiles']}) {
  if (tiles.length === 0) return null;
  const headingId = `${id}-heading`;
  const text = heading ?? 'Shop by size';
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className={headingClass(text, H2)}>
        {text}
      </h2>
      {/* On a phone the tiles scroll sideways and snap; from `md` they are a grid. The list is a scroll region whose
          items are links, so the keyboard reaches every tile. The padding leaves room for the focus ring. */}
      <ul className="mt-6 -mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 py-2 md:mt-9 md:grid md:grid-cols-3 md:gap-4 md:overflow-visible lg:grid-cols-6">
        {tiles.map((size) => (
          <li key={size.label} className="w-32 shrink-0 snap-start md:w-auto">
            <Link
              to={size.to}
              className={cn(
                cardStyles({interactive: true, padding: 'none'}),
                'flex h-full flex-col items-center gap-3 px-2 pt-5 pb-4 md:pt-6',
              )}
            >
              {/* The bed is drawn from the real width and length; the text below carries the meaning. */}
              <span
                aria-hidden="true"
                className="flex h-24 items-end justify-center md:h-28"
              >
                <span
                  style={bedBoxStyle(size.shape)}
                  className="flex flex-col rounded-sm border-2 border-ink-900 bg-paper p-1"
                >
                  <span className="flex gap-1">
                    {Array.from({length: size.shape.pillows}, (_, pillow) => (
                      <span
                        key={`pillow-${pillow}`}
                        className="h-2 flex-1 rounded-sm bg-line"
                      />
                    ))}
                  </span>
                </span>
              </span>
              <span className="text-base font-extrabold text-fg">
                {size.label}
              </span>
              <span className="text-caption text-fg-muted">
                {size.shape.dimensions}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function FeaturedProducts({
  id,
  heading,
  featured,
}: SectionProps & {featured: HomeData['featured']}) {
  if (!featured) return null;
  const headingId = `${id}-heading`;
  const text = heading ?? featured.title;
  return (
    <section aria-labelledby={headingId}>
      <div className="flex items-end justify-between gap-4">
        <h2 id={headingId} className={headingClass(text, H2)}>
          {text}
        </h2>
        {featured.handle ? (
          <Button
            to={`/collections/${featured.handle}`}
            variant="outline"
            size="sm"
            className="shrink-0"
          >
            View all
          </Button>
        ) : null}
      </div>
      <ul className="mt-6 grid grid-cols-2 gap-3 md:mt-9 md:grid-cols-4 md:gap-6">
        {featured.products.slice(0, 8).map((product, index) => (
          <li key={product.id}>
            <ProductItem
              product={product}
              loading={index < 4 ? 'eager' : 'lazy'}
              index={index}
              listId={featured.handle ?? 'featured-products'}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The brands band (CR-31): brand red, white heading between two lines, one white tile per brand with the brand NAME as
 * text. A logo shows instead only when the brand entry has one in admin (permission to use logos is pending, D4).
 */
export function BrandTiles({
  id,
  heading,
  tiles,
}: SectionProps & {tiles: HomeData['brandTiles']}) {
  if (tiles.length === 0) return null;
  const headingId = `${id}-heading`;
  const text = heading ?? 'Shop by brand';
  const hasBrandPages = tiles.some((tile) => tile.to.startsWith('/brands/'));
  return (
    <section
      aria-labelledby={headingId}
      className="on-dark rounded-hero bg-primary-500 px-4 py-11 text-white md:px-10 md:py-18"
    >
      <div className="flex items-center gap-4 md:gap-7">
        <span aria-hidden="true" className="h-0.5 flex-1 bg-white/55" />
        <h2
          id={headingId}
          className={headingClass(text, cn(H2, 'text-center text-balance'))}
        >
          {text}
        </h2>
        <span aria-hidden="true" className="h-0.5 flex-1 bg-white/55" />
      </div>
      <ul className="mt-8 grid grid-cols-3 gap-2.5 md:mt-11 md:grid-cols-6 md:gap-4">
        {tiles.map((brand) => (
          <li key={brand.name}>
            <Link
              to={brand.to}
              className="flex min-h-19 flex-col items-center justify-center gap-1 rounded-choice bg-surface p-2 text-center text-sm font-extrabold break-words text-fg motion-safe:transition-shadow hover:shadow-lift md:min-h-33 md:rounded-card md:p-4 md:text-lg"
            >
              {brand.logo ? (
                <Image
                  data={brand.logo}
                  alt=""
                  sizes="160px"
                  className="h-auto max-h-10 w-auto max-w-full object-contain md:max-h-14"
                />
              ) : null}
              {brand.name}
            </Link>
          </li>
        ))}
      </ul>
      <div className="mt-8 flex flex-col justify-center gap-3 md:mt-10 md:flex-row md:gap-4">
        {hasBrandPages ? (
          <Button to="/brands" variant="white" size="lg">
            See all brands
          </Button>
        ) : null}
        <Button to={COMPARE_PATH} variant="inverse-outline" size="lg">
          Compare mattresses
        </Button>
      </div>
    </section>
  );
}

/** The feel-and-type band (CR-31): a dark band with one tile per collection, its admin image above the title. */
export function CategoryTiles({
  id,
  heading,
  tiles,
}: SectionProps & {tiles: HomeData['collectionTiles']}) {
  if (tiles.length === 0) return null;
  const headingId = `${id}-heading`;
  const text = heading ?? 'Shop by category';
  return (
    <section
      aria-labelledby={headingId}
      className="on-dark rounded-hero bg-ink-900 px-4 py-11 text-white md:px-10 md:py-16"
    >
      <h2 id={headingId} className={headingClass(text, H2)}>
        {text}
      </h2>
      <ul className="mt-6 grid grid-cols-2 gap-3 md:mt-9 md:grid-cols-3 md:gap-4 xl:grid-cols-6">
        {tiles.map((tile, index) => (
          <li key={tile.to}>
            <Link
              to={tile.to}
              prefetch="intent"
              className="group flex h-full flex-col gap-3 rounded-card border border-ink-700 bg-ink-800 p-3 pb-4"
            >
              <span className="block aspect-square overflow-hidden rounded-choice bg-ink-700">
                {tile.image ? (
                  <Image
                    data={tile.image}
                    alt=""
                    aspectRatio="1/1"
                    sizes="(min-width: 1280px) 14vw, (min-width: 768px) 28vw, 44vw"
                    loading={index < 2 ? 'eager' : 'lazy'}
                    className="size-full object-cover motion-safe:transition-transform motion-safe:group-hover:scale-105"
                  />
                ) : null}
              </span>
              <span className="text-lg font-extrabold group-hover:underline">
                {tile.title}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
