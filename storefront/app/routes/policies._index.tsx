import {useLoaderData, Link} from 'react-router';
import type {Route} from './+types/policies._index';
import type {PoliciesQuery, PolicyItemFragment} from 'storefrontapi.generated';
import {formatPageTitle} from '~/components/layout/documentTitle';
import {Breadcrumb} from '~/components/ui/Breadcrumb';
import {cardStyles} from '~/components/ui/Card';
import {ChevronRightIcon} from '~/components/ui/Icons';
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
    <div className="mx-auto max-w-prose py-6 md:py-10">
      <Breadcrumb
        items={[{label: 'Home', to: '/'}, {label: 'Policies'}]}
        className="print:hidden"
      />
      <h1 className="type-display mt-4 border-b border-line pb-6 text-4xl md:text-5xl">
        Policies
      </h1>
      <ul className="mt-6 flex flex-col gap-3">
        {policies.map((policy) => (
          <li key={policy.id}>
            <Link
              to={`/policies/${policy.handle}`}
              className={
                cardStyles({interactive: true, padding: 'sm'}) +
                ' flex min-h-14 items-center justify-between gap-3 text-lg font-bold'
              }
            >
              {policy.title}
              <ChevronRightIcon className="text-primary-700" />
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
