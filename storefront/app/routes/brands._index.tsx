import {Image} from '@shopify/hydrogen';
import {Link, useLoaderData} from 'react-router';
import type {Route} from './+types/brands._index';
import {formatPageTitle} from '~/components/layout/documentTitle';
import {PreviewNotice} from '~/components/pages/PreviewNotice';
import {Breadcrumb} from '~/components/ui/Breadcrumb';
import {previewRobotsMeta} from '~/lib/pages/head';
import {loadBrandsIndex} from '~/lib/shopify/brand-data';

// Brand index (REQ-COL-005, P3B-06): every `brand` metaobject, linking to its page.

export const meta: Route.MetaFunction = ({data}) => [
  ...previewRobotsMeta(data?.source),
  {title: formatPageTitle('Brands')},
];

export async function loader({context}: Route.LoaderArgs) {
  // Sample brands are a development aid; production never shows them.
  return loadBrandsIndex(context.storefront, {
    allowFixtures: !import.meta.env.PROD,
  });
}

export default function BrandsIndex() {
  const {source, brands} = useLoaderData<typeof loader>();

  return (
    <div className="py-4">
      <Breadcrumb items={[{label: 'Home', to: '/'}, {label: 'Brands'}]} />
      <h1 className="mt-2 text-3xl font-bold">Brands</h1>

      {source === 'fixtures' ? (
        <div className="mt-4">
          <PreviewNotice subject="brands" />
        </div>
      ) : null}

      {brands.length === 0 ? (
        <p className="mt-6 text-base text-fg-muted">
          Brands are not available right now. Please try again in a moment.
        </p>
      ) : (
        <ul
          aria-label="Brands"
          className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4"
        >
          {brands.map((brand) => (
            <li key={brand.handle}>
              <Link
                to={brand.to}
                prefetch="intent"
                className="flex min-h-touch flex-col items-center justify-center gap-2 rounded-card border-2 border-line p-4 text-center font-bold hover:border-ink-900"
              >
                {brand.logo ? (
                  <Image
                    data={brand.logo}
                    alt=""
                    sizes="160px"
                    className="h-auto max-h-16 w-auto max-w-full object-contain"
                  />
                ) : null}
                {brand.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
