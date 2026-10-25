// Head tags and structured data for content pages, policies and blog pages (P6-09, REQ-CNT-001, REQ-CNT-002).
//
// Shopify's SEO fields (`seo.title`, `seo.description`) are client-typed text, so they are treated as data: tags
// are stripped, control characters removed, whitespace collapsed and the length capped before they reach a meta
// tag or a JSON-LD string. When a description is missing the visible text of the page stands in, so the tag
// always describes what the page shows. Structured data is emitted only where it is valid: nothing is invented
// (no publisher, no modified date the Storefront API does not give, no rating).
//
// Pure functions with no framework imports; the loaders call them on the server and pass the result through the
// route's `meta`, so none of this reaches the browser bundle.

import {capText, plainText, type FaqPair} from '~/lib/pages/content-pages-html';

export type MetaTag =
  | {readonly name: string; readonly content: string}
  | {readonly property: string; readonly content: string}
  | {
      readonly tagName: 'link';
      readonly rel: 'canonical';
      readonly href: string;
    };

type JsonLd = Record<string, unknown>;

export const SEO_TITLE_MAX = 120;
export const SEO_DESCRIPTION_MAX = 300;
/** The length of a description derived from the page text (about what a search result shows). */
export const DERIVED_DESCRIPTION_MAX = 160;
export const MAX_ARTICLE_TAGS = 10;
const MAX_TAG_LENGTH = 40;

/** Client-typed text made safe and short for a head tag; empty when nothing usable is left. */
export function seoText(value: unknown, max: number): string {
  return typeof value === 'string' ? capText(plainText(value), max) : '';
}

export type SeoImage = {
  readonly url: string;
  readonly width?: number | null;
  readonly height?: number | null;
  readonly altText?: string | null;
};

export type SeoInput = {
  /** The page's own title, used when `seoTitle` is empty. */
  readonly title: string;
  readonly seoTitle?: string | null;
  readonly seoDescription?: string | null;
  /** Visible text of the page, the description when Shopify has none. */
  readonly bodyText?: string;
  /** Absolute canonical URL, or null without a configured site origin (then no canonical and no og:url). */
  readonly canonical: string | null;
  /** False for an empty page: `noindex,follow`. */
  readonly indexable: boolean;
  readonly type: 'website' | 'article';
  readonly siteName: string;
  readonly image?: SeoImage | null;
  readonly publishedAt?: string | null;
  readonly tags?: readonly string[];
  readonly section?: string | null;
};

export type SeoResult = {
  /** The plain title (the caller adds the site name for the document title). */
  readonly title: string;
  readonly description: string;
  readonly tags: MetaTag[];
};

function isHttps(url: string): boolean {
  return /^https:\/\//i.test(url);
}

function validIso(value: string | null | undefined): string | null {
  return value && !Number.isNaN(Date.parse(value)) ? value : null;
}

/** Tags are plain labels: short, tidy, no duplicates, at most `MAX_ARTICLE_TAGS`. */
export function cleanTags(tags: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  for (const tag of tags ?? []) {
    const clean = seoText(tag, MAX_TAG_LENGTH);
    if (clean !== '') seen.add(clean);
    if (seen.size >= MAX_ARTICLE_TAGS) break;
  }
  return [...seen];
}

function imageTags(image: SeoImage | null | undefined): MetaTag[] {
  if (!image || !isHttps(image.url)) return [];
  const alt = seoText(image.altText, SEO_DESCRIPTION_MAX);
  return [
    {property: 'og:image', content: image.url},
    ...(image.width
      ? [{property: 'og:image:width', content: String(image.width)}]
      : []),
    ...(image.height
      ? [{property: 'og:image:height', content: String(image.height)}]
      : []),
    ...(alt ? [{property: 'og:image:alt', content: alt}] : []),
  ];
}

export function buildSeo(input: SeoInput): SeoResult {
  const title =
    seoText(input.seoTitle, SEO_TITLE_MAX) ||
    seoText(input.title, SEO_TITLE_MAX);
  const description =
    seoText(input.seoDescription, SEO_DESCRIPTION_MAX) ||
    seoText(input.bodyText, DERIVED_DESCRIPTION_MAX);
  const published = validIso(input.publishedAt);

  const tags: MetaTag[] = [
    ...(description ? [{name: 'description', content: description}] : []),
    {
      name: 'robots',
      content: input.indexable ? 'index,follow' : 'noindex,follow',
    },
    ...(input.canonical
      ? [
          {tagName: 'link', rel: 'canonical', href: input.canonical} as const,
          {property: 'og:url', content: input.canonical},
        ]
      : []),
    {property: 'og:type', content: input.type},
    {property: 'og:site_name', content: input.siteName},
    ...(title ? [{property: 'og:title', content: title}] : []),
    ...(description
      ? [{property: 'og:description', content: description}]
      : []),
    ...imageTags(input.image),
    {
      name: 'twitter:card',
      content:
        input.image && isHttps(input.image.url)
          ? 'summary_large_image'
          : 'summary',
    },
    ...(input.type === 'article' && published
      ? [{property: 'article:published_time', content: published}]
      : []),
    ...(input.type === 'article' && input.section
      ? [
          {
            property: 'article:section',
            content: seoText(input.section, SEO_TITLE_MAX),
          },
        ]
      : []),
    ...(input.type === 'article'
      ? cleanTags(input.tags).map((tag) => ({
          property: 'article:tag',
          content: tag,
        }))
      : []),
  ];
  return {title, description, tags};
}

/**
 * FAQPage markup, only for a FAQ page whose text has at least two question and answer pairs (see
 * `extractFaqPairs`); otherwise null and no script is emitted. The strings are plain text taken from the visible
 * page, so the markup says what the page says.
 */
export function buildFaqPageJsonLd(pairs: readonly FaqPair[]): JsonLd | null {
  if (pairs.length < 2) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: pairs.map((pair) => ({
      '@type': 'Question',
      name: pair.question,
      acceptedAnswer: {'@type': 'Answer', text: pair.answer},
    })),
  };
}

export type ArticleJsonLdInput = {
  readonly headline: string;
  readonly description: string;
  readonly canonical: string | null;
  readonly imageUrl: string | null;
  readonly publishedAt: string | null | undefined;
  readonly authorName: string | null | undefined;
  readonly tags: readonly string[];
};

/**
 * Article markup, or null without a valid publication date or headline (both are required). The Storefront API
 * gives no modified date, so none is claimed; no publisher is named until the client's Organization data exists
 * (REQ-SEO-001). Author, image and keywords appear only when present.
 */
export function buildArticleJsonLd(input: ArticleJsonLdInput): JsonLd | null {
  const published = validIso(input.publishedAt);
  const headline = seoText(input.headline, 110);
  if (!published || !headline) return null;
  const author = seoText(input.authorName, SEO_TITLE_MAX);
  const keywords = cleanTags(input.tags);
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline,
    datePublished: published,
    ...(input.description ? {description: input.description} : {}),
    ...(input.imageUrl && isHttps(input.imageUrl)
      ? {image: [input.imageUrl]}
      : {}),
    ...(author ? {author: {'@type': 'Person', name: author}} : {}),
    ...(keywords.length > 0 ? {keywords: keywords.join(', ')} : {}),
    ...(input.canonical
      ? {mainEntityOfPage: {'@type': 'WebPage', '@id': input.canonical}}
      : {}),
  };
}
