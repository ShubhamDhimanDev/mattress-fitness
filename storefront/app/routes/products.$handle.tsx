import {Analytics} from '@shopify/hydrogen';
import {
  useLoaderData,
  useSearchParams,
  type ShouldRevalidateFunction,
} from 'react-router';
import type {Route} from './+types/products.$handle';
import {formatPageTitle} from '~/components/layout/documentTitle';
import {ProductBuyBox} from '~/components/product/ProductBuyBox';
import {ProductGallery} from '~/components/product/ProductGallery';
import {ProductSections} from '~/components/product/ProductSections';
import {Breadcrumb} from '~/components/ui/Breadcrumb';
import {buildBreadcrumbJsonLd, buildProductJsonLd} from '~/lib/shopify/jsonld';
import {loadBrandsIndex} from '~/lib/shopify/brand-data';
import {resolveBrandLink} from '~/lib/shopify/brand-link';
import {loadProductPage} from '~/lib/shopify/product-data';
import {loadExtendEligibilityByHandle} from '~/lib/shopify/protection-load';
import {
  hasDevEligibleCookie,
  protectionModeFor,
} from '~/lib/shopify/protection-mode';
import {offersConfigOf} from '~/lib/extend/runtime';
import {loadOfferOnlyHandles} from '~/lib/shopify/offer-only';
import {hasDevAddOnsCookie} from '~/lib/offers-runtime/product-addons';
import {productHasAddOns} from '~/lib/offers-runtime/product-addons-server';
import {resolveSiteOrigin} from '~/lib/site-origin';
import {
  parseSelectedOptions,
  selectVariant,
} from '~/lib/shopify/variant-selection';

export const meta: Route.MetaFunction = ({data}) => {
  if (!data) return [{title: formatPageTitle('Product not found')}];
  const {product} = data;
  return [
    {title: formatPageTitle(product.seoTitle ?? product.title)},
    ...(product.seoDescription
      ? [{name: 'description', content: product.seoDescription}]
      : []),
    // Offer-only products (Extend price points, services, gifts, protectors) are not content (K-L3).
    ...(data.offerOnly ? [{name: 'robots', content: 'noindex,follow'}] : []),
    ...(data.canonical
      ? [{tagName: 'link', rel: 'canonical', href: data.canonical}]
      : []),
    {'script:ld+json': data.productJsonLd},
    // Breadcrumb items must be absolute URLs, so without a site origin there is no breadcrumb markup.
    ...(data.breadcrumbJsonLd
      ? [{'script:ld+json': data.breadcrumbJsonLd}]
      : []),
  ];
};

/**
 * Changing the size only changes the search string; every variant is already on the page, so there is
 * nothing to refetch. Mutations (add to cart) still revalidate as usual.
 */
export const shouldRevalidate: ShouldRevalidateFunction = ({
  currentUrl,
  nextUrl,
  formMethod,
  defaultShouldRevalidate,
}) => {
  if (formMethod && formMethod !== 'GET') return defaultShouldRevalidate;
  if (currentUrl.pathname === nextUrl.pathname) return false;
  return defaultShouldRevalidate;
};

/**
 * Development only: the mock stores have no `custom.extend_category` metafield, so the e2e spec opts a page in with this
 * cookie. `import.meta.env.DEV` is false in a production build, so the branch is removed there and no request can opt in.
 */
async function protectionModeOf(
  context: Route.LoaderArgs['context'],
  request: Request,
  handle: string,
) {
  const enabled =
    offersConfigOf({env: context.env, production: import.meta.env.PROD})
      .status === 'enabled';
  if (!enabled) return protectionModeFor({enabled, eligible: false});
  const assumed =
    import.meta.env.DEV &&
    hasDevEligibleCookie(request.headers.get('Cookie') ?? '');
  const eligible = assumed
    ? true
    : await loadExtendEligibilityByHandle(context.storefront, handle);
  return protectionModeFor({enabled, eligible});
}

export async function loader({context, params, request}: Route.LoaderArgs) {
  const handle = params.handle ?? '';
  // All three reads depend on the handle only, so they start together instead of one after the other (review m7).
  // The two side reads never reject (they answer null / an empty set on failure), so a failed product read cannot
  // leave one of them as an unhandled rejection.
  //
  // Cost of an unknown handle (valid shape, no product): the reads are already in flight when the 404 is known, so
  // it makes up to three per-handle reads, but every one of them carries a cache strategy (content long, the
  // availability and category reads the 60 s priced window) and Hydrogen caches the empty answers too, so repeats of
  // the same handle cost nothing upstream. The alternative, starting the category read only after the product
  // exists, would put a serial round trip in front of every real product page to save a bounded, cached cost on
  // pages nobody should be requesting (review m7). A malformed handle never reaches any read (`isValidHandle`).
  const [result, protection, offerOnlyHandles, brands] = await Promise.all([
    loadProductPage(context.storefront, handle),
    protectionModeOf(context, request, handle),
    loadOfferOnlyHandles(context.storefront),
    // Cached for the long catalog window and never rejects (an empty list on failure): the brand link is an extra.
    // Fixtures are offered only where the brand pages themselves would show them, never in production.
    loadBrandsIndex(context.storefront, {allowFixtures: !import.meta.env.PROD}),
  ]);
  if (result.status === 'not-found') {
    throw new Response('Product not found', {status: 404});
  }
  const {product} = result;
  // Never the request's Host (P-L2); null outside development without PUBLIC_SITE_URL: no absolute URL is then emitted.
  const siteOrigin = resolveSiteOrigin({
    env: context.env,
    requestUrl: request.url,
    isDev: import.meta.env.DEV,
  });
  return {
    product,
    offerOnly: offerOnlyHandles.has(product.handle),
    // A link to the brand page, or null for plain text; it needs a brand entry behind it (REQ-COL-005).
    brandLink: resolveBrandLink({
      vendor: product.vendor,
      brand: product.brand,
      index: brands.brands,
    }),
    // The Extend flag and the product's own eligibility (P5A-05): the same for every shopper, so neither touches a
    // cache key. 'off' costs the page no request and no reserved space (NFR-002).
    protection,
    // Whether the offer rules relate foundations, bases or frames to this product (P4-03): rules only, no Shopify read,
    // the same for every shopper. The slot asks for the list itself after load (/api/product-addons). The e2e cookie
    // opts a page in during development only, because the dev server has no offer configuration.
    addOnsExpected:
      (import.meta.env.DEV &&
        hasDevAddOnsCookie(request.headers.get('Cookie') ?? '')) ||
      productHasAddOns(context.env, product.id),
    canonical: siteOrigin ? `${siteOrigin}/products/${product.handle}` : null,
    productJsonLd: buildProductJsonLd(product, siteOrigin),
    breadcrumbJsonLd: buildBreadcrumbJsonLd(
      [
        {name: 'Home', path: '/'},
        {name: 'Collections', path: '/collections'},
        {name: product.title, path: `/products/${product.handle}`},
      ],
      siteOrigin,
    ),
  };
}

export default function Product() {
  const {product, protection, brandLink, addOnsExpected} =
    useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();

  // The same pure functions the server used, so the first render and later switches always agree.
  const variant = selectVariant(
    product.variants,
    parseSelectedOptions(searchParams, product.options),
  );
  if (!variant) return null;
  const variantImageIndex = variant.image
    ? product.images.findIndex((image) => image.url === variant.image?.url)
    : -1;

  return (
    <div className="py-4">
      <Breadcrumb
        items={[
          {label: 'Home', to: '/'},
          {label: 'Collections', to: '/collections'},
          {label: product.title},
        ]}
      />
      <div className="mt-4 grid gap-8 lg:grid-cols-2 lg:gap-10">
        <ProductGallery
          key={variant.image?.url ?? 'default'}
          images={product.images}
          title={product.title}
          initialIndex={Math.max(variantImageIndex, 0)}
        />
        <ProductBuyBox
          key={product.id}
          product={product}
          variant={variant}
          protection={protection}
          brandLink={brandLink}
          addOns={addOnsExpected}
        />
      </div>
      <ProductSections product={product} brandLink={brandLink} />
      <Analytics.ProductView
        data={{
          products: [
            {
              id: product.id,
              title: product.title,
              price: variant.price.amount,
              vendor: product.vendor,
              variantId: variant.id,
              variantTitle: variant.title,
              quantity: 1,
            },
          ],
        }}
      />
    </div>
  );
}
