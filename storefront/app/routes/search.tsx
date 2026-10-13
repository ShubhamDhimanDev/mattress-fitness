import {Analytics} from '@shopify/hydrogen';
import {Link, useLoaderData} from 'react-router';
import type {Route} from './+types/search';
import {ProductListing} from '~/components/collection/ProductListing';
import {formatPageTitle} from '~/components/layout/documentTitle';
import {Button} from '~/components/ui/Button';
import {Input} from '~/components/ui/Input';
import {SEARCH_SORT_KEYS, parseFilterParams} from '~/lib/filters';
import {
  getEmptyPredictiveSearchResult,
  type PredictiveSearchReturn,
} from '~/lib/search';
import {MIN_PREDICTIVE_TERM_LENGTH} from '~/lib/shopify/config';
import {
  emptySearchPage,
  loadSearchPage,
  normalizeSearchTerm,
} from '~/lib/shopify/search-data';

export const meta: Route.MetaFunction = ({data}) => [
  {
    title: formatPageTitle(
      data && 'term' in data && data.term ? `Search: ${data.term}` : 'Search',
    ),
  },
  {name: 'robots', content: 'noindex'},
];

/** Shopify problems are logged without the shopper's search text and never shown to them (T-05). */
function logSearchFailure(error: unknown) {
  console.error(
    'Search failed:',
    error instanceof Error ? error.name : 'unknown error',
  );
}

export async function loader({request, context}: Route.LoaderArgs) {
  const url = new URL(request.url);
  const term = normalizeSearchTerm(url.searchParams.get('q'));

  if (url.searchParams.has('predictive')) {
    return predictiveSearch(context.storefront, term, url.searchParams);
  }

  try {
    const page = await loadSearchPage(
      context.storefront,
      term,
      parseFilterParams(url.searchParams),
    );
    return {type: 'regular' as const, failed: false, ...page};
  } catch (error) {
    logSearchFailure(error);
    return {
      type: 'regular' as const,
      failed: true,
      ...emptySearchPage(term),
    };
  }
}

export default function SearchPage() {
  const data = useLoaderData<typeof loader>();
  if (data.type === 'predictive') return null;

  return (
    <div className="py-4">
      <h1 className="text-3xl font-bold">
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

      {data.failed ? (
        <p role="alert" className="mt-6 text-base">
          Search is not available right now. Please try again in a moment.
        </p>
      ) : null}

      {data.term && !data.failed ? (
        data.products.length > 0 ? (
          <>
            <ProductListing
              products={data.products}
              pageInfo={data.pageInfo}
              filterGroups={data.filterGroups}
              showFilters
              sortKeys={SEARCH_SORT_KEYS}
              emptyHeading="No products match these filters"
            />
            <ContentMatches pages={data.pages} articles={data.articles} />
          </>
        ) : (
          <NoResults
            term={data.term}
            collections={data.suggestedCollections}
            pages={data.pages}
            articles={data.articles}
          />
        )
      ) : null}

      <Analytics.SearchView
        data={{searchTerm: data.term, searchResults: null}}
      />
    </div>
  );
}

type ContentLinkView = {
  readonly id: string;
  readonly title: string;
  readonly to: string;
};

function ContentMatches({
  pages,
  articles,
}: {
  pages: readonly ContentLinkView[];
  articles: readonly ContentLinkView[];
}) {
  const links = [...pages, ...articles];
  if (links.length === 0) return null;
  return (
    <section aria-labelledby="search-content-heading" className="mt-12">
      <h2 id="search-content-heading" className="mb-2 text-xl font-bold">
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
  collections: readonly ContentLinkView[];
  pages: readonly ContentLinkView[];
  articles: readonly ContentLinkView[];
}) {
  return (
    <div className="flex flex-col items-start gap-3 py-8">
      <h2 className="text-xl font-bold">No products found for “{term}”</h2>
      <p className="text-base text-fg-muted">
        Check the spelling, try a more general word, or browse one of these.
      </p>
      <ul className="flex flex-wrap gap-2">
        {collections.map((collection) => (
          <li key={collection.id}>
            <Button to={collection.to} variant="secondary" size="sm">
              {collection.title}
            </Button>
          </li>
        ))}
        <li>
          <Button to="/collections/all" variant="secondary" size="sm">
            All products
          </Button>
        </li>
      </ul>
      <ContentMatches pages={pages} articles={articles} />
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
        variables: {limit, limitScope: 'EACH', term},
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
