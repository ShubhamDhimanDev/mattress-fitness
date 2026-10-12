import {Analytics, getShopAnalytics, useNonce} from '@shopify/hydrogen';
import {
  Outlet,
  useRouteError,
  isRouteErrorResponse,
  type ShouldRevalidateFunction,
  Links,
  Meta,
  Scripts,
  ScrollRestoration,
  useRouteLoaderData,
} from 'react-router';
import type {Route} from './+types/root';
import favicon from '~/assets/favicon.svg';
import {FOOTER_QUERY, HEADER_QUERY} from '~/lib/fragments';
import tailwindCss from './styles/tailwind.css?url';
import {formatPageTitle} from '~/components/layout/documentTitle';
import {PageLayout} from '~/components/layout/PageLayout';
import {MAIN_CONTENT_ID, SkipLink} from '~/components/layout/SkipLink';
import {Button} from '~/components/ui/Button';

export type RootLoader = typeof loader;

// Default title; each route's own `meta` replaces it and should call formatPageTitle('Page name').
export const meta: Route.MetaFunction = () => [{title: formatPageTitle()}];

/**
 * This is important to avoid re-fetching root queries on sub-navigations
 */
export const shouldRevalidate: ShouldRevalidateFunction = ({
  formMethod,
  currentUrl,
  nextUrl,
}) => {
  // revalidate when a mutation is performed e.g add to cart, login...
  if (formMethod && formMethod !== 'GET') return true;

  // revalidate when manually revalidating via useRevalidator
  if (currentUrl.toString() === nextUrl.toString()) return true;

  // Defaulting to no revalidation for root loader data to improve performance.
  // When using this feature, you risk your UI getting out of sync with your server.
  // Use with caution. If you are uncomfortable with this optimization, update the
  // line below to `return defaultShouldRevalidate` instead.
  // For more details see: https://remix.run/docs/en/main/route/should-revalidate
  return false;
};

/**
 * The stylesheet (tokens, base styles and the legacy template CSS it imports) is added in the Layout
 * component to prevent a bug in development HMR updates.
 *
 * This avoids the "failed to execute 'insertBefore' on 'Node'" error
 * that occurs after editing and navigating to another page.
 *
 * It's a temporary fix until the issue is resolved.
 * https://github.com/remix-run/remix/issues/9242
 */
export function links() {
  return [
    {
      rel: 'preconnect',
      href: 'https://cdn.shopify.com',
    },
    {
      rel: 'preconnect',
      href: 'https://shop.app',
    },
    {rel: 'icon', type: 'image/svg+xml', href: favicon},
  ];
}

export async function loader(args: Route.LoaderArgs) {
  // Start fetching non-critical data without blocking time to first byte
  const deferredData = loadDeferredData(args);

  // Await the critical data required to render initial state of the page
  const criticalData = await loadCriticalData(args);

  const {storefront, env} = args.context;

  return {
    ...deferredData,
    ...criticalData,
    publicStoreDomain: env.PUBLIC_STORE_DOMAIN,
    shop: getShopAnalytics({
      storefront,
      publicStorefrontId: env.PUBLIC_STOREFRONT_ID,
    }),
    consent: {
      checkoutDomain: env.PUBLIC_CHECKOUT_DOMAIN,
      storefrontAccessToken: env.PUBLIC_STOREFRONT_API_TOKEN,
      withPrivacyBanner: false,
      // localize the privacy banner
      country: args.context.storefront.i18n.country,
      language: args.context.storefront.i18n.language,
    },
  };
}

/**
 * Load data necessary for rendering content above the fold. This is the critical data
 * needed to render the page. If it's unavailable, the whole page should 400 or 500 error.
 */
async function loadCriticalData({context}: Route.LoaderArgs) {
  const {storefront} = context;

  const [header] = await Promise.all([
    storefront.query(HEADER_QUERY, {
      cache: storefront.CacheLong(),
      variables: {
        headerMenuHandle: 'main-menu', // Adjust to your header menu handle
      },
    }),
    // Add other queries here, so that they are loaded in parallel
  ]);

  return {header};
}

/**
 * Load data for rendering content below the fold. This data is deferred and will be
 * fetched after the initial page load. If it's unavailable, the page should still 200.
 * Make sure to not throw any errors here, as it will cause the page to 500.
 */
function loadDeferredData({context}: Route.LoaderArgs) {
  const {storefront, customerAccount, cart} = context;

  // defer the footer query (below the fold)
  const footer = storefront
    .query(FOOTER_QUERY, {
      cache: storefront.CacheLong(),
      variables: {
        footerMenuHandle: 'footer', // Adjust to your footer menu handle
      },
    })
    .catch((error: Error) => {
      // Log query errors, but don't throw them so the page can still render
      console.error(error);
      return null;
    });
  return {
    cart: cart.get(),
    isLoggedIn: customerAccount.isLoggedIn(),
    footer,
  };
}

export function Layout({children}: {children?: React.ReactNode}) {
  const nonce = useNonce();

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="stylesheet" href={tailwindCss}></link>
        <Meta />
        <Links />
      </head>
      <body>
        <SkipLink />
        {children}
        <ScrollRestoration nonce={nonce} />
        <Scripts nonce={nonce} />
      </body>
    </html>
  );
}

export default function App() {
  const data = useRouteLoaderData<RootLoader>('root');

  if (!data) {
    return <Outlet />;
  }

  return (
    <Analytics.Provider
      cart={data.cart}
      shop={data.shop}
      consent={data.consent}
    >
      <PageLayout cart={data.cart} isLoggedIn={data.isLoggedIn}>
        <Outlet />
      </PageLayout>
    </Analytics.Provider>
  );
}

type ErrorView = {
  status: number;
  title: string;
  message: string;
  detail: string;
};

function describeError(error: unknown): ErrorView {
  if (isRouteErrorResponse(error)) {
    const payload: unknown = error.data;
    const detail =
      typeof payload === 'string'
        ? payload
        : payload &&
            typeof payload === 'object' &&
            'message' in payload &&
            typeof payload.message === 'string'
          ? payload.message
          : '';
    return error.status === 404
      ? {
          status: 404,
          title: 'Page not found',
          message: 'We could not find the page you were looking for.',
          detail,
        }
      : {
          status: error.status,
          title: 'Something went wrong',
          message: 'Please try again in a moment.',
          detail,
        };
  }
  return {
    status: 500,
    title: 'Something went wrong',
    message: 'Please try again in a moment.',
    detail: error instanceof Error ? error.message : '',
  };
}

export function ErrorBoundary() {
  const error = useRouteError();
  const data = useRouteLoaderData<RootLoader>('root');
  const view = describeError(error);

  // Error text from the server is shown only in development; shoppers get a fixed, safe message.
  const content = (
    <div className="flex flex-col items-start gap-4 py-12">
      <p className="text-sm font-bold text-fg-muted">Error {view.status}</p>
      <h1 className="text-3xl font-bold">{view.title}</h1>
      <p className="text-base text-fg-muted">{view.message}</p>
      <Button to="/" variant="pill">
        Back to the home page
      </Button>
      {import.meta.env.DEV && view.detail ? (
        <pre className="max-w-full overflow-x-auto rounded-card bg-surface-muted p-4 text-sm">
          {view.detail}
        </pre>
      ) : null}
    </div>
  );

  // Keep the header and footer on error pages when the root loader succeeded (the usual 404 case).
  if (!data) {
    return (
      <main
        id={MAIN_CONTENT_ID}
        tabIndex={-1}
        className="mx-auto w-full max-w-page flex-1 px-4 md:px-6"
      >
        {content}
      </main>
    );
  }

  return (
    <Analytics.Provider
      cart={data.cart}
      shop={data.shop}
      consent={data.consent}
    >
      <PageLayout cart={data.cart} isLoggedIn={data.isLoggedIn}>
        {content}
      </PageLayout>
    </Analytics.Provider>
  );
}
