import {Link} from 'react-router';
import {ProductListing} from '~/components/collection/ProductListing';
import {Button} from '~/components/ui/Button';
import {SEARCH_SORT_KEYS} from '~/lib/filters';
import type {ContentLink} from '~/lib/shopify/search-data';
import {shouldShowListing} from '~/lib/shopify/search-view';
import type {FilterGroupView} from '~/lib/shopify/listing';
import type {PageInfoView, ProductCardView} from '~/lib/shopify/types';

type SearchResultsProps = {
  term: string;
  products: readonly ProductCardView[];
  pageInfo: PageInfoView;
  filterGroups: readonly FilterGroupView[];
  /** Filters in the URL; with any active, an empty result still shows the panel so the shopper can undo them. */
  activeFilters: number;
  pages: readonly ContentLink[];
  articles: readonly ContentLink[];
  suggestedCollections: readonly ContentLink[];
};

/** The body of the search page for a non-empty term (REQ-SRCH-002). */
export function SearchResults({
  term,
  products,
  pageInfo,
  filterGroups,
  activeFilters,
  pages,
  articles,
  suggestedCollections,
}: SearchResultsProps) {
  if (shouldShowListing(products.length, activeFilters)) {
    return (
      <>
        <ProductListing
          products={products}
          pageInfo={pageInfo}
          filterGroups={filterGroups}
          showFilters
          sortKeys={SEARCH_SORT_KEYS}
          emptyHeading="No products match these filters"
        />
        <ContentMatches pages={pages} articles={articles} />
      </>
    );
  }
  return (
    <NoResults
      term={term}
      collections={suggestedCollections}
      pages={pages}
      articles={articles}
    />
  );
}

function ContentMatches({
  pages,
  articles,
}: {
  pages: readonly ContentLink[];
  articles: readonly ContentLink[];
}) {
  const links = [...pages, ...articles];
  if (links.length === 0) return null;
  return (
    <section aria-labelledby="search-content-heading" className="mt-12">
      <h2 id="search-content-heading" className="type-display mb-2 text-2xl">
        Pages and articles
      </h2>
      <ul>
        {links.map((link) => (
          <li key={link.id}>
            <Link
              to={link.to}
              className="inline-flex min-h-touch items-center text-primary-700 underline underline-offset-2"
            >
              {link.title}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function NoResults({
  term,
  collections,
  pages,
  articles,
}: {
  term: string;
  collections: readonly ContentLink[];
  pages: readonly ContentLink[];
  articles: readonly ContentLink[];
}) {
  return (
    <div className="mt-6 flex flex-col items-start gap-3 rounded-card bg-surface-muted p-6 md:p-10">
      <h2 className="type-display text-2xl">No products found for “{term}”</h2>
      <p className="text-base text-fg-muted">
        Check the spelling, try a more general word, or browse one of these.
      </p>
      <ul className="flex flex-wrap gap-2">
        {collections.map((collection) => (
          <li key={collection.id}>
            <Button to={collection.to} variant="outline" size="sm">
              {collection.title}
            </Button>
          </li>
        ))}
        <li>
          <Button to="/collections/all" variant="outline" size="sm">
            All products
          </Button>
        </li>
      </ul>
      <ContentMatches pages={pages} articles={articles} />
    </div>
  );
}
