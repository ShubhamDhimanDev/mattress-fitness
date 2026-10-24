import {Image, Pagination} from '@shopify/hydrogen';
import type {ComponentProps, ReactNode} from 'react';
import {Link} from 'react-router';
import {buttonStyles} from '~/components/ui/Button';
import {cn} from '~/components/ui/cn';
import {articlePath, formatLongDate} from '~/lib/pages/content-pages-blog';

export type ArticleCardData = {
  id: string;
  handle: string;
  title: string;
  publishedAt: string;
  excerpt?: string | null;
  authorName?: string | null;
  blogHandle: string;
  image?: {
    id?: string | null;
    url: string;
    altText?: string | null;
    width?: number | null;
    height?: number | null;
  } | null;
};

export function ArticleCard({
  article,
  loading,
}: {
  article: ArticleCardData;
  loading?: HTMLImageElement['loading'];
}) {
  const date = formatLongDate(article.publishedAt);
  return (
    <li className="flex flex-col gap-2">
      {article.image ? (
        <Link
          to={articlePath(article.blogHandle, article.handle)}
          tabIndex={-1}
          aria-hidden="true"
          className="block overflow-hidden rounded-card"
        >
          <Image
            alt=""
            aspectRatio="3/2"
            data={article.image}
            loading={loading}
            sizes="(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw"
          />
        </Link>
      ) : null}
      <h2 className="text-xl font-bold text-fg">
        <Link
          to={articlePath(article.blogHandle, article.handle)}
          className="text-fg hover:text-primary-700 hover:underline"
        >
          {article.title}
        </Link>
      </h2>
      <p className="text-sm text-fg-muted">
        {date ? <time dateTime={article.publishedAt}>{date}</time> : null}
        {date && article.authorName ? ' · ' : null}
        {article.authorName}
      </p>
      {article.excerpt ? (
        <p className="max-w-prose text-base text-fg">{article.excerpt}</p>
      ) : null}
    </li>
  );
}

type Connection<NodeType> = ComponentProps<
  typeof Pagination<NodeType>
>['connection'];

const MORE_LINK = cn(buttonStyles({variant: 'secondary'}), 'self-center');

/**
 * A paginated list of cards on Hydrogen's cursor `Pagination` (REQ-CNT-002): "Load more" is a real link
 * (`?cursor=...`), so it also works without JavaScript, and the loaded articles stay on the page. `children`
 * renders one node as a list item.
 */
export function PaginatedList<NodeType>({
  connection,
  children,
  label,
}: {
  connection: Connection<NodeType>;
  children: (node: NodeType, index: number) => ReactNode;
  /** Accessible name of the list. */
  label: string;
}) {
  return (
    <Pagination connection={connection}>
      {({nodes, isLoading, PreviousLink, NextLink}) => (
        <div className="flex flex-col gap-6">
          <PreviousLink className={MORE_LINK}>
            {isLoading ? (
              <span aria-live="polite">Loading...</span>
            ) : (
              'Load previous'
            )}
          </PreviousLink>
          <ul
            aria-label={label}
            className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3"
          >
            {nodes.map((node, index) => children(node, index))}
          </ul>
          <NextLink className={MORE_LINK}>
            {isLoading ? (
              <span aria-live="polite">Loading...</span>
            ) : (
              'Load more'
            )}
          </NextLink>
        </div>
      )}
    </Pagination>
  );
}
