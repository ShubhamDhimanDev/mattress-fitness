import {SafeHtml} from '~/components/SafeHtml';
import {Breadcrumb, type BreadcrumbItem} from '~/components/ui/Breadcrumb';
import {displayHeadingClass} from '~/lib/display-type';
import type {TocEntry} from '~/lib/pages/content-pages-html';

type ContentArticleProps = {
  title: string;
  breadcrumb: readonly BreadcrumbItem[];
  /** Shopify html. It goes through SafeHtml only: scripts, iframes and forms are stripped and a content h1 is demoted to h2 there, so this page keeps its one h1. */
  body: string | null | undefined;
  /** Contents of the page (at least three headings, decided in the loader); none renders no list. */
  toc?: readonly TocEntry[];
  /** One anchor per h2/h3 of the body, for the contents links. */
  anchors?: readonly string[];
  updated?: {iso: string; text: string} | null;
  /** The page exists but has no text: say so plainly instead of showing a bare title (it is `noindex`). */
  empty?: boolean;
};

/**
 * Layout of a Shopify-written page or policy (REQ-CNT-001): breadcrumb, one h1, an optional "on this page"
 * list, the text at a readable line length (SafeHtml sets `max-w-prose`), and a last-updated line. The
 * breadcrumb and the contents are hidden when printing; the site header and footer are not (that needs a global
 * print stylesheet, which this layout does not add).
 */
export function ContentArticle({
  title,
  breadcrumb,
  body,
  toc = [],
  anchors,
  updated = null,
  empty = false,
}: ContentArticleProps) {
  return (
    <article className="mx-auto max-w-prose py-6 md:py-10">
      <Breadcrumb items={breadcrumb} className="print:hidden" />
      <header className="mt-4 border-b border-line pb-6">
        <h1 className={`${displayHeadingClass(title)} text-4xl md:text-5xl`}>
          {title}
        </h1>
        {updated ? (
          <p className="mt-2 text-sm text-fg-muted">
            Last updated <time dateTime={updated.iso}>{updated.text}</time>
          </p>
        ) : null}
      </header>
      {toc.length > 0 ? (
        <nav
          aria-label="On this page"
          className="mt-6 max-w-prose rounded-card bg-paper p-4 md:p-6 print:hidden"
        >
          <p className="text-lg font-extrabold">On this page</p>
          <ul className="mt-1">
            {toc.map((entry) => (
              <li key={entry.id} className={entry.level === 3 ? 'ml-4' : ''}>
                <a
                  href={`#${entry.id}`}
                  className="inline-flex min-h-touch items-center text-primary-700 underline"
                >
                  {entry.text}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
      <SafeHtml html={body} headingIds={anchors} className="mt-6" />
      {empty ? (
        <p className="mt-6 rounded-card bg-paper p-4 text-fg-muted">
          This page has no content yet.
        </p>
      ) : null}
    </article>
  );
}
