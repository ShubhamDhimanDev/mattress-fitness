import {Link, data, redirect, useLoaderData} from 'react-router';
import type {Route} from './+types/stores._index';
import {formatPageTitle} from '~/components/layout/documentTitle';
import {PreviewNotice} from '~/components/pages/PreviewNotice';
import {StoreCard} from '~/components/stores/StoreCard';
import {Breadcrumb} from '~/components/ui/Breadcrumb';
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
import {STORES_ROOT_PATH, statePath, storePath} from '~/lib/stores/grouping';

// P6-06: store locator index (REQ-LOC-001) and the "my store" action (REQ-LOC-003). Every store page posts
// its Set and Clear buttons here.

export const meta: Route.MetaFunction = ({data: loaderData}) => [
  ...previewRobotsMeta(loaderData?.source),
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
  // Depends on the my_store cookie, so it must never sit in a shared cache (P-L3).
  return data(
    {
      source,
      nowMs,
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

export default function StoresIndexPage() {
  const {source, myStore, states, storeCount} = useLoaderData<typeof loader>();
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
      {source === 'fixtures' ? <PreviewNotice subject="stores" /> : null}

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
