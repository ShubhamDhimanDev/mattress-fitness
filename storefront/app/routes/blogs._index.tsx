import {Link, useLoaderData} from 'react-router';
import type {Route} from './+types/blogs._index';
import {formatPageTitle} from '~/components/layout/documentTitle';
import {PaginatedList} from '~/components/pages/ArticleList';
import {Breadcrumb} from '~/components/ui/Breadcrumb';
import {cardStyles} from '~/components/ui/Card';
import {ChevronRightIcon} from '~/components/ui/Icons';
import {SITE_NAME} from '~/lib/navigation';
import {blogPath} from '~/lib/pages/content-pages-blog';
import {cursorPaginationVariables} from '~/lib/pages/cursor-pagination';
import {buildSeo} from '~/lib/pages/content-pages-seo';
import {canonicalUrl} from '~/lib/seo/canonical';
import {resolveSiteOrigin} from '~/lib/site-origin';

export const meta: Route.MetaFunction = ({data}) => [
  {title: formatPageTitle('Blogs')},
  ...(data?.metaTags ?? []),
];

export async function loader({context, request}: Route.LoaderArgs) {
  const {storefront} = context;
  // The cursor and direction are checked before they reach the query; a bad one serves the first page.
  const paginationVariables = cursorPaginationVariables(
    new URL(request.url).searchParams,
    12,
  );

  // The first page is cached long; a page reached by a cursor is one more entry per cursor, so it is short (C-M2).
  const paged = new URL(request.url).searchParams.has('cursor');
  const {blogs} = await storefront.query(BLOGS_QUERY, {
    cache: paged ? storefront.CacheShort() : storefront.CacheLong(),
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
    <div className="py-6 md:py-10">
      <Breadcrumb
        items={[{label: 'Home', to: '/'}, {label: 'Blogs'}]}
        className="print:hidden"
      />
      <h1 className="type-display mt-4 border-b border-line pb-6 text-4xl md:text-5xl">
        Blogs
      </h1>
      <div className="mt-6">
        {blogs.nodes.length === 0 ? (
          <p className="text-base text-fg-muted">No blogs yet.</p>
        ) : (
          <PaginatedList connection={blogs} label="Blogs">
            {(blog) => (
              <li key={blog.handle}>
                <h2 className="type-display text-title">
                  <Link
                    prefetch="intent"
                    to={blogPath(blog.handle)}
                    className={
                      cardStyles({interactive: true, padding: 'sm'}) +
                      ' flex min-h-14 items-center justify-between gap-3 text-fg hover:text-primary-700'
                    }
                  >
                    {blog.title}
                    <ChevronRightIcon className="text-primary-700" />
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
