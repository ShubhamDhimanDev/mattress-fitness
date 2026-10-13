import {Link, useLoaderData} from 'react-router';
import type {Route} from './+types/stores.$state._index';
import {formatPageTitle} from '~/components/layout/documentTitle';
import {PreviewNotice} from '~/components/pages/PreviewNotice';
import {StoreCard} from '~/components/stores/StoreCard';
import {Breadcrumb} from '~/components/ui/Breadcrumb';
import {readMyStore} from '~/lib/pages/my-store';
import {loadStoreIndex, notFound} from '~/lib/pages/stores-data';
import {storeCountText, storeEntry} from '~/lib/pages/stores-view';
import {STORES_ROOT_PATH, cityPath, findState} from '~/lib/stores/grouping';

// P6-06: stores in one state (REQ-LOC-001). An unknown or malformed state is a 404 inside the shell.

export const meta: Route.MetaFunction = ({data}) => [
  {
    title: formatPageTitle(
      data ? `Mattress stores in ${data.name}` : 'Store not found',
    ),
  },
  ...(data
    ? [
        {
          name: 'description',
          content: `Our ${storeCountText(data.storeCount)} in ${data.name}: addresses, opening hours and directions.`,
        },
      ]
    : []),
];

export async function loader({params, request}: Route.LoaderArgs) {
  const {source, index} = await loadStoreIndex();
  const state = findState(index, params.state);
  if (!state) throw notFound();

  const mine = readMyStore(index, request.headers.get('Cookie'));
  const nowMs = Date.now();
  return {
    source,
    name: state.name,
    storeCount: state.storeCount,
    cities: state.cities.map((city) => ({
      name: city.name,
      path: cityPath(state.code, city.name),
      stores: city.stores.map((store) =>
        storeEntry(store, nowMs, mine?.id ?? null),
      ),
    })),
  };
}

export default function StoresStatePage() {
  const {source, name, storeCount, cities} = useLoaderData<typeof loader>();
  return (
    <div className="mx-auto flex max-w-page flex-col gap-8 py-8">
      <Breadcrumb
        items={[
          {label: 'Home', to: '/'},
          {label: 'Stores', to: STORES_ROOT_PATH},
          {label: name},
        ]}
      />
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold">Stores in {name}</h1>
        <p className="text-base text-fg-muted">{storeCountText(storeCount)}</p>
      </header>
      {source === 'fixtures' ? <PreviewNotice subject="stores" /> : null}
      {cities.map((city) => (
        <section
          key={city.path}
          aria-labelledby={`city-${city.path}`}
          className="flex flex-col gap-3"
        >
          <h2 id={`city-${city.path}`} className="text-2xl font-bold">
            <Link to={city.path} className="underline-offset-2 hover:underline">
              {city.name}
            </Link>
          </h2>
          <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {city.stores.map((entry) => (
              <li key={entry.view.path}>
                <StoreCard
                  view={entry.view}
                  storeKey={entry.storeKey}
                  isMine={entry.isMine}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
