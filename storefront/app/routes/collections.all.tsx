import {useLoaderData} from 'react-router';
import type {Route} from './+types/collections.all';
import {ProductListing} from '~/components/collection/ProductListing';
import {formatPageTitle} from '~/components/layout/documentTitle';
import {Breadcrumb} from '~/components/ui/Breadcrumb';
import {SORT_KEYS, parseFilterParams} from '~/lib/filters';
import {loadAllProductsPage} from '~/lib/shopify/collection-data';

export const meta: Route.MetaFunction = () => [
  {title: formatPageTitle('All products')},
];

export async function loader({context, request}: Route.LoaderArgs) {
  const state = parseFilterParams(new URL(request.url).searchParams);
  return loadAllProductsPage(context.storefront, state);
}

export default function AllProducts() {
  const data = useLoaderData<typeof loader>();
  return (
    <div className="py-4">
      <Breadcrumb
        items={[
          {label: 'Home', to: '/'},
          {label: 'Collections', to: '/collections'},
          {label: 'All products'},
        ]}
      />
      <header className="mt-2 rounded-panel bg-paper p-6 md:p-10">
        <h1 className="type-display text-hero md:text-heading">All products</h1>
      </header>
      <ProductListing
        products={data.products}
        pageInfo={data.pageInfo}
        filterGroups={[]}
        showFilters={false}
        sortKeys={SORT_KEYS}
        emptyHeading="There are no products yet"
      />
    </div>
  );
}
