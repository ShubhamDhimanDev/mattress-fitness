import {data as withHeaders, useLoaderData} from 'react-router';
import type {Route} from './+types/stores.$state.$city.$slug';
import {formatPageTitle} from '~/components/layout/documentTitle';
import {PreviewNotice} from '~/components/pages/PreviewNotice';
import {MyStoreControl} from '~/components/stores/MyStoreControl';
import {StatusLine} from '~/components/stores/StoreCard';
import {StoreHoursTable} from '~/components/stores/StoreHoursTable';
import {StoreMapBlock} from '~/components/stores/StoreMapBlock';
import {ProductTile} from '~/components/pages/ProductTile';
import {Breadcrumb} from '~/components/ui/Breadcrumb';
import {PhoneIcon} from '~/components/ui/Icons';
import {previewRobotsMeta} from '~/lib/pages/head';
import {myStoreKey, readMyStore} from '~/lib/pages/my-store';
import {
  PRIVATE_NO_STORE_HEADERS,
  forwardLoaderHeaders,
} from '~/lib/pages/private-response';
import {resolveSiteOrigin} from '~/lib/site-origin';
import {loadStoreIndex, notFound} from '~/lib/pages/stores-data';
import {storeCardView, weeklyHoursView} from '~/lib/pages/stores-view';
import {
  STORES_ROOT_PATH,
  cityPath,
  findStore,
  statePath,
} from '~/lib/stores/grouping';
import {buildStoreJsonLd, serializeJsonLd} from '~/lib/stores/jsonld';

// P6-06: one store (REQ-LOC-001): address, tap-to-call, today's hours and open status, the full week,
// directions, LocalBusiness JSON-LD, and "Set as my store" (REQ-LOC-003).

export const meta: Route.MetaFunction = ({data: loaderData}) => [
  ...previewRobotsMeta(loaderData?.source),
  {title: formatPageTitle(loaderData ? loaderData.name : 'Store not found')},
  ...(loaderData
    ? [
        {
          name: 'description',
          content: `${loaderData.name}: address, opening hours, phone number and directions.`,
        },
      ]
    : []),
];

export async function loader({params, request, context}: Route.LoaderArgs) {
  const {source, index} = await loadStoreIndex();
  const found = findStore(index, params.state, params.city, params.slug);
  if (!found) throw notFound();
  const {store, state, city} = found;

  const mine = readMyStore(index, request.headers.get('Cookie'));
  const nowMs = Date.now();
  // Depends on the my_store cookie, so it must never sit in a shared cache (P-L3).
  return withHeaders(
    {
      source,
      name: store.name,
      stateName: state.name,
      statePath: statePath(state.code),
      cityName: city.name,
      cityPath: cityPath(state.code, city.name),
      view: storeCardView(store, nowMs),
      week: weeklyHoursView(store, nowMs),
      photoUrl: store.photoUrl,
      storeKey: myStoreKey(store),
      isMine: mine?.id === store.id,
      // Built from the same store object as the visible text. The origin is configured, never the request's
      // Host (P-L2); only an https origin yields absolute URLs.
      jsonLd: buildStoreJsonLd(store, {
        siteOrigin: resolveSiteOrigin({
          env: context.env,
          requestUrl: request.url,
          isDev: import.meta.env.DEV,
        }),
      }),
    },
    {headers: PRIVATE_NO_STORE_HEADERS},
  );
}

export const headers = forwardLoaderHeaders;

export default function StorePage() {
  const data = useLoaderData<typeof loader>();
  const {view} = data;
  return (
    <div className="mx-auto flex max-w-page flex-col gap-8 py-8">
      {/* serializeJsonLd escapes "<", ">" and "&", so store text cannot close the script block. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{__html: serializeJsonLd(data.jsonLd)}}
      />
      <Breadcrumb
        items={[
          {label: 'Home', to: '/'},
          {label: 'Stores', to: STORES_ROOT_PATH},
          {label: data.stateName, to: data.statePath},
          {label: data.cityName, to: data.cityPath},
          {label: data.name},
        ]}
      />
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-bold">{data.name}</h1>
        <StatusLine status={view.status} />
        <p role="status" className="text-sm font-bold text-primary-800">
          {data.isMine ? 'This is your store.' : ''}
        </p>
      </header>
      {data.source === 'fixtures' ? <PreviewNotice subject="stores" /> : null}

      <div className="grid gap-8 lg:grid-cols-2">
        <div className="flex flex-col gap-8">
          <StoreMapBlock
            name={data.name}
            addressLines={view.addressLines}
            directionsUrl={view.directionsUrl}
          />
          <section
            aria-labelledby="store-contact-heading"
            className="flex flex-col gap-3"
          >
            <h2 id="store-contact-heading" className="text-xl font-bold">
              Contact and pickup
            </h2>
            {view.phone ? (
              <a
                href={view.phone.href}
                className="inline-flex min-h-touch w-fit items-center gap-2 text-lg font-bold text-primary-700 underline underline-offset-2"
              >
                <PhoneIcon className="size-5" />
                <span>
                  <span className="sr-only">Call </span>
                  {view.phone.display}
                </span>
              </a>
            ) : (
              <p className="text-fg-muted">Phone number not available.</p>
            )}
            <p className="text-base">
              {view.pickupEnabled
                ? 'In-store pickup is available at this store.'
                : 'In-store pickup is not offered at this store.'}
            </p>
            <MyStoreControl
              storeKey={data.storeKey}
              storeName={data.name}
              isMine={data.isMine}
            />
          </section>
        </div>

        <div className="flex flex-col gap-8">
          {data.photoUrl ? (
            <ProductTile
              image={{
                url: data.photoUrl,
                altText: `${data.name} storefront`,
                width: null,
                height: null,
              }}
            />
          ) : null}
          <section
            aria-labelledby="store-hours-heading"
            className="flex flex-col gap-3"
          >
            <h2 id="store-hours-heading" className="text-xl font-bold">
              Opening hours
            </h2>
            <p className="text-base">{view.todayText}</p>
            {data.week ? (
              <StoreHoursTable rows={data.week} />
            ) : (
              <p className="text-fg-muted">
                Opening hours are not available for this store. Please call
                before you visit.
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
