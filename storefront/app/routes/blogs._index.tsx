import {Link, useLoaderData} from 'react-router';
import type {Route} from './+types/blogs._index';
import {formatPageTitle} from '~/components/layout/documentTitle';
import {PaginatedList} from '~/components/pages/ArticleList';
import {Breadcrumb} from '~/components/ui/Breadcrumb';
import {SITE_NAME} from '~/lib/navigation';
import {
  blogPaginationVariables,
  blogPath,
} from '~/lib/pages/content-pages-blog';
import {buildSeo} from '~/lib/pages/content-pages-seo';
import {canonicalUrl} from '~/lib/seo/canonical';
import {resolveSiteOrigin} from '~/lib/site-origin';
import {catalogCache} from '~/lib/shopify/cache';

export const meta: Route.MetaFunction = ({data}) => [
  {title: formatPageTitle('Blogs')},
  ...(data?.metaTags ?? []),
];

export async function loader({context, request}: Route.LoaderArgs) {
  const {storefront} = context;
  // The cursor and direction are checked before they reach the query; a bad one serves the first page.
  const paginationVariables = blogPaginationVariables(
    new URL(request.url).searchParams,
    12,
  );

  const {blogs} = await storefront.query(BLOGS_QUERY, {
    cache: catalogCache(storefront),
    variables: paginationVariables,
  });

  const origin = resolveSiteOrigin({
    env: context.env,
    requestUrl: request.url,
    isDev: import.meta.env.DEV,
  });
  const {tags: metaTags} = buildSeo({
    title: 'Blogs',
    canonical: canonicalUrl(origin, '/blogs'),
    indexable: true,
    type: 'website',
    siteName: SITE_NAME,
  });

  return {blogs, metaTags};
}

export default function Blogs() {
  const {blogs} = useLoaderData<typeof loader>();

  return (
    <div className="py-4">
      <Breadcrumb
        items={[{label: 'Home', to: '/'}, {label: 'Blogs'}]}
        className="print:hidden"
      />
      <h1 className="mt-2 border-b border-line pb-4 text-3xl font-bold">
        Blogs
      </h1>
      <div className="mt-6">
        {blogs.nodes.length === 0 ? (
          <p className="text-base text-fg-muted">No blogs yet.</p>
        ) : (
          <PaginatedList connection={blogs} label="Blogs">
            {(blog) => (
              <li key={blog.handle}>
                <h2 className="text-xl font-bold">
                  <Link
                    prefetch="intent"
                    to={blogPath(blog.handle)}
                    className="inline-flex min-h-touch items-center text-fg hover:text-primary-700 hover:underline"
                  >
                    {blog.title}
                  </Link>
                </h2>
              </li>
            )}
          </PaginatedList>
        )}
      </div>
    </div>
  );
}

// NOTE: https://shopify.dev/docs/api/storefront/latest/objects/blog
const BLOGS_QUERY = `#graphql
  query Blogs(
    $country: CountryCode
    $endCursor: String
    $first: Int
    $language: LanguageCode
    $last: Int
    $startCursor: String
  ) @inContext(country: $country, language: $language) {
    blogs(
      first: $first,
      last: $last,
      before: $startCursor,
      after: $endCursor
    ) {
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
      nodes {
        title
        handle
      }
    }
  }
` as const;
