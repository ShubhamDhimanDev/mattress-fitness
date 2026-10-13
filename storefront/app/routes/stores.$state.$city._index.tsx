import {data as withHeaders, useLoaderData} from 'react-router';
import type {Route} from './+types/stores.$state.$city._index';
import {formatPageTitle} from '~/components/layout/documentTitle';
import {PreviewNotice} from '~/components/pages/PreviewNotice';
import {StoreCard} from '~/components/stores/StoreCard';
import {Breadcrumb} from '~/components/ui/Breadcrumb';
import {previewRobotsMeta} from '~/lib/pages/head';
import {readMyStore} from '~/lib/pages/my-store';
import {
  PRIVATE_NO_STORE_HEADERS,
  forwardLoaderHeaders,
} from '~/lib/pages/private-response';
import {loadStoreIndex, notFound} from '~/lib/pages/stores-data';
import {storeCountText, storeEntry} from '~/lib/pages/stores-view';
import {STORES_ROOT_PATH, findCity, statePath} from '~/lib/stores/grouping';

// P6-06: stores in one city (REQ-LOC-001).

export const meta: Route.MetaFunction = ({data: loaderData}) => [
  ...previewRobotsMeta(loaderData?.source),
  {
    title: formatPageTitle(
      loaderData
        ? `Mattress stores in ${loaderData.cityName}, ${loaderData.stateCode}`
        : 'Store not found',
    ),
  },
  ...(loaderData
    ? [
        {
          name: 'description',
          content: `Our ${storeCountText(loaderData.stores.length)} in ${loaderData.cityName}, ${loaderData.stateName}: addresses, opening hours and directions.`,
        },
      ]
    : []),
];

export async function loader({params, request}: Route.LoaderArgs) {
  const {source, index} = await loadStoreIndex();
  const found = findCity(index, params.state, params.city);
  if (!found) throw notFound();

  const mine = readMyStore(index, request.headers.get('Cookie'));
  const nowMs = Date.now();
  // Depends on the my_store cookie, so it must never sit in a shared cache (P-L3).
  return withHeaders(
    {
      source,
      stateName: found.state.name,
      stateCode: found.state.code,
      statePath: statePath(found.state.code),
      cityName: found.city.name,
      stores: found.city.stores.map((store) =>
        storeEntry(store, nowMs, mine?.id ?? null),
      ),
    },
    {headers: PRIVATE_NO_STORE_HEADERS},
  );
}

export const headers = forwardLoaderHeaders;

export default function StoresCityPage() {
  const data = useLoaderData<typeof loader>();
  return (
    <div className="mx-auto flex max-w-page flex-col gap-8 py-8">
      <Breadcrumb
        items={[
          {label: 'Home', to: '/'},
          {label: 'Stores', to: STORES_ROOT_PATH},
          {label: data.stateName, to: data.statePath},
          {label: data.cityName},
        ]}
      />
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold">
          Stores in {data.cityName}, {data.stateCode}
        </h1>
        <p className="text-base text-fg-muted">
          {storeCountText(data.stores.length)}
        </p>
      </header>
      {data.source === 'fixtures' ? <PreviewNotice subject="stores" /> : null}
      <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {data.stores.map((entry) => (
          <li key={entry.view.path}>
            <StoreCard
              view={entry.view}
              storeKey={entry.storeKey}
              isMine={entry.isMine}
              headingLevel={2}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
