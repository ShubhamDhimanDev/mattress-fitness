import {Image} from '@shopify/hydrogen';
import {Link} from 'react-router';
import {ProductItem} from '~/components/ProductItem';
import {Button} from '~/components/ui/Button';
import type {HomeData} from '~/lib/shopify/home-data';

// The four home blocks whose content comes from the catalog (REQ-HOME-001). Each is left out when its data
// is missing, so a new or half-configured store still gets a working page; the heading can be replaced from
// the `homepage_section` entry in admin.

type SectionProps = {
  id: string;
  /** Heading set in admin, or null for the default. */
  heading: string | null;
};

export function SizeTiles({
  id,
  heading,
  tiles,
}: SectionProps & {tiles: HomeData['sizeTiles']}) {
  if (tiles.length === 0) return null;
  const headingId = `${id}-heading`;
  return (
    <section aria-labelledby={headingId} className="py-8 md:py-12">
      <h2
        id={headingId}
        className="text-center text-2xl font-bold tracking-wide uppercase"
      >
        {heading ?? 'Shop by size'}
      </h2>
      <ul className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3">
        {tiles.map((size) => (
          <li key={size.label}>
            <Button
              to={size.to}
              variant="secondary"
              shape="pill"
              size="lg"
              fullWidth
            >
              {size.label}
            </Button>
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
  return (
    <section aria-labelledby={headingId} className="py-8">
      <div className="flex items-end justify-between gap-4">
        <h2 id={headingId} className="text-2xl font-bold">
          {heading ?? featured.title}
        </h2>
        {featured.handle ? (
          <Link
            to={`/collections/${featured.handle}`}
            className="inline-flex min-h-touch items-center font-bold text-primary-700 underline underline-offset-2"
          >
            View all
          </Link>
        ) : null}
      </div>
      <ul className="mt-4 grid grid-cols-2 gap-x-3 gap-y-6 md:grid-cols-4">
        {featured.products.slice(0, 8).map((product, index) => (
          <li key={product.id}>
            <ProductItem
              product={product}
              loading={index < 4 ? 'eager' : 'lazy'}
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
  return (
    <section aria-labelledby={headingId} className="py-8">
      <div className="flex items-end justify-between gap-4">
        <h2 id={headingId} className="text-2xl font-bold">
          {heading ?? 'Shop by brand'}
        </h2>
        {tiles.some((tile) => tile.to.startsWith('/brands/')) ? (
          <Link
            to="/brands"
            className="inline-flex min-h-touch items-center font-bold text-primary-700 underline underline-offset-2"
          >
            All brands
          </Link>
        ) : null}
      </div>
      <ul className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map((brand) => (
          <li key={brand.name}>
            <Link
              to={brand.to}
              className="flex min-h-touch items-center justify-center gap-2 rounded-card border-2 border-line p-4 text-center font-bold hover:border-ink-900"
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
  return (
    <section aria-labelledby={headingId} className="py-8">
      <h2 id={headingId} className="text-2xl font-bold">
        {heading ?? 'Shop by category'}
      </h2>
      <ul className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
        {tiles.map((tile, index) => (
          <li key={tile.to}>
            <Link
              to={tile.to}
              prefetch="intent"
              className="group relative block overflow-hidden rounded-card bg-surface-muted"
            >
              <div className="aspect-[4/3]">
                {tile.image ? (
                  <Image
                    data={tile.image}
                    alt=""
                    aspectRatio="4/3"
                    sizes="(min-width: 768px) 30vw, 46vw"
                    loading={index < 2 ? 'eager' : 'lazy'}
                    className="size-full object-cover"
                  />
                ) : null}
              </div>
              <span className="block p-3 text-base font-bold group-hover:underline">
                {tile.title}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
