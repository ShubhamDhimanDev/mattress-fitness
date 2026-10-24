// Head tags, breadcrumb and structured data of the blog pages (REQ-CNT-002, P6-09), worked out in the loaders so
// the routes' components and `meta` only read them (and the logic stays out of the browser bundle).
//
// The article page carries Open Graph and Twitter tags (type article, title, description, image, published time,
// section and tags), a canonical link, `Article` JSON-LD and a breadcrumb. The text of Shopify's SEO fields is
// cleaned and capped by `buildSeo`; the description falls back to the excerpt, then to the start of the article.

import {articlePath, blogPath} from '~/lib/pages/content-pages-blog';
import {plainText} from '~/lib/pages/content-pages-html';
import {
  buildArticleJsonLd,
  buildSeo,
  cleanTags,
  seoText,
  type MetaTag,
  type SeoImage,
} from '~/lib/pages/content-pages-seo';
import {buildBreadcrumbJsonLd} from '~/lib/shopify/jsonld';
import {sanitizeHtml} from '~/lib/shopify/sanitize-html';

type Crumb = {readonly label: string; readonly to?: string};

export type BlogDocumentView = {
  readonly seoTitle: string;
  readonly breadcrumb: readonly Crumb[];
  readonly metaTags: readonly MetaTag[];
  readonly jsonLd: ReadonlyArray<Record<string, unknown>>;
};

export function buildBlogDocument(input: {
  readonly blogHandle: string;
  readonly blogTitle: string;
  readonly seoTitle?: string | null;
  readonly seoDescription?: string | null;
  readonly origin: string | null;
  readonly canonical: string | null;
  readonly siteName: string;
}): BlogDocumentView {
  const seo = buildSeo({
    title: input.blogTitle,
    seoTitle: input.seoTitle,
    seoDescription: input.seoDescription,
    canonical: input.canonical,
    indexable: true,
    type: 'website',
    siteName: input.siteName,
  });
  const crumbs = buildBreadcrumbJsonLd(
    [
      {name: 'Home', path: '/'},
      {name: 'Blogs', path: '/blogs'},
      {name: input.blogTitle, path: blogPath(input.blogHandle)},
    ],
    input.origin,
  );
  return {
    seoTitle: seo.title,
    breadcrumb: [
      {label: 'Home', to: '/'},
      {label: 'Blogs', to: '/blogs'},
      {label: input.blogTitle},
    ],
    metaTags: seo.tags,
    jsonLd: crumbs ? [crumbs] : [],
  };
}

export type ArticleDocumentInput = {
  readonly blogHandle: string;
  readonly blogTitle: string;
  readonly articleHandle: string;
  readonly title: string;
  readonly contentHtml: string | null | undefined;
  readonly excerpt?: string | null;
  readonly publishedAt: string;
  readonly authorName?: string | null;
  readonly topics: readonly string[];
  readonly image?: SeoImage | null;
  readonly seoTitle?: string | null;
  readonly seoDescription?: string | null;
  readonly origin: string | null;
  readonly canonical: string | null;
  readonly siteName: string;
};

export type ArticleDocumentView = BlogDocumentView & {
  /** Plain labels for the visible list of tags. */
  readonly topics: readonly string[];
};

export function buildArticleDocument(
  input: ArticleDocumentInput,
): ArticleDocumentView {
  const description =
    seoText(input.seoDescription, 300) ||
    seoText(input.excerpt, 300) ||
    undefined;
  const seo = buildSeo({
    title: input.title,
    seoTitle: input.seoTitle,
    seoDescription: description,
    bodyText: plainText(sanitizeHtml(input.contentHtml)),
    canonical: input.canonical,
    indexable: true,
    type: 'article',
    siteName: input.siteName,
    image: input.image,
    publishedAt: input.publishedAt,
    tags: input.topics,
    section: input.blogTitle,
  });
  const article = buildArticleJsonLd({
    headline: input.title,
    description: seo.description,
    canonical: input.canonical,
    imageUrl: input.image?.url ?? null,
    publishedAt: input.publishedAt,
    authorName: input.authorName,
    tags: input.topics,
  });
  const crumbs = buildBreadcrumbJsonLd(
    [
      {name: 'Home', path: '/'},
      {name: 'Blogs', path: '/blogs'},
      {name: input.blogTitle, path: blogPath(input.blogHandle)},
      {
        name: input.title,
        path: articlePath(input.blogHandle, input.articleHandle),
      },
    ],
    input.origin,
  );
  return {
    seoTitle: seo.title,
    breadcrumb: [
      {label: 'Home', to: '/'},
      {label: 'Blogs', to: '/blogs'},
      {label: input.blogTitle, to: blogPath(input.blogHandle)},
      {label: input.title},
    ],
    metaTags: seo.tags,
    jsonLd: [article, crumbs].flatMap((entry) => (entry ? [entry] : [])),
    topics: cleanTags(input.topics),
  };
}
