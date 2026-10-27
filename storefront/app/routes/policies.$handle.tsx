import {useLoaderData} from 'react-router';
import type {Route} from './+types/policies.$handle';
import {ContentArticle} from '~/components/pages/ContentArticle';
import {formatPageTitle} from '~/components/layout/documentTitle';
import {SITE_NAME} from '~/lib/navigation';
import {
  buildContentDocument,
  displayView,
  headTags,
} from '~/lib/pages/content-pages-view';
import {canonicalUrl} from '~/lib/seo/canonical';
import {resolveSiteOrigin} from '~/lib/site-origin';
import {catalogCache} from '~/lib/shopify/cache';
import {RouteErrorPage} from '~/components/pages/ErrorPageView';

// URL handle to the Shop field it reads. A closed list: the handle never becomes a variable name unchecked.
const POLICY_FIELDS = {
  'privacy-policy': 'privacyPolicy',
  'shipping-policy': 'shippingPolicy',
  'terms-of-service': 'termsOfService',
  'refund-policy': 'refundPolicy',
} as const;

// The loader prepares the head tags and structured data (`buildContentDocument`); this only reads them.
export const meta: Route.MetaFunction = ({data}) => {
  return data?.head ?? [{title: formatPageTitle('Not found')}];
};

export async function loader({params, context, request}: Route.LoaderArgs) {
  const policyName =
    Object.entries(POLICY_FIELDS).find(
      ([handle]) => handle === params.handle,
    )?.[1] ?? null;
  if (!policyName) {
    throw new Response('Could not find the policy', {status: 404});
  }

  // Policy text holds no price or availability, so it is cached long (DEC-024).
  const data = await context.storefront.query(POLICY_CONTENT_QUERY, {
    cache: catalogCache(context.storefront),
    variables: {
      privacyPolicy: false,
      shippingPolicy: false,
      termsOfService: false,
      refundPolicy: false,
      [policyName]: true,
      language: context.storefront.i18n?.language,
    },
  });

  const policy = data.shop?.[policyName];

  if (!policy) {
    throw new Response('Could not find the policy', {status: 404});
  }

  // The path comes from the closed list above, never from what the caller typed.
  const path = `/policies/${params.handle}`;
  const origin = resolveSiteOrigin({
    env: context.env,
    requestUrl: request.url,
    isDev: import.meta.env.DEV,
  });
  const view = buildContentDocument({
    title: policy.title,
    body: policy.body,
    parents: [{name: 'Policies', path: '/policies'}],
    path,
    origin,
    canonical: canonicalUrl(origin, path),
    siteName: SITE_NAME,
  });

  return {
    policy: {body: policy.body},
    view: displayView(view),
    head: headTags(formatPageTitle(view.seoTitle), view),
  };
}

export default function Policy() {
  const {policy, view} = useLoaderData<typeof loader>();

  return <ContentArticle {...view} body={policy.body} />;
}

// NOTE: https://shopify.dev/docs/api/storefront/latest/objects/Shop
const POLICY_CONTENT_QUERY = `#graphql
  fragment Policy on ShopPolicy {
    body
    handle
    id
    title
    url
  }
  query Policy(
    $country: CountryCode
    $language: LanguageCode
    $privacyPolicy: Boolean!
    $refundPolicy: Boolean!
    $shippingPolicy: Boolean!
    $termsOfService: Boolean!
  ) @inContext(language: $language, country: $country) {
    shop {
      privacyPolicy @include(if: $privacyPolicy) {
        ...Policy
      }
      shippingPolicy @include(if: $shippingPolicy) {
        ...Policy
      }
      termsOfService @include(if: $termsOfService) {
        ...Policy
      }
      refundPolicy @include(if: $refundPolicy) {
        ...Policy
      }
    }
  }
` as const;

/** A missing or failed page keeps the site header and footer (the 404 status is set by the loader). */
export function ErrorBoundary() {
  return <RouteErrorPage />;
}
