import {useEffect, useRef, useState} from 'react';
import {useFetcher} from 'react-router';
import {appendUnique, readListingPage} from '~/lib/shopify/listing';
import type {PageInfoView, ProductCardView} from '~/lib/shopify/types';

type LoadedPage = {
  readonly products: readonly ProductCardView[];
  readonly pageInfo: PageInfoView;
};

type Extra = {readonly key: string} & LoadedPage;

/**
 * "Load more" (REQ-COL-001): fetches the next page from the route's own loader with the cursor and appends
 * it, without a full reload and without page numbers. `resetKey` identifies the filters and sort the list
 * belongs to; when it changes the appended pages are discarded, so a new filter never inherits old products.
 */
export function useLoadMore({
  products,
  pageInfo,
  resetKey,
  buildHref,
}: {
  products: readonly ProductCardView[];
  pageInfo: PageInfoView;
  resetKey: string;
  /** URL of the next page for a cursor. */
  buildHref: (cursor: string) => string;
}) {
  const fetcher = useFetcher();
  const [extra, setExtra] = useState<Extra | null>(null);
  const requestedFor = useRef<string | null>(null);
  const focusIndex = useRef<number | null>(null);

  const active = extra && extra.key === resetKey ? extra : null;
  const visible = active
    ? appendUnique(products, active.products)
    : [...products];
  const info = active ? active.pageInfo : pageInfo;

  // Merge the fetched page, once, and only if it was requested for the list that is on screen now.
  useEffect(() => {
    if (fetcher.state !== 'idle' || !fetcher.data) return;
    if (requestedFor.current !== resetKey) return;
    const page: LoadedPage | null = readListingPage(fetcher.data);
    requestedFor.current = null;
    if (!page) return;
    setExtra((previous) => {
      const base = previous && previous.key === resetKey ? previous : null;
      return {
        key: resetKey,
        products: appendUnique(base?.products ?? [], page.products),
        pageInfo: page.pageInfo,
      };
    });
  }, [fetcher.state, fetcher.data, resetKey]);

  // Keyboard users: move focus to the first product that was just added, so they continue from there.
  const count = visible.length;
  useEffect(() => {
    const from = focusIndex.current;
    if (from === null || count <= from) return;
    focusIndex.current = null;
    document
      .querySelector<HTMLElement>(`[data-product-index="${from}"] a`)
      ?.focus();
  }, [count]);

  const cursor = info.hasNextPage ? info.endCursor : null;
  return {
    products: visible,
    hasMore: cursor !== null,
    /** The size of the whole filtered list when the loader knows it, else null. */
    totalCount: info.totalCount ?? null,
    nextHref: cursor === null ? null : buildHref(cursor),
    loading: fetcher.state !== 'idle',
    load() {
      if (cursor === null) return;
      requestedFor.current = resetKey;
      focusIndex.current = visible.length;
      void fetcher.load(buildHref(cursor));
    },
  };
}
