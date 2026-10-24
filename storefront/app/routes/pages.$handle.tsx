import {redirect, useLoaderData} from 'react-router';
import type {Route} from './+types/pages.$handle';
import {ContentArticle} from '~/components/pages/ContentArticle';
import {formatPageTitle} from '~/components/layout/documentTitle';
import {SITE_NAME} from '~/lib/navigation';
import {
  contentPageByHandle,
  policyRedirectFor,
} from '~/lib/pages/content-pages';
import {
  buildContentDocument,
  displayView,
  headTags,
} from '~/lib/pages/content-pages-view';
import {redirectIfHandleIsLocalized} from '~/lib/redirect';
import {canonicalUrl} from '~/lib/seo/canonical';
import {resolveSiteOrigin} from '~/lib/site-origin';
import {catalogCache} from '~/lib/shopify/cache';
import {isValidHandle} from '~/lib/shopify/collection-data';
import {loadContentAvailability} from '~/lib/shopify/content-pages-data';

// Title, description, robots, canonical, social tags and structured data are all prepared by the loader
// (`buildContentDocument`), so this function stays a plain read and the logic stays out of the browser bundle.
export const meta: Route.MetaFunction = ({data}) => {
  return data?.head ?? [{title: formatPageTitle('Page not found')}];
};

export async function loader({context, request, params}: Route.LoaderArgs) {
  const {handle} = params;
  if (!isValidHandle(handle)) {
    throw new Response('Not Found', {status: 404});
  }
  const {storefront} = context;

  const {page} = await storefront.query(PAGE_QUERY, {
    cache: catalogCache(storefront),
    variables: {handle},
  });

  if (!page) {
    // Privacy policy and terms are kept in Shopify Settings > Policies as one copy; the old page URL leads there
    // unless a page with that handle exists (checked above). The read is the footer's cached one.
    const registered = contentPageByHandle(handle);
    const target = registered?.policy
      ? policyRedirectFor(handle, await loadContentAvailability(storefront))
      : null;
    if (target) throw redirect(target, 301);
    throw new Response('Not Found', {status: 404});
  }

  redirectIfHandleIsLocalized(request, {handle, data: page});

  const registered = contentPageByHandle(page.handle);
  const origin = resolveSiteOrigin({
    env: context.env,
    requestUrl: request.url,
    isDev: import.meta.env.DEV,
  });
  const path = `/pages/${page.handle}`;
  const view = buildContentDocument({
    title: page.title,
    fallbackTitle: registered?.title,
    body: page.body,
    seoTitle: page.seo?.title,
    seoDescription: page.seo?.description,
    updatedAt: page.updatedAt,
    faq: registered?.faq === true,
    path,
    origin,
    canonical: canonicalUrl(origin, path),
    siteName: SITE_NAME,
  });

  return {
    page: {handle: page.handle, body: page.body},
    view: displayView(view),
    head: headTags(formatPageTitle(view.seoTitle), view),
  };
}

export default function Page() {
  const {page, view} = useLoaderData<typeof loader>();

  return <ContentArticle {...view} body={page.body} />;
}

// NOTE: https://shopify.dev/docs/api/storefront/latest/objects/Page
const PAGE_QUERY = `#graphql
  query Page(
    $language: LanguageCode,
    $country: CountryCode,
    $handle: String!
  )
  @inContext(language: $language, country: $country) {
    page(handle: $handle) {
      handle
      id
      title
      body
      updatedAt
      seo {
        description
        title
      }
    }
  }
` as const;
