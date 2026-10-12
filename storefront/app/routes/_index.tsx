import {Await, useLoaderData, Link} from 'react-router';
import type {Route} from './+types/_index';
import {Suspense} from 'react';
import {Image} from '@shopify/hydrogen';
import type {
  FeaturedCollectionFragment,
  RecommendedProductsQuery,
} from 'storefrontapi.generated';
import {ProductItem} from '~/components/ProductItem';
import {MockShopNotice} from '~/components/MockShopNotice';
import {formatPageTitle} from '~/components/layout/documentTitle';
import {Button} from '~/components/ui/Button';
import {SHOP_BY_SIZE_LINKS, STORE_LOCATOR_PATH} from '~/lib/navigation';

export const meta: Route.MetaFunction = () => {
  return [{title: formatPageTitle()}];
};

export async function loader(args: Route.LoaderArgs) {
  // Start fetching non-critical data without blocking time to first byte
  const deferredData = loadDeferredData(args);

  // Await the critical data required to render initial state of the page
  const criticalData = await loadCriticalData(args);

  return {...deferredData, ...criticalData};
}

/**
 * Load data necessary for rendering content above the fold. This is the critical data
 * needed to render the page. If it's unavailable, the whole page should 400 or 500 error.
 */
async function loadCriticalData({context}: Route.LoaderArgs) {
  const [{collections}] = await Promise.all([
    context.storefront.query(FEATURED_COLLECTION_QUERY),
    // Add other queries here, so that they are loaded in parallel
  ]);

  return {
    isShopLinked: Boolean(context.env.PUBLIC_STORE_DOMAIN),
    featuredCollection: collections.nodes[0],
  };
}

/**
 * Load data for rendering content below the fold. This data is deferred and will be
 * fetched after the initial page load. If it's unavailable, the page should still 200.
 * Make sure to not throw any errors here, as it will cause the page to 500.
 */
function loadDeferredData({context}: Route.LoaderArgs) {
  const recommendedProducts = context.storefront
    .query(RECOMMENDED_PRODUCTS_QUERY)
    .catch((error: Error) => {
      // Log query errors, but don't throw them so the page can still render
      console.error(error);
      return null;
    });

  return {
    recommendedProducts,
  };
}

export default function Homepage() {
  const data = useLoaderData<typeof loader>();
  return (
    <div className="home">
      {data.isShopLinked ? null : <MockShopNotice />}
      {/* TODO(P3B-13): temporary home built from the shell components. The real sections come from
          Shopify admin and are reorderable there; replace everything in this file's JSX then. */}
      <HeroPlaceholder />
      <ShopBySizePlaceholder />
      <FeaturedCollection collection={data.featuredCollection} />
      <RecommendedProducts products={data.recommendedProducts} />
    </div>
  );
}

// TODO(P3B-13): placeholder copy; the banner, headline and calls to action are managed in Shopify admin.
function HeroPlaceholder() {
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
        Placeholder hero text. Browse by size, comfort and type, or take the
        sleep quiz.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button
          to="/collections/mattresses"
          variant="accent"
          shape="pill"
          size="lg"
        >
          Shop mattresses
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

// TODO(P3B-13): sizes come from the catalog; two columns on a phone, three from 768 px.
function ShopBySizePlaceholder() {
  return (
    <section aria-labelledby="shop-by-size-heading" className="py-8 md:py-12">
      <h2
        id="shop-by-size-heading"
        className="text-center text-2xl font-bold tracking-wide uppercase"
      >
        Shop by size
      </h2>
      <ul className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3">
        {SHOP_BY_SIZE_LINKS.map((size) => (
          <li key={size.to}>
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

function FeaturedCollection({
  collection,
}: {
  collection: FeaturedCollectionFragment;
}) {
  if (!collection) return null;
  const image = collection?.image;
  return (
    <Link
      className="featured-collection"
      to={`/collections/${collection.handle}`}
    >
      {image && (
        <div className="featured-collection-image">
          <Image
            data={image}
            sizes="100vw"
            alt={image.altText || collection.title}
          />
        </div>
      )}
      <h2>{collection.title}</h2>
    </Link>
  );
}

function RecommendedProducts({
  products,
}: {
  products: Promise<RecommendedProductsQuery | null>;
}) {
  return (
    <section
      className="recommended-products"
      aria-labelledby="recommended-products"
    >
      <h2 id="recommended-products">Recommended Products</h2>
      <Suspense fallback={<div>Loading...</div>}>
        <Await resolve={products}>
          {(response) => (
            <div className="recommended-products-grid">
              {response
                ? response.products.nodes.map((product) => (
                    <ProductItem key={product.id} product={product} />
                  ))
                : null}
            </div>
          )}
        </Await>
      </Suspense>
      <br />
    </section>
  );
}

const FEATURED_COLLECTION_QUERY = `#graphql
  fragment FeaturedCollection on Collection {
    id
    title
    image {
      id
      url
      altText
      width
      height
    }
    handle
  }
  query FeaturedCollection($country: CountryCode, $language: LanguageCode)
    @inContext(country: $country, language: $language) {
    collections(first: 1, sortKey: UPDATED_AT, reverse: true) {
      nodes {
        ...FeaturedCollection
      }
    }
  }
` as const;

const RECOMMENDED_PRODUCTS_QUERY = `#graphql
  fragment RecommendedProduct on Product {
    id
    title
    handle
    priceRange {
      minVariantPrice {
        amount
        currencyCode
      }
    }
    featuredImage {
      id
      url
      altText
      width
      height
    }
  }
  query RecommendedProducts ($country: CountryCode, $language: LanguageCode)
    @inContext(country: $country, language: $language) {
    products(first: 4, sortKey: UPDATED_AT, reverse: true) {
      nodes {
        ...RecommendedProduct
      }
    }
  }
` as const;
