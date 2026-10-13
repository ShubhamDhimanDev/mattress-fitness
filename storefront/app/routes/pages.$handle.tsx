import {useLoaderData} from 'react-router';
import type {Route} from './+types/pages.$handle';
import {SafeHtml} from '~/components/SafeHtml';
import {formatPageTitle} from '~/components/layout/documentTitle';
import {redirectIfHandleIsLocalized} from '~/lib/redirect';
import {catalogCache} from '~/lib/shopify/cache';
import {isValidHandle} from '~/lib/shopify/collection-data';

export const meta: Route.MetaFunction = ({data}) => {
  return [{title: formatPageTitle(data?.page.title)}];
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
async function loadCriticalData({context, request, params}: Route.LoaderArgs) {
  if (!isValidHandle(params.handle)) {
    throw new Response('Not Found', {status: 404});
  }

  const [{page}] = await Promise.all([
    context.storefront.query(PAGE_QUERY, {
      cache: catalogCache(context.storefront),
      variables: {
        handle: params.handle,
      },
    }),
    // Add other queries here, so that they are loaded in parallel
  ]);

  if (!page) {
    throw new Response('Not Found', {status: 404});
  }

  redirectIfHandleIsLocalized(request, {handle: params.handle, data: page});

  return {
    page,
  };
}

/**
 * Load data for rendering content below the fold. This data is deferred and will be
 * fetched after the initial page load. If it's unavailable, the page should still 200.
 * Make sure to not throw any errors here, as it will cause the page to 500.
 */
function loadDeferredData({context}: Route.LoaderArgs) {
  return {};
}

export default function Page() {
  const {page} = useLoaderData<typeof loader>();

  return (
    <div className="py-6">
      <h1 className="text-3xl font-bold">{page.title}</h1>
      <SafeHtml html={page.body} />
    </div>
  );
}

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
      seo {
        description
        title
      }
    }
  }
` as const;
