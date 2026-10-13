import {Link, useLoaderData} from 'react-router';
import type {Route} from './+types/policies.$handle';
import {SafeHtml} from '~/components/SafeHtml';
import {formatPageTitle} from '~/components/layout/documentTitle';

// URL handle to the Shop field it reads. A closed list: the handle never becomes a variable name unchecked.
const POLICY_FIELDS = {
  'privacy-policy': 'privacyPolicy',
  'shipping-policy': 'shippingPolicy',
  'terms-of-service': 'termsOfService',
  'refund-policy': 'refundPolicy',
} as const;

export const meta: Route.MetaFunction = ({data}) => {
  return [{title: formatPageTitle(data?.policy.title)}];
};

export async function loader({params, context}: Route.LoaderArgs) {
  const policyName =
    Object.entries(POLICY_FIELDS).find(
      ([handle]) => handle === params.handle,
    )?.[1] ?? null;
  if (!policyName) {
    throw new Response('Could not find the policy', {status: 404});
  }

  const data = await context.storefront.query(POLICY_CONTENT_QUERY, {
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

  return {policy};
}

export default function Policy() {
  const {policy} = useLoaderData<typeof loader>();

  return (
    <div className="py-6">
      <Link
        to="/policies"
        className="inline-flex min-h-touch items-center text-primary-700 underline underline-offset-2"
      >
        Back to policies
      </Link>
      <h1 className="mt-2 text-3xl font-bold">{policy.title}</h1>
      <SafeHtml html={policy.body} />
    </div>
  );
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
