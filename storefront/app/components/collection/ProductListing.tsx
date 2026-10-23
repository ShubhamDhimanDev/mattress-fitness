import {useEffect, useRef, useState} from 'react';
import {useLocation, useNavigate, useSearchParams} from 'react-router';
import {ActiveFilters, FilterPanel} from '~/components/collection/FilterPanel';
import {PromoTileCard} from '~/components/collection/PromoTileCard';
import {useLoadMore} from '~/components/collection/useLoadMore';
import {ProductItem} from '~/components/ProductItem';
import {Button} from '~/components/ui/Button';
import {cn} from '~/components/ui/cn';
import {Drawer} from '~/components/ui/Drawer';
import {Select} from '~/components/ui/Select';
import {
  SORT_LABELS,
  countActiveFilters,
  parseFilterParams,
  type SortKey,
} from '~/lib/filters';
import type {ReportedList} from '~/lib/listing-events';
import {listIdForPath} from '~/lib/listing-path';
import {
  hrefForReset,
  hrefForSort,
  hrefForState,
  nextPageState,
  type FilterGroupView,
} from '~/lib/shopify/listing';
import {
  placePromoTiles,
  type PromoTileView,
} from '~/lib/shopify/promo-placement';
import type {PageInfoView, ProductCardView} from '~/lib/shopify/types';

type ProductListingProps = {
  products: readonly ProductCardView[];
  pageInfo: PageInfoView;
  filterGroups: readonly FilterGroupView[];
  /** False on the all-products page, where the API offers sorting only. */
  showFilters: boolean;
  sortKeys: readonly SortKey[];
  emptyHeading: string;
  /** Promotional tiles for this listing (collections only), placed by their grid position (REQ-COL-003). */
  promoTiles?: readonly PromoTileView[];
};

/**
 * Grid, sort, filters and "Load more" shared by collections, search and the all-products page
 * (REQ-COL-001, REQ-COL-002, REQ-SRCH-002). The URL is the only state; below 1024 px the filters open in
 * a drawer, above it they are a sidebar.
 */
export function ProductListing({
  products,
  pageInfo,
  filterGroups,
  showFilters,
  sortKeys,
  emptyHeading,
  promoTiles = [],
}: ProductListingProps) {
  const {pathname} = useLocation();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const state = parseFilterParams(searchParams);
  const base = new URLSearchParams(searchParams);
  const active = countActiveFilters(state);
  const resetKey = hrefForState(pathname, {...state, cursor: null}, base);

  const list = useLoadMore({
    products,
    pageInfo,
    resetKey,
    buildHref: (cursor) =>
      hrefForState(pathname, nextPageState(state, cursor), base),
  });

  // view_item_list (REQ-ANL-001). All of it (which products are new, the numbering, the event) lives in a module
  // fetched here with import(), which keeps it out of the route's initial JavaScript (scripts/perf). It records what
  // it has reported in the `reported` ref, so each product is counted once per list view, also when this effect runs twice.
  // `track()` holds the event until the consent layer is ready and the runtime drops what consent does not allow.
  const listId = listIdForPath(pathname);
  const reported = useRef<ReportedList | null>(null);
  const visibleProducts = list.products;
  useEffect(() => {
    import('~/lib/listing-events').then(
      (events) =>
        events.reportListing(reported, resetKey, visibleProducts, listId),
      () => {
        // The chunk could not be fetched (offline, a deploy replaced it): analytics never breaks the page (NFR-013).
      },
    );
  }, [resetKey, visibleProducts, listId]);

  const sortOptions = sortKeys.map((key) => ({
    value: key,
    label: SORT_LABELS[key],
  }));

  return (
    <div className="mt-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-8">
      {showFilters ? (
        <aside
          aria-labelledby="listing-filters-heading"
          className="hidden w-72 shrink-0 lg:block"
        >
          {/* The sidebar comes before the product list in the page, and its price heading is a level 3: this level 2 keeps the outline unbroken (A11Y-006). */}
          <h2 id="listing-filters-heading" className="sr-only">
            Filters
          </h2>
          <FilterPanel
            groups={filterGroups}
            state={state}
            pathname={pathname}
            base={base}
          />
        </aside>
      ) : null}

      <div className="min-w-0 flex-1">
        {/* Below 1024 px the count, the Filters button and the sort are stacked; from there the sort sits at the right of the count. */}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <p role="status" className="text-lg font-bold text-fg">
            {list.products.length}{' '}
            {list.products.length === 1 ? 'product' : 'products'}
            {list.hasMore ? ' shown' : ''}
          </p>
          {showFilters ? (
            <Button
              variant="secondary"
              fullWidth
              className="lg:hidden"
              aria-haspopup="dialog"
              onClick={() => setDrawerOpen(true)}
            >
              Filters{active > 0 ? ` (${active})` : ''}
            </Button>
          ) : null}
          <Select
            label="Sort by"
            className="lg:w-64"
            value={state.sort}
            options={sortOptions}
            onChange={(event) => {
              const next = sortKeys.find((key) => key === event.target.value);
              if (next) {
                void navigate(hrefForSort(pathname, state, next, base), {
                  preventScrollReset: true,
                });
              }
            }}
          />
        </div>

        {showFilters ? (
          <div className="mt-3">
            <ActiveFilters state={state} pathname={pathname} base={base} />
          </div>
        ) : null}

        {list.products.length === 0 ? (
          <div className="flex flex-col items-start gap-3 py-12">
            <h2 className="text-xl font-bold">{emptyHeading}</h2>
            <p className="text-base text-fg-muted">
              Try removing a filter or searching for something else.
            </p>
            {active > 0 ? (
              <Button
                to={hrefForReset(pathname, state, base)}
                preventScrollReset
                variant="primary"
              >
                Reset filters
              </Button>
            ) : null}
          </div>
        ) : (
          <>
            <h2 className="sr-only">Products</h2>
            <ul
              className={cn(
                'mt-4 grid grid-cols-1 gap-3 md:grid-cols-3 md:gap-6',
                showFilters
                  ? 'lg:grid-cols-2 xl:grid-cols-3'
                  : 'xl:grid-cols-4',
              )}
            >
              {placePromoTiles(list.products, promoTiles, list.hasMore).map(
                (item) =>
                  item.kind === 'tile' ? (
                    <li key={`tile-${item.tile.id}`}>
                      <PromoTileCard tile={item.tile} />
                    </li>
                  ) : (
                    <li key={item.product.id}>
                      <ProductItem
                        product={item.product}
                        index={item.productIndex}
                        layout="row"
                        loading={item.productIndex < 4 ? 'eager' : 'lazy'}
                        listId={listId}
                      />
                    </li>
                  ),
              )}
            </ul>
            {list.hasMore && list.nextHref ? (
              <div className="mt-8 flex justify-center">
                <Button
                  to={list.nextHref}
                  preventScrollReset
                  variant="secondary"
                  size="lg"
                  loading={list.loading}
                  loadingLabel="Loading more products"
                  onClick={(event) => {
                    event.preventDefault();
                    list.load();
                  }}
                >
                  Load more
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>

      {showFilters ? (
        <Drawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          title="Filters"
          side="left"
        >
          <FilterPanel
            groups={filterGroups}
            state={state}
            pathname={pathname}
            base={base}
          />
          <Button
            variant="primary"
            fullWidth
            className="mt-6"
            onClick={() => setDrawerOpen(false)}
          >
            Show results
          </Button>
        </Drawer>
      ) : null}
    </div>
  );
}
