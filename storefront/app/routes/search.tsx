import {Analytics} from '~/lib/hydrogen/analytics';
import {useLoaderData} from 'react-router';
import type {Route} from './+types/search';
import {SearchResults} from '~/components/collection/SearchResults';
import {formatPageTitle} from '~/components/layout/documentTitle';
import {Button} from '~/components/ui/Button';
import {Input} from '~/components/ui/Input';
import {errorFields, logError} from '~/lib/logging/logger';
import {countActiveFilters, parseFilterParams} from '~/lib/filters';
import {
  getEmptyPredictiveSearchResult,
  type PredictiveSearchReturn,
} from '~/lib/search';
import {MIN_PREDICTIVE_TERM_LENGTH} from '~/lib/shopify/config';
import {
  emptySearchPage,
  loadSearchPage,
  normalizeSearchTerm,
  toCacheableTerm,
} from '~/lib/shopify/search-data';

export const meta: Route.MetaFunction = ({data}) => [
  {
    title: formatPageTitle(
      data && 'term' in data && data.term ? `Search: ${data.term}` : 'Search',
    ),
  },
  // Never indexed (DEC-044): internal search results are thin duplicates of the catalog.
  {name: 'robots', content: 'noindex,follow'},
];

/** Shopify problems are logged without the shopper's search text and never shown to them (T-05). */
function logSearchFailure(error: unknown) {
  logError('search.failed', errorFields(error));
}

export async function loader({request, context}: Route.LoaderArgs) {
  const url = new URL(request.url);
  const term = normalizeSearchTerm(url.searchParams.get('q'));

  if (url.searchParams.has('predictive')) {
    return predictiveSearch(context.storefront, term, url.searchParams);
  }

  const state = parseFilterParams(url.searchParams);
  const activeFilters = countActiveFilters(state);

  try {
    const page = await loadSearchPage(context.storefront, term, state);
    return {type: 'regular' as const, failed: false, activeFilters, ...page};
  } catch (error) {
    logSearchFailure(error);
    return {
      type: 'regular' as const,
      failed: true,
      activeFilters,
      ...emptySearchPage(term),
    };
  }
}

export default function SearchPage() {
  const data = useLoaderData<typeof loader>();
  if (data.type === 'predictive') return null;

  return (
    <div className="py-4">
      <header className="rounded-panel bg-paper p-6 md:p-10">
        <h1 className="type-display text-4xl md:text-heading">
          {data.term ? `Search results for “${data.term}”` : 'Search'}
        </h1>
        <form
          method="get"
          action="/search"
          role="search"
          aria-label="Search this store"
          className="mt-4 flex max-w-xl items-end gap-2"
        >
          <Input
            label="Search products and pages"
            name="q"
            type="search"
            defaultValue={data.term}
            maxLength={100}
            className="flex-1"
          />
          <Button type="submit">Search</Button>
        </form>
      </header>

      {data.failed ? (
        <p
          role="alert"
          className="mt-6 rounded-card border-2 border-error-fg bg-error-bg p-4 text-base font-bold text-error-fg"
        >
          Search is not available right now. Please try again in a moment.
        </p>
      ) : null}

      {data.term && !data.failed ? (
        <SearchResults
          term={data.term}
          products={data.products}
          pageInfo={data.pageInfo}
          filterGroups={data.filterGroups}
          activeFilters={data.activeFilters}
          pages={data.pages}
          articles={data.articles}
          suggestedCollections={data.suggestedCollections}
        />
      ) : null}

      <Analytics.SearchView
        data={{searchTerm: data.term, searchResults: null}}
      />
    </div>
  );
}

// NOTE: https://shopify.dev/docs/api/storefront/latest/queries/predictiveSearch
const PREDICTIVE_SEARCH_QUERY = `#graphql
  fragment PredictiveArticle on Article {
    __typename
    id
    title
    handle
    blog {
      handle
    }
    image {
      url
      altText
      width
      height
    }
    trackingParameters
  }
  fragment PredictiveCollection on Collection {
    __typename
    id
    title
    handle
    image {
      url
      altText
      width
      height
    }
    trackingParameters
  }
  fragment PredictivePage on Page {
    __typename
    id
    title
    handle
    trackingParameters
  }
  fragment PredictiveProduct on Product {
    __typename
    id
    title
    handle
    trackingParameters
    selectedOrFirstAvailableVariant(
      selectedOptions: []
      ignoreUnknownOptions: true
      caseInsensitiveMatch: true
    ) {
      id
      image {
        url
        altText
        width
        height
      }
      price {
        amount
        currencyCode
      }
    }
  }
  fragment PredictiveQuery on SearchQuerySuggestion {
    __typename
    text
    styledText
    trackingParameters
  }
  query PredictiveSearch(
    $country: CountryCode
    $language: LanguageCode
    $limit: Int!
    $limitScope: PredictiveSearchLimitScope!
    $term: String!
    $types: [PredictiveSearchType!]
  ) @inContext(country: $country, language: $language) {
    predictiveSearch(
      limit: $limit,
      limitScope: $limitScope,
      query: $term,
      types: $types,
    ) {
      articles {
        ...PredictiveArticle
      }
      collections {
        ...PredictiveCollection
      }
      pages {
        ...PredictivePage
      }
      products {
        ...PredictiveProduct
      }
      queries {
        ...PredictiveQuery
      }
    }
  }
` as const;

/**
 * Suggestions while typing (REQ-SRCH-001). Below two characters Shopify is not called; any failure
 * returns an empty result, so the panel falls back to the plain "view all results" link.
 */
async function predictiveSearch(
  storefront: Route.LoaderArgs['context']['storefront'],
  term: string,
  params: URLSearchParams,
): Promise<PredictiveSearchReturn> {
  const type = 'predictive';
  const requested = Number(params.get('limit') ?? 5);
  const limit = Number.isInteger(requested)
    ? Math.min(10, Math.max(1, requested))
    : 5;
  if (term.length < MIN_PREDICTIVE_TERM_LENGTH) {
    return {type, term, result: getEmptyPredictiveSearchResult()};
  }

  try {
    const {predictiveSearch: items} = await storefront.query(
      PREDICTIVE_SEARCH_QUERY,
      {
        cache: storefront.CacheShort(),
        variables: {limit, limitScope: 'EACH', term: toCacheableTerm(term)},
      },
    );
    if (!items) return {type, term, result: getEmptyPredictiveSearchResult()};
    const total = Object.values(items).reduce(
      (sum: number, list: Array<unknown>) => sum + list.length,
      0,
    );
    return {type, term, result: {items, total}};
  } catch (error) {
    logSearchFailure(error);
    return {type, term, result: getEmptyPredictiveSearchResult()};
  }
}
