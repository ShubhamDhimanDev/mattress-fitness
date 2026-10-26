import {Analytics} from '~/lib/hydrogen/analytics';
import {keyedText} from '~/lib/shopify/keys';
import {useLoaderData} from 'react-router';
import type {Route} from './+types/collections.$handle';
import {ProductListing} from '~/components/collection/ProductListing';
import {formatPageTitle} from '~/components/layout/documentTitle';
import {Accordion} from '~/components/ui/Accordion';
import {Breadcrumb} from '~/components/ui/Breadcrumb';
import {cn} from '~/components/ui/cn';
import {displayHeadingClass} from '~/lib/display-type';
import {SORT_KEYS, parseFilterParams} from '~/lib/filters';
import {buildBreadcrumbJsonLd, buildFaqJsonLd} from '~/lib/shopify/jsonld';
import {isValidHandle, loadCollectionPage} from '~/lib/shopify/collection-data';
import {loadPromoTiles} from '~/lib/shopify/promo-data';
import {showsPromoTiles} from '~/lib/shopify/promo-placement';
import {canonicalMeta, canonicalUrl} from '~/lib/seo/canonical';
import {resolveSiteOrigin} from '~/lib/site-origin';

export const meta: Route.MetaFunction = ({data}) => {
  if (!data) return [{title: formatPageTitle('Collection not found')}];
  return [
    {title: formatPageTitle(data.collection.seoTitle ?? data.collection.title)},
    // Every filtered, sorted or paginated view points at the plain collection URL (DEC-044, SEO_POLICY.md).
    ...canonicalMeta(data.canonicalHref),
    ...(data.collection.seoDescription
      ? [{name: 'description', content: data.collection.seoDescription}]
      : []),
    ...(data.breadcrumbJsonLd
      ? [{'script:ld+json': data.breadcrumbJsonLd}]
      : []),
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
  // Never the request's Host (P-L2); with no site origin configured there is no canonical and no breadcrumb markup.
  const origin = resolveSiteOrigin({
    env: context.env,
    requestUrl: request.url,
    isDev: import.meta.env.DEV,
  });
  const collectionPath = `/collections/${encodeURIComponent(page.collection.handle)}`;
  // Breadcrumb items must be absolute URLs, so without an origin there is no breadcrumb markup at all.
  const breadcrumbJsonLd =
    origin === null
      ? null
      : buildBreadcrumbJsonLd(
          [
            {name: 'Home', path: '/'},
            {name: 'Collections', path: '/collections'},
            {
              name: page.collection.title,
              path: collectionPath,
            },
          ],
          origin,
        );
  return {
    ...page,
    promoTiles,
    breadcrumbJsonLd,
    canonicalHref: canonicalUrl(origin, collectionPath),
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
      {/* The rule under the title (and the description, when there is one) separates it from the listing. */}
      <header className="mt-2 border-b border-line pb-4">
        <h1 className={cn(displayHeadingClass(collection.title), 'text-3xl')}>
          {collection.title}
        </h1>
        {collection.description.length > 0 ? (
          <div className="mt-2 max-w-prose text-base text-fg-muted">
            {keyedText(collection.description).map((paragraph) => (
              <p key={paragraph.key}>{paragraph.text}</p>
            ))}
          </div>
        ) : null}
      </header>

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
            findInPage
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
