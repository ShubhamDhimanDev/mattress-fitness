import {Link, data, redirect, useLoaderData} from 'react-router';
import type {Route} from './+types/stores._index';
import {formatPageTitle} from '~/components/layout/documentTitle';
import {StoreCard} from '~/components/stores/StoreCard';
import {Breadcrumb} from '~/components/ui/Breadcrumb';
import {Button} from '~/components/ui/Button';
import {Input} from '~/components/ui/Input';
import {cardStyles} from '~/components/ui/Card';
import {previewRobotsMeta} from '~/lib/pages/head';
import {
  PRIVATE_NO_STORE_HEADERS,
  forwardLoaderHeaders,
} from '~/lib/pages/private-response';
import {
  clearMyStoreCookie,
  parseMyStoreForm,
  readMyStore,
  setMyStoreCookie,
  shouldSecureCookie,
} from '~/lib/pages/my-store';
import {loadStoreIndex} from '~/lib/pages/stores-data';
import {storeCountText, storeEntry} from '~/lib/pages/stores-view';
import {
  STORES_ROOT_PATH,
  allStores,
  statePath,
  storePath,
} from '~/lib/stores/grouping';
import type {Store} from '~/lib/stores/types';
import {matchStoresByZip, parseZipQuery, type ZipQuery} from '~/lib/stores/zip';
import type {StoreEntry} from '~/lib/pages/stores-view';

// P6-06: store locator index (REQ-LOC-001) and the "my store" action (REQ-LOC-003). Every store page posts
// its Set and Clear buttons here.
//
// `?zip=` (CR31-10) lists the stores in the shopper's ZIP area: the same ZIP, then the same first three digits, taken
// from the stores' own postal codes. It is not a distance and uses no geocoding service. The ZIP lives only in this
// request's URL: it is not stored, put in a cookie or logged.

type ZipSearchView =
  | {status: 'none'}
  | {status: 'invalid'}
  | {status: 'no-match'; zip: string}
  | {
      status: 'results';
      zip: string;
      exact: StoreEntry[];
      area: StoreEntry[];
    };

export const meta: Route.MetaFunction = ({data: loaderData}) => [
  ...previewRobotsMeta(loaderData?.source),
  // A ZIP result page is one of endless query variants: keep it out of search indexes.
  ...(loaderData && loaderData.zipSearch.status !== 'none'
    ? [{name: 'robots', content: 'noindex'}]
    : []),
  {title: formatPageTitle('Find a store')},
  {
    name: 'description',
    content:
      'Find a store near you: addresses, opening hours, phone numbers and directions.',
  },
];

export async function loader({request, context}: Route.LoaderArgs) {
  const {source, index} = await loadStoreIndex(context.storefront);
  const mine = readMyStore(index, request.headers.get('Cookie'));
  // Loader data carries the time so the server and the browser render the same open/closed text.
  const nowMs = Date.now();
  const zipSearch = zipSearchView(
    parseZipQuery(new URL(request.url).searchParams.get('zip')),
    allStores(index),
    (store) => storeEntry(store, nowMs, mine ? mine.id : null),
  );
  // Depends on the my_store cookie and on the ZIP in the URL, so it must never sit in a shared cache (P-L3).
  return data(
    {
      source,
      nowMs,
      zipSearch,
      storeCount: index.storeCount,
      myStore: mine ? storeEntry(mine, nowMs, mine.id) : null,
      states: index.states.map((state) => ({
        code: state.code,
        name: state.name,
        path: statePath(state.code),
        countText: storeCountText(state.storeCount),
      })),
    },
    {headers: PRIVATE_NO_STORE_HEADERS},
  );
}

function zipSearchView(
  query: ZipQuery,
  stores: readonly Store[],
  toEntry: (store: Store) => StoreEntry,
): ZipSearchView {
  switch (query.status) {
    case 'none':
      return {status: 'none'};
    case 'invalid':
      return {status: 'invalid'};
    case 'valid': {
      const matches = matchStoresByZip(stores, query.zip);
      if (matches.kind === 'none') return {status: 'no-match', zip: query.zip};
      return {
        status: 'results',
        zip: query.zip,
        exact: matches.exact.map(toEntry),
        area: matches.area.map(toEntry),
      };
    }
    default: {
      const unreachable: never = query;
      return unreachable;
    }
  }
}

export async function action({request, context}: Route.ActionArgs) {
  const {index} = await loadStoreIndex(context.storefront);
  const intent = parseMyStoreForm(index, await request.formData());
  const secure = shouldSecureCookie(request.url);

  switch (intent.type) {
    case 'set':
      // Redirect targets come from our own store list, never from the request (T-08).
      return redirect(storePath(intent.store), {
        headers: {'Set-Cookie': setMyStoreCookie(intent.store, {secure})},
      });
    case 'clear':
      return redirect(
        intent.returnTo ? storePath(intent.returnTo) : STORES_ROOT_PATH,
        {headers: {'Set-Cookie': clearMyStoreCookie({secure})}},
      );
    case 'invalid':
      return data({error: 'That store could not be found.'}, {status: 400});
    default: {
      const unreachable: never = intent;
      return unreachable;
    }
  }
}

export const headers = forwardLoaderHeaders;

const ZIP_ERROR_TEXT = 'Enter a 5-digit ZIP code, for example 14201.';

function ZipSearch({zipSearch}: {zipSearch: ZipSearchView}) {
  return (
    <section
      aria-labelledby="zip-search-heading"
      className="flex flex-col gap-4"
    >
      <h2 id="zip-search-heading" className="type-display text-2xl md:text-3xl">
        Stores in your ZIP area
      </h2>
      {/* A plain GET form: works without JavaScript and keeps the ZIP in the address bar only (never stored). */}
      <form
        method="get"
        action={STORES_ROOT_PATH}
        className="flex w-full max-w-lg flex-col gap-3 sm:flex-row sm:items-start"
      >
        <Input
          name="zip"
          label="ZIP code"
          hideLabel
          placeholder="ZIP code"
          inputMode="numeric"
          autoComplete="postal-code"
          maxLength={10}
          defaultValue={
            zipSearch.status === 'results' || zipSearch.status === 'no-match'
              ? zipSearch.zip
              : undefined
          }
          error={zipSearch.status === 'invalid' ? ZIP_ERROR_TEXT : undefined}
          className="flex-1"
        />
        <Button type="submit" size="lg">
          Find stores
        </Button>
      </form>
      <div role="status" aria-live="polite" className="flex flex-col gap-4">
        {zipSearch.status === 'no-match' ? (
          <p className="max-w-prose text-base text-fg-muted">
            We found no store in the ZIP area of {zipSearch.zip}. Choose a state
            below to see all of our stores.
          </p>
        ) : null}
        {zipSearch.status === 'results' ? (
          <ZipResults zipSearch={zipSearch} />
        ) : null}
      </div>
    </section>
  );
}

function ZipResults({
  zipSearch,
}: {
  zipSearch: Extract<ZipSearchView, {status: 'results'}>;
}) {
  const {zip, exact, area} = zipSearch;
  return (
    <>
      <p className="max-w-prose text-base text-fg-muted">
        Stores with a ZIP code that matches {zip} or starts with{' '}
        {zip.slice(0, 3)}. This shows the same ZIP area, not distance.
      </p>
      {exact.length > 0 ? (
        <ZipGroup heading={`In ZIP ${zip}`} entries={exact} />
      ) : null}
      {area.length > 0 ? (
        <ZipGroup
          heading={`Same ZIP area (${zip.slice(0, 3)}xx)`}
          entries={area}
        />
      ) : null}
    </>
  );
}

function ZipGroup({
  heading,
  entries,
}: {
  heading: string;
  entries: readonly StoreEntry[];
}) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="type-display text-xl">{heading}</h3>
      <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {entries.map((entry) => (
          <li key={entry.storeKey}>
            <StoreCard
              view={entry.view}
              storeKey={entry.storeKey}
              isMine={entry.isMine}
              headingLevel={3}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function StoresIndexPage() {
  const {myStore, states, storeCount, zipSearch} =
    useLoaderData<typeof loader>();
  return (
    <div className="mx-auto flex max-w-page flex-col gap-8 py-8">
      <Breadcrumb items={[{label: 'Home', to: '/'}, {label: 'Stores'}]} />
      <header className="flex flex-col gap-2">
        <h1 className="type-display text-4xl md:text-5xl">Find a store</h1>
        <p className="max-w-prose text-base text-fg-muted">
          Visit us to try a mattress in person. Choose a state to see our{' '}
          {storeCountText(storeCount)}, with addresses, opening hours and
          directions.
        </p>
      </header>

      <ZipSearch zipSearch={zipSearch} />

      {myStore ? (
        <section
          aria-labelledby="my-store-heading"
          className="flex flex-col gap-3"
        >
          <h2
            id="my-store-heading"
            className="type-display text-2xl md:text-3xl"
          >
            Your store
          </h2>
          <div className="max-w-md">
            <StoreCard
              view={myStore.view}
              storeKey={myStore.storeKey}
              isMine={myStore.isMine}
            />
          </div>
        </section>
      ) : null}

      <section aria-labelledby="states-heading" className="flex flex-col gap-3">
        <h2 id="states-heading" className="type-display text-2xl md:text-3xl">
          Stores by state
        </h2>
        {states.length === 0 ? (
          <p className="text-base text-fg-muted">
            We have no stores to show right now. Please check back soon.
          </p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {states.map((state) => (
              <li key={state.code}>
                <Link
                  to={state.path}
                  className={
                    cardStyles({interactive: true, padding: 'sm'}) +
                    ' flex min-h-14 items-center justify-between gap-3 font-bold'
                  }
                >
                  <span>{state.name}</span>
                  <span className="text-sm font-semibold text-fg-muted">
                    {state.countText}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
