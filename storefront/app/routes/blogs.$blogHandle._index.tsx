import {useLoaderData} from 'react-router';
import type {Route} from './+types/blogs.$blogHandle._index';
import {formatPageTitle} from '~/components/layout/documentTitle';
import {
  ArticleCard,
  PaginatedList,
  type ArticleCardData,
} from '~/components/pages/ArticleList';
import {Breadcrumb} from '~/components/ui/Breadcrumb';
import {cn} from '~/components/ui/cn';
import {displayHeadingClass} from '~/lib/display-type';
import {SITE_NAME} from '~/lib/navigation';
import {buildBlogDocument} from '~/lib/pages/content-pages-article';
import {blogPath} from '~/lib/pages/content-pages-blog';
import {cursorPaginationVariables} from '~/lib/pages/cursor-pagination';
import {seoText} from '~/lib/pages/content-pages-seo';
import {redirectIfHandleIsLocalized} from '~/lib/redirect';
import {canonicalUrl} from '~/lib/seo/canonical';
import {resolveSiteOrigin} from '~/lib/site-origin';
import {contentCache, rememberFound} from '~/lib/shopify/content-pages-cache';
import {isValidHandle} from '~/lib/shopify/collection-data';

// The loader prepares the head tags and structured data (`buildBlogDocument`); this only reads them.
export const meta: Route.MetaFunction = ({data}) => {
  if (!data) return [{title: formatPageTitle('Blog not found')}];
  return [
    {title: formatPageTitle(data.view.seoTitle)},
    ...data.view.metaTags,
    ...data.view.jsonLd.map((jsonLd) => ({'script:ld+json': jsonLd})),
  ];
};

const ARTICLES_PER_PAGE = 12;

export async function loader({context, request, params}: Route.LoaderArgs) {
  const {blogHandle} = params;
  if (!isValidHandle(blogHandle)) {
    throw new Response('Blog not found', {status: 404});
  }
  const {storefront} = context;
  // The cursor and direction are checked before they reach the query; a bad one serves the first page.
  const paginationVariables = cursorPaginationVariables(
    new URL(request.url).searchParams,
    ARTICLES_PER_PAGE,
  );

  // Articles hold no price or availability, so a blog that exists is cached long. An unknown handle, and any page
  // reached by a cursor (each is a cache entry of its own), get the short window (security C-M2).
  const cacheKey = `blog:${blogHandle}`;
  const paged = new URL(request.url).searchParams.has('cursor');
  const {blog} = await storefront.query(BLOG_QUERY, {
    cache: paged ? storefront.CacheShort() : contentCache(storefront, cacheKey),
    variables: {blogHandle, ...paginationVariables},
  });
  if (blog && !paged) rememberFound(cacheKey);

  if (!blog?.articles) {
    throw new Response('Blog not found', {status: 404});
  }

  redirectIfHandleIsLocalized(request, {handle: blogHandle, data: blog});

  const origin = resolveSiteOrigin({
    env: context.env,
    requestUrl: request.url,
    isDev: import.meta.env.DEV,
  });
  const view = buildBlogDocument({
    blogHandle: blog.handle,
    blogTitle: blog.title,
    seoTitle: blog.seo?.title,
    seoDescription: blog.seo?.description,
    origin,
    // Every page of the listing points at the plain blog URL (DEC-044).
    canonical: canonicalUrl(origin, blogPath(blog.handle)),
    siteName: SITE_NAME,
  });

  // The cards read plain, short text: the excerpt is cleaned and capped here, not in the browser.
  const articles = {
    pageInfo: blog.articles.pageInfo,
    nodes: blog.articles.nodes.map((article): ArticleCardData => ({
      id: article.id,
      handle: article.handle,
      title: article.title,
      publishedAt: article.publishedAt,
      excerpt: seoText(article.excerpt, 200),
      authorName: article.author?.name ?? null,
      blogHandle: article.blog.handle,
      image: article.image,
    })),
  };

  return {blog: {title: blog.title, handle: blog.handle, articles}, view};
}

export default function Blog() {
  const {blog, view} = useLoaderData<typeof loader>();

  return (
    <div className="py-4">
      <Breadcrumb items={view.breadcrumb} className="print:hidden" />
      <header className="mt-2 border-b border-line pb-4">
        <h1 className={cn(displayHeadingClass(blog.title), 'text-3xl')}>
          {blog.title}
        </h1>
      </header>
      <div className="mt-6">
        {blog.articles.nodes.length === 0 ? (
          <p className="text-base text-fg-muted">No articles yet.</p>
        ) : (
          <PaginatedList connection={blog.articles} label={blog.title}>
            {(article, index) => (
              <ArticleCard
                key={article.id}
                article={article}
                loading={index < 3 ? 'eager' : 'lazy'}
              />
            )}
          </PaginatedList>
        )}
      </div>
    </div>
  );
}

// NOTE: https://shopify.dev/docs/api/storefront/latest/objects/blog
// `excerpt` and `author` instead of the whole `contentHtml`: a listing page does not need the article text.
const BLOG_QUERY = `#graphql
  query Blog(
    $language: LanguageCode
    $blogHandle: String!
    $first: Int
    $last: Int
    $startCursor: String
    $endCursor: String
  ) @inContext(language: $language) {
    blog(handle: $blogHandle) {
      title
      handle
      seo {
        title
        description
      }
      articles(
        first: $first,
        last: $last,
        before: $startCursor,
        after: $endCursor,
        sortKey: PUBLISHED_AT,
        reverse: true
      ) {
        nodes {
          ...ArticleItem
        }
        pageInfo {
          hasPreviousPage
          hasNextPage
          endCursor
          startCursor
        }
      }
    }
  }
  fragment ArticleItem on Article {
    author: authorV2 {
      name
    }
    excerpt
    handle
    id
    image {
      id
      altText
      url
      width
      height
    }
    publishedAt
    title
    blog {
      handle
    }
  }
` as const;
