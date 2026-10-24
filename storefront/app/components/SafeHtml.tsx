import {useMemo} from 'react';
import {cn} from '~/components/ui/cn';
import {sanitizeHtml} from '~/lib/shopify/sanitize-html';

// Spacing and type for the elements the sanitiser allows. Theme classes only; there is no typography plugin.
const CONTENT_CLASSES = [
  'max-w-prose text-base text-fg',
  '[&_p]:my-4 [&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-6',
  '[&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:text-2xl [&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-xl [&_h4]:mt-4 [&_h4]:font-bold',
  '[&_a]:text-primary-700 [&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:text-primary-800',
  '[&_blockquote]:my-4 [&_blockquote]:border-l-4 [&_blockquote]:border-line [&_blockquote]:pl-4',
  '[&_table]:my-4 [&_table]:w-full [&_td]:border [&_td]:border-line [&_td]:p-2 [&_th]:border [&_th]:border-line [&_th]:p-2 [&_th]:text-left',
  '[&_img]:h-auto [&_img]:max-w-full',
].join(' ');

const HEADING_OPEN = /<h([23])>/g;
const SAFE_ANCHOR = /^[a-z0-9-]{1,80}$/;

/**
 * Gives the n-th h2 or h3 of already sanitised markup the n-th id, for the page's table of contents (P6-09). The
 * ids come from our own loader (never from Shopify), and an id that is not plain lower-case letters, digits and
 * hyphens is skipped. The sanitiser writes headings as bare tags, so only an id is ever added.
 */
export function anchorHeadings(
  clean: string,
  ids: readonly string[] | undefined,
): string {
  if (!ids || ids.length === 0) return clean;
  let position = 0;
  return clean.replace(HEADING_OPEN, (tag, level: string) => {
    const id = ids[position++] ?? '';
    return SAFE_ANCHOR.test(id) ? `<h${level} id="${id}">` : tag;
  });
}

/**
 * The only place Shopify HTML (pages, policies, blog articles) reaches the DOM. The markup goes through the
 * allow-list sanitiser first (T-07); the sanitiser is deterministic, so server and client agree.
 */
export function SafeHtml({
  html,
  className,
  headingIds,
}: {
  html: string | null | undefined;
  className?: string;
  /** Anchors for the h2/h3 headings in order, from `scanHeadings` in the loader (content pages only). */
  headingIds?: readonly string[];
}) {
  const clean = useMemo(
    () => anchorHeadings(sanitizeHtml(html), headingIds),
    [html, headingIds],
  );
  if (clean === '') return null;
  return (
    <div
      className={cn(CONTENT_CLASSES, className)}
      dangerouslySetInnerHTML={{__html: clean}}
    />
  );
}
