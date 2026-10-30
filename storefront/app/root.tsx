import {useNonce} from '~/lib/hydrogen/nonce';
import {loadShopIdentity} from '~/lib/hydrogen/shop';
import type {Storefront} from '~/lib/hydrogen/storefront';
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
import {BRAND_HEAD_LINKS, BRAND_THEME_COLOR} from '~/lib/brand';
import {AnalyticsGate} from '~/components/consent/AnalyticsGate';
import {parseAnalyticsConfig} from '~/lib/analytics/config';
import {resolvePublicChatConfig} from '~/lib/chat/config';
import {parseExtendBranding} from '~/lib/extend-branding';
import {resolvePublicFinancingConfig} from '~/lib/financing/config';
import {FOOTER_QUERY} from '~/lib/fragments';
import tailwindCss from './styles/tailwind.css?url';
import {formatPageTitle} from '~/components/layout/documentTitle';
import {PageLayout} from '~/components/layout/PageLayout';
import {MAIN_CONTENT_ID, SkipLink} from '~/components/layout/SkipLink';
import {Button} from '~/components/ui/Button';
import {loadDeliverySummary} from '~/lib/delivery-runtime/summary';
import {errorFields, logError, logWarn} from '~/lib/logging/logger';
import {PRIVATE_REVALIDATE_HEADERS} from '~/lib/pages/private-response';
import {
  buildFooterLinks,
  buildUtilityLinks,
  existingContentPaths,
  buildFallbackNav,
} from '~/lib/navigation';
import {loadCollectionHandles} from '~/lib/shopify/collection-handles-data';
import {loadFooterPageLinks} from '~/lib/shopify/content-pages-data';
import {publicSignupConfig} from '~/lib/signup/config';
import {loadMainNav} from '~/lib/shopify/menu-data';
import {
  chooseSupportPhone,
  loadSiteSettings,
} from '~/lib/shopify/site-settings';

export type RootLoader = typeof loader;

// Default title; each route's own `meta` replaces it and should call formatPageTitle('Page name').
export const meta: Route.MetaFunction = () => [{title: formatPageTitle()}];

/**
 * This is important to avoid re-fetching root queries on sub-navigations
 */
export const shouldRevalidate: ShouldRevalidateFunction = ({
  formMethod,
  formAction,
  currentUrl,
  nextUrl,
}) => {
  // The signup post (P7-02, SU-L4) changes nothing the loaders read: its action answer is enough.
  if (formAction?.split('?')[0] === '/signup') return false;

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
    // The one self-hosted variable font (CR-31). `crossOrigin` is required for font preloads even on the same origin,
    // otherwise the browser fetches the file twice.
    {
      rel: 'preload',
      href: '/fonts/PlusJakartaSans-Variable.woff2',
      as: 'font',
      type: 'font/woff2',
      crossOrigin: 'anonymous',
    },
    {
      rel: 'preconnect',
      href: 'https://cdn.shopify.com',
    },
    {
      rel: 'preconnect',
      href: 'https://shop.app',
    },
    ...BRAND_HEAD_LINKS,
  ];
}

/**
 * The root loader's output depends on cookies (the cart, the signed-in state, the chosen store and the saved
 * delivery ZIP), so no shared cache may keep or reuse a page built from it: `private` plus `Vary: Cookie`.
 * `no-cache` instead of `no-store` keeps that safety (the browser must revalidate before reuse) while still
 * allowing the back/forward cache, so Back restores the page instantly. Responses that set a cookie or are a
 * per-shopper answer (the delivery resource, cart actions, the discount redirect) keep `no-store` in their own
 * `headers`. A route that exports its own `headers` replaces this; none may make its document publicly
 * cacheable while the root loader carries the ZIP.
 */
export function headers() {
  return new Headers(PRIVATE_REVALIDATE_HEADERS);
}

export async function loader(args: Route.LoaderArgs) {
  // Start fetching non-critical data without blocking time to first byte
  const deferredData = loadDeferredData(args);
  const {storefront, env} = args.context;

  // The ZIP cookie read, the site settings, the menu and the footer's page links are independent
  // of each other, so they run together. None of them fails the page: each degrades to "nothing" or to the fixed
  // navigation.
  const [
    delivery,
    siteSettings,
    mainNav,
    footerPages,
    shop,
    collectionHandles,
  ] = await Promise.all([
    loadDeliverySummary(args.request, env),
    loadSiteSettings(storefront),
    loadMainNav(storefront, env),
    loadFooterPageLinks(storefront),
    loadShopIdentity(storefront, env),
    loadCollectionHandles(storefront),
  ]);

  const footerLinks = buildFooterLinks(footerPages);
  const analytics = parseAnalyticsConfig(env);
  // The chat provider (P7-03, REQ-ANL-004): null unless PUBLIC_CHAT_PROVIDER names a runnable provider, and then no chat
  // code, script or "Chat with us" exists. With consent required the chat reads the analytics category, which needs a
  // GA4 id so the banner offers it (docs/integrations/CHAT.md).
  const chat = resolvePublicChatConfig(
    env,
    {
      development: import.meta.env.DEV,
      analyticsCategoryConfigured: analytics.ga4MeasurementId !== null,
    },
    logWarn,
  );

  // The financing message slot (P4-08, REQ-CART-005): null unless PUBLIC_FINANCING_PROVIDER names one of the three
  // providers with what it needs, and then every slot renders nothing. Affirm follows the chat's consent rule.
  const financing = resolvePublicFinancingConfig(
    env,
    {analyticsCategoryConfigured: analytics.ga4MeasurementId !== null},
    logWarn,
  );

  return {
    ...deferredData,
    financing,
    // Extend's logo and terms-link slots (REQ-EXT-004); both null until the client or Extend supplies the https URLs.
    extendBranding: parseExtendBranding(env),
    // The Shopify admin menu (REQ-NAV-002), or null: the layout then shows the fixed navigation. No price, no
    // shopper data: safe for the long catalog cache.
    mainNav,
    // Footer links to the Shopify pages, policies and blog that exist with content (REQ-CNT-001, P6-09): one
    // cached batched read, empty on failure. No price, no shopper data.
    footerLinks,
    // Where the consent banner's privacy link goes: the policy, or a page with that handle, whichever exists (the
    // same rule as the footer); null hides the link instead of linking a 404 (REQ-CNT-001, NFR-011).
    privacyPath:
      footerPages.find((page) => page.id === 'page:privacy-policy')?.to ?? null,
    // The email signup (REQ-ANL-003, P7-02): null unless Klaviyo is configured, and then the page renders no form and
    // requests no signup code. Carries no key and no list id; the privacy link only when that page exists.
    signup: publicSignupConfig(
      env,
      footerLinks.legal.find((link) => link.to.endsWith('/privacy-policy'))
        ?.to ?? null,
      {allowUnapprovedSms: import.meta.env.DEV},
    ),
    // The fixed navigation and the utility links without links to Shopify pages that do not exist (REQ-CNT-001);
    // the fixed navigation is only sent when no admin menu is in use.
    fallbackNav: mainNav
      ? null
      : buildFallbackNav(existingContentPaths(footerPages), collectionHandles),
    utilityLinks: buildUtilityLinks(existingContentPaths(footerPages), {
      chat: chat ?? false,
    }),
    ...delivery,
    // The promotion bar and the phone come from the `site_settings` entry (P3B-13). The phone is shown only when
    // valid: PUBLIC_SUPPORT_PHONE overrides the admin value; development shows a labelled placeholder when
    // neither is set (REQ-CNT-001, B-15). Nothing here is a price, and nothing keys on the shopper.
    promo: siteSettings.promo,
    supportPhone: chooseSupportPhone(
      env.PUBLIC_SUPPORT_PHONE,
      siteSettings,
      import.meta.env.DEV,
    ),
    publicStoreDomain: env.PUBLIC_STORE_DOMAIN,
    // Public identifiers and the consent mode (P7-01). Unset ids mean no provider: nothing loads (REQ-ANL-001/002).
    analytics,
    shop,
  };
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
    .catch((error: unknown) => {
      // Log the failure (class name only), but don't throw so the page can still render.
      logError('root.footer_read_failed', errorFields(error));
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
        {/* Here, not in `meta`: a route's own `meta` replaces the root's, and every page (errors too) needs it. */}
        <meta name="theme-color" content={BRAND_THEME_COLOR} />
        <link rel="stylesheet" href={tailwindCss}></link>
        <Meta />
        {/* React Router 7.18 puts the server's nonce on the stylesheet links. Browsers blank a nonce attribute once parsed, so the
            client must render an empty one to match what hydration reads back; a missing prop or the real value both make React
            warn about the nonce on every page (seen on the real store, 2026-10-26). The stylesheets are same-origin, so the
            enforced policy allows them through 'self' and not through the nonce. */}
        <Links nonce={typeof document === 'undefined' ? nonce : ''} />
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
    <AnalyticsGate
      cart={data.cart}
      shop={data.shop}
      config={data.analytics}
      privacyPath={data.privacyPath}
    >
      <PageLayout
        cart={data.cart}
        isLoggedIn={data.isLoggedIn}
        promo={data.promo}
        mainNav={data.mainNav}
        footerLinks={data.footerLinks}
        fallbackNav={data.fallbackNav}
        utilityLinks={data.utilityLinks}
        supportPhone={data.supportPhone}
        deliveryZipAvailable={data.deliveryZipAvailable}
        signup={data.signup}
      >
        <Outlet />
      </PageLayout>
    </AnalyticsGate>
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
    <AnalyticsGate
      cart={data.cart}
      shop={data.shop}
      config={data.analytics}
      privacyPath={data.privacyPath}
    >
      <PageLayout
        cart={data.cart}
        isLoggedIn={data.isLoggedIn}
        promo={data.promo}
        mainNav={data.mainNav}
        footerLinks={data.footerLinks}
        fallbackNav={data.fallbackNav}
        utilityLinks={data.utilityLinks}
        supportPhone={data.supportPhone}
        deliveryZipAvailable={data.deliveryZipAvailable}
        signup={data.signup}
      >
        {content}
      </PageLayout>
    </AnalyticsGate>
  );
}
