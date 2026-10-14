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
import {
  loadExtendEligibility,
  loadProductPage,
} from '~/lib/shopify/product-data';
import {
  hasDevEligibleCookie,
  protectionModeFor,
} from '~/lib/shopify/protection-mode';
import {offersConfigOf} from '~/lib/extend/runtime';
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
    ...(data.canonical
      ? [{tagName: 'link', rel: 'canonical', href: data.canonical}]
      : []),
    {'script:ld+json': data.productJsonLd},
    {'script:ld+json': data.breadcrumbJsonLd},
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
  productId: string,
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
    : await loadExtendEligibility(context.storefront, productId);
  return protectionModeFor({enabled, eligible});
}

export async function loader({context, params, request}: Route.LoaderArgs) {
  const result = await loadProductPage(context.storefront, params.handle ?? '');
  if (result.status === 'not-found') {
    throw new Response('Product not found', {status: 404});
  }
  const {product} = result;
  // Never the request's Host (P-L2); null outside development without PUBLIC_SITE_URL, so URLs stay relative.
  const siteOrigin = resolveSiteOrigin({
    env: context.env,
    requestUrl: request.url,
    isDev: import.meta.env.DEV,
  });
  const origin = siteOrigin ?? '';
  const protection = await protectionModeOf(context, request, product.id);
  return {
    product,
    // The Extend flag and the product's own eligibility (P5A-05): the same for every shopper, so neither touches a
    // cache key. 'off' costs the page no request and no reserved space (NFR-002).
    protection,
    canonical: siteOrigin ? `${siteOrigin}/products/${product.handle}` : null,
    productJsonLd: buildProductJsonLd(product, origin),
    breadcrumbJsonLd: buildBreadcrumbJsonLd(
      [
        {name: 'Home', path: '/'},
        {name: 'Collections', path: '/collections'},
        {name: product.title, path: `/products/${product.handle}`},
      ],
      origin,
    ),
  };
}

export default function Product() {
  const {product, protection} = useLoaderData<typeof loader>();
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
      <div className="mt-4 grid gap-8 lg:grid-cols-2">
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
        />
      </div>
      <ProductSections product={product} />
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
