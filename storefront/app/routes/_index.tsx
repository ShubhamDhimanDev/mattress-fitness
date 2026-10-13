import {Image} from '@shopify/hydrogen';
import {Link, useLoaderData} from 'react-router';
import type {Route} from './+types/_index';
import {ProductItem} from '~/components/ProductItem';
import {formatPageTitle} from '~/components/layout/documentTitle';
import {Button} from '~/components/ui/Button';
import {
  REASSURANCE_ITEMS,
  SLEEP_QUIZ_LINK,
  STORE_LOCATOR_PATH,
} from '~/lib/navigation';
import {loadHome} from '~/lib/shopify/home-data';

export const meta: Route.MetaFunction = () => [{title: formatPageTitle()}];

export async function loader({context}: Route.LoaderArgs) {
  return loadHome(context.storefront);
}

/**
 * Home (REQ-HOME-001). Every section below is built from catalog data and is simply left out when its data
 * is missing, so a new or half-configured store still gets a working page.
 */
export default function Homepage() {
  const home = useLoaderData<typeof loader>();

  return (
    <div>
      <Hero />
      {home.sizeTiles.length > 0 ? (
        <section
          aria-labelledby="shop-by-size-heading"
          className="py-8 md:py-12"
        >
          <h2
            id="shop-by-size-heading"
            className="text-center text-2xl font-bold tracking-wide uppercase"
          >
            Shop by size
          </h2>
          <ul className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3">
            {home.sizeTiles.map((size) => (
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
      ) : null}

      {home.featured ? (
        <section aria-labelledby="featured-heading" className="py-8">
          <div className="flex items-end justify-between gap-4">
            <h2 id="featured-heading" className="text-2xl font-bold">
              {home.featured.title}
            </h2>
            {home.featured.handle ? (
              <Link
                to={`/collections/${home.featured.handle}`}
                className="inline-flex min-h-touch items-center font-bold text-primary-700 underline underline-offset-2"
              >
                View all
              </Link>
            ) : null}
          </div>
          <ul className="mt-4 grid grid-cols-2 gap-x-3 gap-y-6 md:grid-cols-4">
            {home.featured.products.slice(0, 8).map((product, index) => (
              <li key={product.id}>
                <ProductItem
                  product={product}
                  loading={index < 4 ? 'eager' : 'lazy'}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {home.brandTiles.length > 0 ? (
        <section aria-labelledby="brands-heading" className="py-8">
          <h2 id="brands-heading" className="text-2xl font-bold">
            Shop by brand
          </h2>
          <ul className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            {home.brandTiles.map((brand) => (
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
      ) : null}

      {home.collectionTiles.length > 0 ? (
        <section aria-labelledby="collections-heading" className="py-8">
          <h2 id="collections-heading" className="text-2xl font-bold">
            Shop by category
          </h2>
          <ul className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
            {home.collectionTiles.map((tile, index) => (
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
      ) : null}

      <section
        aria-labelledby="assurance-heading"
        className="rounded-panel bg-primary-50 px-6 py-8"
      >
        <h2 id="assurance-heading" className="text-2xl font-bold">
          Buy with confidence
        </h2>
        <ul className="mt-4 grid gap-3 md:grid-cols-3">
          {REASSURANCE_ITEMS.map((item) => (
            <li key={item.id}>
              <Link
                to={item.to}
                className="inline-flex min-h-touch items-center font-bold text-primary-800 underline underline-offset-2"
              >
                {item.text}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* TODO(P7-02): email and text-message signup with recorded consent (Klaviyo) goes here. */}
    </div>
  );
}

// TODO(P3B-13): hero copy is placeholder text; the admin-editable `homepage_section` entries replace it once
// their `type` values are fixed with the homepage design (SHOPIFY_DATA_MODEL, definitions.json).
function Hero() {
  return (
    <section
      aria-labelledby="home-hero-heading"
      className="on-dark mt-4 rounded-panel bg-primary-800 px-6 py-12 text-white md:px-12 md:py-16"
    >
      <h1
        id="home-hero-heading"
        className="max-w-prose text-4xl leading-tight font-bold md:text-5xl"
      >
        Find the mattress that fits how you sleep
      </h1>
      <p className="mt-3 max-w-prose text-lg text-primary-100">
        Browse by size, comfort and type, or take the sleep quiz.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button to={SLEEP_QUIZ_LINK.to} variant="accent" shape="pill" size="lg">
          Take the sleep quiz
        </Button>
        <Button
          to={STORE_LOCATOR_PATH}
          variant="secondary"
          shape="pill"
          size="lg"
        >
          Find a store
        </Button>
      </div>
    </section>
  );
}
