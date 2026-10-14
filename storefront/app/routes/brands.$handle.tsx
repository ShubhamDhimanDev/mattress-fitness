import {keyedText} from '~/lib/shopify/keys';
import {useLoaderData} from 'react-router';
import type {Route} from './+types/brands.$handle';
import {BrandHeader} from '~/components/brand/BrandHeader';
import {ProductListing} from '~/components/collection/ProductListing';
import {formatPageTitle} from '~/components/layout/documentTitle';
import {PreviewNotice} from '~/components/pages/PreviewNotice';
import {Breadcrumb} from '~/components/ui/Breadcrumb';
import {SORT_KEYS, parseFilterParams} from '~/lib/filters';
import {previewRobotsMeta} from '~/lib/pages/head';
import {buildBrandJsonLd, loadBrandPage} from '~/lib/shopify/brand-data';
import {buildBreadcrumbJsonLd} from '~/lib/shopify/jsonld';
import {resolveSiteOrigin} from '~/lib/site-origin';

// Brand page (REQ-COL-005, P3B-06): the brand's content from its `brand` metaobject, then its products in
// the shared listing with the standard filters.

const MAX_DESCRIPTION_LENGTH = 160;

export const meta: Route.MetaFunction = ({data}) => {
  if (!data) return [{title: formatPageTitle('Brand not found')}];
  const description = data.brand.about[0]?.slice(0, MAX_DESCRIPTION_LENGTH);
  return [
    ...previewRobotsMeta(data.source),
    {title: formatPageTitle(data.brand.name)},
    ...(description && data.source === 'shopify'
      ? [{name: 'description', content: description}]
      : []),
    ...(data.jsonLd
      ? [
          {'script:ld+json': data.jsonLd},
          {'script:ld+json': data.breadcrumbJsonLd},
        ]
      : []),
  ];
};

export async function loader({context, params, request}: Route.LoaderArgs) {
  const state = parseFilterParams(new URL(request.url).searchParams);
  const page = await loadBrandPage(
    context.storefront,
    params.handle ?? '',
    state,
  );
  if (page.status === 'not-found') {
    throw new Response('Brand not found', {status: 404});
  }

  // Never the request's Host (P-L2); relative URLs when no site origin is configured.
  const origin =
    resolveSiteOrigin({
      env: context.env,
      requestUrl: request.url,
      isDev: import.meta.env.DEV,
    }) ?? '';
  // Sample brands are fictional and noindex: no structured data for them.
  const real = page.source === 'shopify';
  return {
    ...page,
    jsonLd: real ? buildBrandJsonLd(page.brand, origin) : null,
    breadcrumbJsonLd: buildBreadcrumbJsonLd(
      [
        {name: 'Home', path: '/'},
        {name: 'Brands', path: '/brands'},
        {name: page.brand.name, path: `/brands/${page.brand.handle}`},
      ],
      origin,
    ),
  };
}

export default function BrandPage() {
  const data = useLoaderData<typeof loader>();
  const {brand} = data;
  const real = data.source === 'shopify';

  return (
    <div className="py-4">
      <Breadcrumb
        items={[
          {label: 'Home', to: '/'},
          {label: 'Brands', to: '/brands'},
          {label: brand.name},
        ]}
      />
      <BrandHeader name={brand.name} logo={brand.logo} about={brand.about} />

      {data.source === 'fixtures' ? (
        <div className="mt-4">
          <PreviewNotice subject="brand and products" />
        </div>
      ) : null}

      <ProductListing
        products={data.products}
        pageInfo={data.pageInfo}
        filterGroups={data.filterGroups}
        showFilters={real}
        sortKeys={real ? SORT_KEYS : ['featured']}
        emptyHeading={`No ${brand.name} products match these filters`}
      />

      {brand.warranty.length > 0 ? (
        <section aria-labelledby="brand-warranty-heading" className="mt-12">
          <h2 id="brand-warranty-heading" className="mb-3 text-2xl font-bold">
            Warranty
          </h2>
          <div className="flex max-w-prose flex-col gap-2 text-base">
            {keyedText(brand.warranty).map((paragraph) => (
              <p key={paragraph.key}>{paragraph.text}</p>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
