import {useLoaderData, Link} from 'react-router';
import type {Route} from './+types/collections._index';
import {Image} from '~/lib/hydrogen/image';
import type {CollectionFragment} from 'storefrontapi.generated';
import {PaginatedResourceSection} from '~/components/PaginatedResourceSection';
import {cardStyles} from '~/components/ui/Card';
import {cn} from '~/components/ui/cn';
import {cursorPaginationVariables} from '~/lib/pages/cursor-pagination';

export async function loader(args: Route.LoaderArgs) {
  // Start fetching non-critical data without blocking time to first byte
  const deferredData = loadDeferredData(args);

  // Await the critical data required to render initial state of the page
  const criticalData = await loadCriticalData(args);

  return {...deferredData, ...criticalData};
}

/**
 * Load data necessary for rendering content above the fold. This is the critical data
 * needed to render the page. If it's unavailable, the whole page should 400 or 500 error.
 */
async function loadCriticalData({context, request}: Route.LoaderArgs) {
  // The cursor and direction are checked before they reach the query (security M3).
  const paginationVariables = cursorPaginationVariables(
    new URL(request.url).searchParams,
    4,
  );

  const [{collections}] = await Promise.all([
    context.storefront.query(COLLECTIONS_QUERY, {
      variables: paginationVariables,
    }),
    // Add other queries here, so that they are loaded in parallel
  ]);

  return {collections};
}

/**
 * Load data for rendering content below the fold. This data is deferred and will be
 * fetched after the initial page load. If it's unavailable, the page should still 200.
 * Make sure to not throw any errors here, as it will cause the page to 500.
 */
function loadDeferredData({context}: Route.LoaderArgs) {
  return {};
}

export default function Collections() {
  const {collections} = useLoaderData<typeof loader>();

  return (
    <div className="py-4">
      <header className="rounded-panel bg-paper p-6 md:p-10">
        <h1 className="type-display text-hero md:text-heading">Collections</h1>
      </header>
      <div className="mt-6">
        <PaginatedResourceSection<CollectionFragment>
          connection={collections}
          resourcesClassName="grid grid-cols-2 gap-3 md:gap-5 lg:grid-cols-3 xl:grid-cols-4"
        >
          {({node: collection, index}) => (
            <CollectionItem
              key={collection.id}
              collection={collection}
              index={index}
            />
          )}
        </PaginatedResourceSection>
      </div>
    </div>
  );
}

function CollectionItem({
  collection,
  index,
}: {
  collection: CollectionFragment;
  index: number;
}) {
  return (
    <Link
      className={cn(
        cardStyles({padding: 'none', interactive: true}),
        'group flex flex-col overflow-hidden',
      )}
      key={collection.id}
      to={`/collections/${collection.handle}`}
      prefetch="intent"
    >
      {collection?.image ? (
        <div className="aspect-square overflow-hidden bg-surface-muted">
          <Image
            // The title is the link's text right below; repeating it as alt text makes a screen reader say it twice.
            alt=""
            aspectRatio="1/1"
            data={collection.image}
            loading={index < 3 ? 'eager' : undefined}
            sizes="(min-width: 80rem) 22vw, (min-width: 64rem) 30vw, 46vw"
            className="size-full object-cover motion-safe:transition-transform motion-safe:group-hover:scale-105"
          />
        </div>
      ) : null}
      <h2 className="type-display p-4 text-title group-hover:underline">
        {collection.title}
      </h2>
    </Link>
  );
}

const COLLECTIONS_QUERY = `#graphql
  fragment Collection on Collection {
    id
    title
    handle
    image {
      id
      url
      altText
      width
      height
    }
  }
  query StoreCollections(
    $country: CountryCode
    $endCursor: String
    $first: Int
    $language: LanguageCode
    $last: Int
    $startCursor: String
  ) @inContext(country: $country, language: $language) {
    collections(
      first: $first,
      last: $last,
      before: $startCursor,
      after: $endCursor
    ) {
      nodes {
        ...Collection
      }
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
    }
  }
` as const;
