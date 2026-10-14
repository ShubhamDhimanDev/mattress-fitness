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

/**
 * The only place Shopify HTML (pages, policies, blog articles) reaches the DOM. The markup goes through the
 * allow-list sanitiser first (T-07); the sanitiser is deterministic, so server and client agree.
 */
export function SafeHtml({
  html,
  className,
}: {
  html: string | null | undefined;
  className?: string;
}) {
  const clean = useMemo(() => sanitizeHtml(html), [html]);
  if (clean === '') return null;
  return (
    <div
      className={cn(CONTENT_CLASSES, className)}
      dangerouslySetInnerHTML={{__html: clean}}
    />
  );
}
