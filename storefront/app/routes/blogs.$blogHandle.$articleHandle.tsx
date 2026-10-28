import {Link, useLoaderData} from 'react-router';
import {Image} from '~/lib/hydrogen/image';
import type {Route} from './+types/blogs.$blogHandle.$articleHandle';
import {SafeHtml} from '~/components/SafeHtml';
import {formatPageTitle} from '~/components/layout/documentTitle';
import {Breadcrumb} from '~/components/ui/Breadcrumb';
import {cn} from '~/components/ui/cn';
import {displayHeadingClass} from '~/lib/display-type';
import {SITE_NAME} from '~/lib/navigation';
import {buildArticleDocument} from '~/lib/pages/content-pages-article';
import {
  articleNeighbours,
  articlePath,
  formatLongDate,
} from '~/lib/pages/content-pages-blog';
import {redirectIfHandleIsLocalized} from '~/lib/redirect';
import {canonicalUrl} from '~/lib/seo/canonical';
import {resolveSiteOrigin} from '~/lib/site-origin';
import {contentCache, rememberFound} from '~/lib/shopify/content-pages-cache';
import {isValidHandle} from '~/lib/shopify/collection-data';
import {RouteErrorPage} from '~/components/pages/ErrorPageView';

// The loader prepares the head tags and structured data (`buildArticleDocument`); this only reads them.
export const meta: Route.MetaFunction = ({data}) => {
  if (!data) return [{title: formatPageTitle('Article not found')}];
  return [
    {title: formatPageTitle(data.view.seoTitle)},
    ...data.view.metaTags,
    ...data.view.jsonLd.map((jsonLd) => ({'script:ld+json': jsonLd})),
  ];
};

// How many handles to read to find the neighbours of an article. Neighbours of an article beyond this window
// are not shown (no guess is made); a blog this size is far beyond what the client's team publishes.
const NEIGHBOUR_WINDOW = 100;

export async function loader({context, request, params}: Route.LoaderArgs) {
  const {blogHandle, articleHandle} = params;
  if (!isValidHandle(blogHandle) || !isValidHandle(articleHandle)) {
    throw new Response('Not found', {status: 404});
  }
  const {storefront} = context;

  // Long once Shopify has answered with the article, short before that and for unknown handles (security C-M2).
  const cacheKey = `article:${blogHandle}/${articleHandle}`;
  const {blog} = await storefront.query(ARTICLE_QUERY, {
    cache: contentCache(storefront, cacheKey),
    variables: {blogHandle, articleHandle, neighbours: NEIGHBOUR_WINDOW},
  });

  const article = blog?.articleByHandle;
  if (!blog || !article) {
    throw new Response('Not found', {status: 404});
  }
  rememberFound(cacheKey);

  redirectIfHandleIsLocalized(
    request,
    {handle: articleHandle, data: article},
    {handle: blogHandle, data: blog},
  );

  const origin = resolveSiteOrigin({
    env: context.env,
    requestUrl: request.url,
    isDev: import.meta.env.DEV,
  });
  const view = buildArticleDocument({
    blogHandle: blog.handle,
    blogTitle: blog.title,
    articleHandle: article.handle,
    title: article.title,
    contentHtml: article.contentHtml,
    excerpt: article.excerpt,
    publishedAt: article.publishedAt,
    authorName: article.author?.name,
    topics: article.tags,
    image: article.image,
    seoTitle: article.seo?.title,
    seoDescription: article.seo?.description,
    origin,
    canonical: canonicalUrl(origin, articlePath(blog.handle, article.handle)),
    siteName: SITE_NAME,
  });
  const {newer, older} = articleNeighbours(blog.articles.nodes, article.handle);

  return {
    blogHandle: blog.handle,
    article: {
      title: article.title,
      contentHtml: article.contentHtml,
      publishedAt: article.publishedAt,
      authorName: article.author?.name ?? null,
      image: article.image,
    },
    view,
    newer,
    older,
  };
}

export default function Article() {
  const {article, blogHandle, view, newer, older} =
    useLoaderData<typeof loader>();
  const published = formatLongDate(article.publishedAt);

  return (
    <article className="mx-auto max-w-prose py-6 md:py-10">
      <Breadcrumb items={view.breadcrumb} className="print:hidden" />
      <header className="mt-4 border-b border-line pb-6">
        <h1
          className={cn(
            displayHeadingClass(article.title),
            'text-4xl md:text-5xl',
          )}
        >
          {article.title}
        </h1>
        <p className="mt-2 text-sm text-fg-muted">
          {published ? (
            <time dateTime={article.publishedAt}>{published}</time>
          ) : null}
          {published && article.authorName ? ' · ' : null}
          {article.authorName ? <span>By {article.authorName}</span> : null}
        </p>
      </header>

      {article.image ? (
        <div className="mt-6 max-w-prose overflow-hidden rounded-hero">
          <Image
            alt={article.image.altText || ''}
            aspectRatio="3/2"
            data={article.image}
            loading="eager"
            sizes="(min-width: 768px) 40rem, 100vw"
          />
        </div>
      ) : null}
      <SafeHtml html={article.contentHtml} className="mt-6" />

      {view.topics.length > 0 ? (
        <ul aria-label="Tags" className="mt-4 flex flex-wrap gap-2">
          {view.topics.map((topic) => (
            <li
              key={topic}
              className="rounded-pill bg-paper px-3 py-1 text-caption font-semibold text-ink-700"
            >
              {topic}
            </li>
          ))}
        </ul>
      ) : null}

      {newer || older ? (
        <nav
          aria-label="More articles"
          className="mt-8 flex flex-col gap-2 border-t border-line pt-4 print:hidden sm:flex-row sm:justify-between"
        >
          {older ? (
            <Link
              rel="prev"
              to={articlePath(blogHandle, older.handle)}
              className="inline-flex min-h-touch items-center text-primary-700 underline underline-offset-2 hover:text-primary-800"
            >
              <span aria-hidden="true">&larr;&nbsp;</span>
              {older.title}
            </Link>
          ) : (
            <span />
          )}
          {newer ? (
            <Link
              rel="next"
              to={articlePath(blogHandle, newer.handle)}
              className="inline-flex min-h-touch items-center text-primary-700 underline underline-offset-2 hover:text-primary-800 sm:text-right"
            >
              {newer.title}
              <span aria-hidden="true">&nbsp;&rarr;</span>
            </Link>
          ) : null}
        </nav>
      ) : null}
    </article>
  );
}

// NOTE: https://shopify.dev/docs/api/storefront/latest/objects/blog#field-blog-articlebyhandle
// The Storefront API has no next or previous article field, so a bounded list of handles and titles (newest
// first) is read alongside the article and the neighbours are found in it (`articleNeighbours`).
const ARTICLE_QUERY = `#graphql
  query Article(
    $articleHandle: String!
    $blogHandle: String!
    $neighbours: Int!
    $country: CountryCode
    $language: LanguageCode
  ) @inContext(language: $language, country: $country) {
    blog(handle: $blogHandle) {
      handle
      title
      articleByHandle(handle: $articleHandle) {
        handle
        title
        contentHtml
        excerpt
        publishedAt
        tags
        author: authorV2 {
          name
        }
        image {
          id
          altText
          url
          width
          height
        }
        seo {
          description
          title
        }
      }
      articles(first: $neighbours, sortKey: PUBLISHED_AT, reverse: true) {
        nodes {
          handle
          title
        }
      }
    }
  }
` as const;

/** A missing or failed page keeps the site header and footer (the 404 status is set by the loader). */
export function ErrorBoundary() {
  return <RouteErrorPage />;
}
