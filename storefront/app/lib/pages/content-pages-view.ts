// Everything a content page or policy needs besides its text, worked out once in the loader (P6-09,
// REQ-CNT-001): the table of contents and anchors, the "last updated" line, the head tags and the structured
// data. The route's component and its `meta` then only read this object, which keeps the logic (and the
// sanitiser-based parsing) out of the browser bundle.
//
// Pure; takes the origin and the site name as arguments.

import {formatLongDate} from '~/lib/pages/content-pages-blog';
import {
  MIN_TOC_ENTRIES,
  extractFaqPairs,
  hasVisibleContent,
  plainText,
  scanHeadings,
  type TocEntry,
} from '~/lib/pages/content-pages-html';
import {
  buildFaqPageJsonLd,
  buildSeo,
  type MetaTag,
} from '~/lib/pages/content-pages-seo';
import {buildBreadcrumbJsonLd} from '~/lib/shopify/jsonld';
import {sanitizeHtml} from '~/lib/shopify/sanitize-html';

export type ContentDocumentInput = {
  readonly title: string;
  /** Title to use when Shopify gives an empty one (the registry title). */
  readonly fallbackTitle?: string;
  readonly body: string | null | undefined;
  readonly seoTitle?: string | null;
  readonly seoDescription?: string | null;
  /** ISO time of the last edit, when Shopify gives one (pages do; policies do not). */
  readonly updatedAt?: string | null;
  /** True for the FAQ page: FAQPage markup is allowed when its text has the question and answer structure. */
  readonly faq?: boolean;
  /** Intermediate breadcrumb steps between Home and the page (a policy sits under "Policies"). */
  readonly parents?: ReadonlyArray<{
    readonly name: string;
    readonly path: string;
  }>;
  readonly path: string;
  readonly origin: string | null;
  readonly canonical: string | null;
  readonly siteName: string;
};

export type ContentDocumentView = {
  readonly title: string;
  readonly seoTitle: string;
  readonly empty: boolean;
  readonly updated: {readonly iso: string; readonly text: string} | null;
  readonly toc: readonly TocEntry[];
  readonly anchors: readonly string[];
  readonly breadcrumb: ReadonlyArray<{
    readonly label: string;
    readonly to?: string;
  }>;
  readonly tags: readonly MetaTag[];
  readonly jsonLd: ReadonlyArray<Record<string, unknown>>;
};

/**
 * The route's complete `meta` list, built on the server: the document title, the head tags and one
 * `script:ld+json` per structured-data object. The route's `meta` then returns it unchanged, which keeps that
 * function (it also runs in the browser) tiny.
 */
export function headTags(documentTitle: string, view: ContentDocumentView) {
  return [
    {title: documentTitle},
    ...view.tags,
    ...view.jsonLd.map((jsonLd) => ({'script:ld+json': jsonLd})),
  ];
}

/** What the page component needs: the view without the head data, which travels once as `head`. */
export function displayView(view: ContentDocumentView) {
  return {
    title: view.title,
    empty: view.empty,
    updated: view.updated,
    toc: view.toc,
    anchors: view.anchors,
    breadcrumb: view.breadcrumb,
  };
}

export function buildContentDocument(
  input: ContentDocumentInput,
): ContentDocumentView {
  const title = input.title.trim() || input.fallbackTitle || '';
  // The one sanitising pass for everything derived from the text; SafeHtml sanitises again for display.
  const clean = sanitizeHtml(input.body);
  const empty = !hasVisibleContent(clean);
  const {anchors, toc} = scanHeadings(clean);
  const seo = buildSeo({
    title,
    seoTitle: input.seoTitle,
    seoDescription: input.seoDescription,
    bodyText: plainText(clean),
    canonical: input.canonical,
    indexable: !empty,
    type: 'website',
    siteName: input.siteName,
  });
  const parents = input.parents ?? [];
  const breadcrumbJsonLd = buildBreadcrumbJsonLd(
    [{name: 'Home', path: '/'}, ...parents, {name: title, path: input.path}],
    input.origin,
  );
  const faqJsonLd =
    input.faq && !empty ? buildFaqPageJsonLd(extractFaqPairs(clean)) : null;
  const updatedText = formatLongDate(input.updatedAt);

  return {
    title,
    seoTitle: seo.title,
    empty,
    updated:
      updatedText && input.updatedAt
        ? {iso: input.updatedAt, text: updatedText}
        : null,
    toc: toc.length >= MIN_TOC_ENTRIES ? toc : [],
    anchors,
    breadcrumb: [
      {label: 'Home', to: '/'},
      ...parents.map((parent) => ({label: parent.name, to: parent.path})),
      {label: title},
    ],
    tags: seo.tags,
    jsonLd: [breadcrumbJsonLd, faqJsonLd].flatMap((entry) =>
      entry ? [entry] : [],
    ),
  };
}
