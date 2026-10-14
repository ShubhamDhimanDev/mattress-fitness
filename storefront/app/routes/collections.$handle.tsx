import {Analytics} from '@shopify/hydrogen';
import {keyedText} from '~/lib/shopify/keys';
import {useLoaderData} from 'react-router';
import type {Route} from './+types/collections.$handle';
import {ProductListing} from '~/components/collection/ProductListing';
import {formatPageTitle} from '~/components/layout/documentTitle';
import {Accordion} from '~/components/ui/Accordion';
import {Breadcrumb} from '~/components/ui/Breadcrumb';
import {SORT_KEYS, parseFilterParams} from '~/lib/filters';
import {buildBreadcrumbJsonLd, buildFaqJsonLd} from '~/lib/shopify/jsonld';
import {isValidHandle, loadCollectionPage} from '~/lib/shopify/collection-data';
import {loadPromoTiles} from '~/lib/shopify/promo-data';
import {showsPromoTiles} from '~/lib/shopify/promo-placement';
import {resolveSiteOrigin} from '~/lib/site-origin';

export const meta: Route.MetaFunction = ({data}) => {
  if (!data) return [{title: formatPageTitle('Collection not found')}];
  return [
    {title: formatPageTitle(data.collection.seoTitle ?? data.collection.title)},
    ...(data.collection.seoDescription
      ? [{name: 'description', content: data.collection.seoDescription}]
      : []),
    {'script:ld+json': data.breadcrumbJsonLd},
    ...(data.faqJsonLd ? [{'script:ld+json': data.faqJsonLd}] : []),
  ];
};

export async function loader({context, params, request}: Route.LoaderArgs) {
  const url = new URL(request.url);
  const state = parseFilterParams(url.searchParams);
  const handle = params.handle ?? '';
  // Tiles are read alongside the products; a failed tile read only means a grid without tiles. They belong to
  // the unfiltered, default-sorted first view only, so other views skip the read.
  const [page, promoTiles] = await Promise.all([
    loadCollectionPage(context.storefront, handle, state),
    isValidHandle(handle) && showsPromoTiles(state)
      ? loadPromoTiles(context.storefront, handle)
      : Promise.resolve([]),
  ]);
  if (page.status === 'not-found') {
    throw new Response('Collection not found', {status: 404});
  }
  const breadcrumbJsonLd = buildBreadcrumbJsonLd(
    [
      {name: 'Home', path: '/'},
      {name: 'Collections', path: '/collections'},
      {
        name: page.collection.title,
        path: `/collections/${page.collection.handle}`,
      },
    ],
    // Never the request's Host (P-L2); relative URLs when no site origin is configured.
    resolveSiteOrigin({
      env: context.env,
      requestUrl: request.url,
      isDev: import.meta.env.DEV,
    }) ?? '',
  );
  return {
    ...page,
    promoTiles,
    breadcrumbJsonLd,
    faqJsonLd: buildFaqJsonLd(page.collection.faqs),
  };
}

export default function Collection() {
  const data = useLoaderData<typeof loader>();
  const {collection} = data;

  return (
    <div className="py-4">
      <Breadcrumb
        items={[
          {label: 'Home', to: '/'},
          {label: 'Collections', to: '/collections'},
          {label: collection.title},
        ]}
      />
      <h1 className="mt-2 text-3xl font-bold">{collection.title}</h1>
      {collection.description.length > 0 ? (
        <div className="mt-2 max-w-prose text-base text-fg-muted">
          {keyedText(collection.description).map((paragraph) => (
            <p key={paragraph.key}>{paragraph.text}</p>
          ))}
        </div>
      ) : null}

      <ProductListing
        products={data.products}
        pageInfo={data.pageInfo}
        filterGroups={data.filterGroups}
        showFilters
        sortKeys={SORT_KEYS}
        emptyHeading="No products match these filters"
        promoTiles={data.promoTiles}
      />

      {collection.faqs.length > 0 ? (
        <section aria-labelledby="collection-faq-heading" className="mt-12">
          <h2 id="collection-faq-heading" className="mb-3 text-2xl font-bold">
            Frequently asked questions
          </h2>
          <Accordion
            type="multiple"
            headingLevel={3}
            items={collection.faqs.map((faq) => ({
              id: faq.id,
              title: faq.question,
              content: (
                <div className="flex max-w-prose flex-col gap-2">
                  {keyedText(faq.answer).map((paragraph) => (
                    <p key={paragraph.key}>{paragraph.text}</p>
                  ))}
                </div>
              ),
            }))}
          />
        </section>
      ) : null}

      <Analytics.CollectionView
        data={{collection: {id: collection.id, handle: collection.handle}}}
      />
    </div>
  );
}
