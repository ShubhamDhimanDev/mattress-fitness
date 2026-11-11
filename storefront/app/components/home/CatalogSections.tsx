import {Link} from 'react-router';
import {ProductItem} from '~/components/ProductItem';
import {Button} from '~/components/ui/Button';
import {cn} from '~/components/ui/cn';
import {displayHeadingClass} from '~/lib/display-type';
import {Image} from '~/lib/hydrogen/image';
import {COMPARE_ENABLED} from '~/lib/features';
import {COMPARE_PATH} from '~/lib/pages/compare-view';
import type {HomeData} from '~/lib/shopify/home-data';

// The three home blocks whose content comes from the catalog (REQ-HOME-001, CR-31). Each is left out when its data
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
      <ul className="mt-6 grid grid-cols-1 gap-3 md:mt-9 md:grid-cols-3 md:gap-6">
        {featured.products.map((product, index) => (
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
                // The logo replaces the name; its alt keeps the link named for screen readers.
                <Image
                  data={brand.logo}
                  alt={brand.name}
                  sizes="160px"
                  className="h-auto max-h-10 w-auto max-w-full object-contain md:max-h-14"
                />
              ) : (
                brand.name
              )}
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
        {COMPARE_ENABLED ? (
          <Button to={COMPARE_PATH} variant="inverse-outline" size="lg">
            Compare mattresses
          </Button>
        ) : null}
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
