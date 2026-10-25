import {useLoaderData, Link} from 'react-router';
import type {Route} from './+types/policies._index';
import type {PoliciesQuery, PolicyItemFragment} from 'storefrontapi.generated';
import {formatPageTitle} from '~/components/layout/documentTitle';
import {Breadcrumb} from '~/components/ui/Breadcrumb';
import {catalogCache} from '~/lib/shopify/cache';

export const meta: Route.MetaFunction = () => [
  {title: formatPageTitle('Policies')},
];

export async function loader({context}: Route.LoaderArgs) {
  // Policy titles hold no price or availability, so the read is cached long (DEC-024).
  const data: PoliciesQuery = await context.storefront.query(POLICIES_QUERY, {
    cache: catalogCache(context.storefront),
  });

  const shopPolicies = data.shop;
  const policies: PolicyItemFragment[] = [
    shopPolicies?.privacyPolicy,
    shopPolicies?.shippingPolicy,
    shopPolicies?.termsOfService,
    shopPolicies?.refundPolicy,
  ].filter((policy): policy is PolicyItemFragment => policy != null);

  if (!policies.length) {
    throw new Response('No policies found', {status: 404});
  }

  return {policies};
}

export default function Policies() {
  const {policies} = useLoaderData<typeof loader>();

  return (
    <div className="py-4">
      <Breadcrumb
        items={[{label: 'Home', to: '/'}, {label: 'Policies'}]}
        className="print:hidden"
      />
      <h1 className="mt-2 border-b border-line pb-4 text-3xl font-bold">
        Policies
      </h1>
      <ul className="mt-4">
        {policies.map((policy) => (
          <li key={policy.id}>
            <Link
              to={`/policies/${policy.handle}`}
              className="inline-flex min-h-touch items-center text-base text-primary-700 underline underline-offset-2 hover:text-primary-800"
            >
              {policy.title}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

const POLICIES_QUERY = `#graphql
  fragment PolicyItem on ShopPolicy {
    id
    title
    handle
  }
  query Policies ($country: CountryCode, $language: LanguageCode)
    @inContext(country: $country, language: $language) {
    shop {
      privacyPolicy {
        ...PolicyItem
      }
      shippingPolicy {
        ...PolicyItem
      }
      termsOfService {
        ...PolicyItem
      }
      refundPolicy {
        ...PolicyItem
      }
    }
  }
` as const;
