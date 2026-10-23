import {Image} from '@shopify/hydrogen';
import {Link} from 'react-router';
import {ProductItem} from '~/components/ProductItem';
import {Button} from '~/components/ui/Button';
import {cn} from '~/components/ui/cn';
import {displayHeadingClass} from '~/lib/display-type';
import type {HomeData} from '~/lib/shopify/home-data';

// The four home blocks whose content comes from the catalog (REQ-HOME-001). Each is left out when its data
// is missing, so a new or half-configured store still gets a working page; the heading can be replaced from
// the `homepage_section` entry in admin.

type SectionProps = {
  id: string;
  /** Heading set in admin, or null for the default. */
  heading: string | null;
};

// Section headings are the heavy uppercase display type unless the admin text is long (lib/display-type.ts).
function headingClass(text: string, extra: string): string {
  return cn(displayHeadingClass(text), extra);
}

const SECTION_LINK =
  'inline-flex min-h-touch items-center font-bold text-primary-700 underline underline-offset-2 hover:text-primary-800 hover:no-underline';

export function SizeTiles({
  id,
  heading,
  tiles,
}: SectionProps & {tiles: HomeData['sizeTiles']}) {
  if (tiles.length === 0) return null;
  const headingId = `${id}-heading`;
  const text = heading ?? 'Shop by size';
  return (
    <section aria-labelledby={headingId} className="py-8 md:py-12">
      {/* Large text, so the brand red on white (5.08:1) is allowed here (spec 5.4). */}
      <h2
        id={headingId}
        className={headingClass(
          text,
          'text-center text-2xl text-primary-500 md:text-3xl',
        )}
      >
        {text}
      </h2>
      <ul className="mx-auto mt-6 grid max-w-2xl grid-cols-2 gap-3 md:grid-cols-3 md:gap-4">
        {tiles.map((size) => (
          <li key={size.label}>
            <Button to={size.to} variant="primary" size="lg" fullWidth>
              {size.label}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The list a home card reports: the featured collection's handle, or a fixed id when it has none. */
function featuredListId(handle: string | null): string {
  return handle ?? 'featured-products';
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
    <section aria-labelledby={headingId} className="py-8 md:py-12">
      <div className="flex items-end justify-between gap-4">
        <h2
          id={headingId}
          className={headingClass(text, 'text-2xl md:text-3xl')}
        >
          {text}
        </h2>
        {featured.handle ? (
          <Link to={`/collections/${featured.handle}`} className={SECTION_LINK}>
            View all
          </Link>
        ) : null}
      </div>
      <ul className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-6">
        {featured.products.slice(0, 8).map((product, index) => (
          <li key={product.id}>
            <ProductItem
              product={product}
              loading={index < 4 ? 'eager' : 'lazy'}
              analytics={{
                listId: featuredListId(featured.handle),
                position: index,
              }}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

export function BrandTiles({
  id,
  heading,
  tiles,
}: SectionProps & {tiles: HomeData['brandTiles']}) {
  if (tiles.length === 0) return null;
  const headingId = `${id}-heading`;
  const text = heading ?? 'Shop by brand';
  return (
    <section aria-labelledby={headingId} className="py-8 md:py-12">
      <div className="flex items-end justify-between gap-4">
        <h2
          id={headingId}
          className={headingClass(text, 'text-2xl md:text-3xl')}
        >
          {text}
        </h2>
        {tiles.some((tile) => tile.to.startsWith('/brands/')) ? (
          <Link to="/brands" className={SECTION_LINK}>
            All brands
          </Link>
        ) : null}
      </div>
      <ul className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        {tiles.map((brand) => (
          <li key={brand.name}>
            <Link
              to={brand.to}
              className="flex min-h-touch items-center justify-center gap-2 rounded-card border border-line bg-surface p-4 text-center font-bold motion-safe:transition-shadow hover:border-primary-500 hover:shadow-md"
            >
              {brand.logo ? (
                <Image
                  data={brand.logo}
                  alt=""
                  sizes="120px"
                  className="h-auto max-h-10 w-auto"
                />
              ) : null}
              {brand.name}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function CategoryTiles({
  id,
  heading,
  tiles,
}: SectionProps & {tiles: HomeData['collectionTiles']}) {
  if (tiles.length === 0) return null;
  const headingId = `${id}-heading`;
  const text = heading ?? 'Shop by category';
  return (
    <section aria-labelledby={headingId} className="py-8 md:py-12">
      <h2 id={headingId} className={headingClass(text, 'text-2xl md:text-3xl')}>
        {text}
      </h2>
      <ul className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4">
        {tiles.map((tile, index) => (
          <li key={tile.to}>
            {/* The label sits over the image on a dark overlay (white on it: 4.8:1 at worst, 15.13:1 with no image). The focus
                ring is drawn outside the tile, on the white page, so it keeps the default blue (yellow would be 1.5:1 there);
                the spec's "overlay is on-dark" applies to rings drawn on the band itself. The link text is the collection title. */}
            <Link
              to={tile.to}
              prefetch="intent"
              className="group relative block aspect-[4/3] overflow-hidden rounded-card bg-ink-800"
            >
              {tile.image ? (
                <Image
                  data={tile.image}
                  alt=""
                  aspectRatio="4/3"
                  sizes="(min-width: 768px) 30vw, 46vw"
                  loading={index < 2 ? 'eager' : 'lazy'}
                  className="size-full object-cover motion-safe:transition-transform motion-safe:group-hover:scale-105"
                />
              ) : null}
              <span
                className={cn(
                  displayHeadingClass(tile.title),
                  'absolute inset-0 flex items-center justify-center bg-ink-900/60 px-3 text-center text-base text-white group-hover:underline md:text-xl',
                )}
              >
                {tile.title}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
