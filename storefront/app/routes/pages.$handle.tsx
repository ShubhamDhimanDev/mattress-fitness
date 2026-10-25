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
import {contentCache, rememberFound} from '~/lib/shopify/content-pages-cache';
import {isValidHandle} from '~/lib/shopify/collection-data';
import {pageHasContent} from '~/lib/pages/content-pages-html';
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

  // The 15 registry handles are cached long; any other handle starts short and moves to long only once Shopify has
  // answered with a page for it, so junk handles leave no hour-long entries behind (security C-M2).
  const cacheKey = `page:${handle}`;
  const {page} = await storefront.query(PAGE_QUERY, {
    cache: contentCache(storefront, cacheKey, {
      // Exact match: /pages/FAQ and /pages/fAq are different cache keys and must not each get an hour-long entry (RR-L1).
      alwaysLong: contentPageByHandle(handle)?.handle === handle,
    }),
    variables: {handle},
  });
  // Promoted only when the returned handle is the one asked for, so a differently cased URL never earns the long window.
  if (page?.handle === handle) rememberFound(cacheKey);

  // Privacy policy and terms are kept in Shopify Settings > Policies as one copy. A page with that handle only
  // counts when it has content (the footer's rule): a missing or empty one sends the shopper to the policy. The
  // answer follows data the client edits, so it is a temporary redirect that no cache may keep. The read is the
  // footer's cached one.
  if (
    contentPageByHandle(handle)?.policy &&
    (!page || !pageHasContent(page.body))
  ) {
    const target = policyRedirectFor(
      handle,
      await loadContentAvailability(storefront),
    );
    if (target) {
      throw redirect(target, {
        status: 302,
        headers: {'Cache-Control': 'no-store'},
      });
    }
  }
  if (!page) {
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
