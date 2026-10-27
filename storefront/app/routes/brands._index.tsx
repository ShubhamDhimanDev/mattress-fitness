import {Image} from '~/lib/hydrogen/image';
import {Link, useLoaderData} from 'react-router';
import type {Route} from './+types/brands._index';
import {formatPageTitle} from '~/components/layout/documentTitle';
import {Breadcrumb} from '~/components/ui/Breadcrumb';
import {cardStyles} from '~/components/ui/Card';
import {cn} from '~/components/ui/cn';
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
  const {brands} = useLoaderData<typeof loader>();

  return (
    <div className="py-4">
      <Breadcrumb items={[{label: 'Home', to: '/'}, {label: 'Brands'}]} />
      <h1 className="mt-2 type-display text-4xl md:text-5xl">Brands</h1>

      {brands.length === 0 ? (
        <p className="mt-6 text-base text-fg-muted">
          Brands are not available right now. Please try again in a moment.
        </p>
      ) : (
        // A brand is shown by its name as text; a logo appears only when its entry in admin has one (permission pending, D4).
        <ul
          aria-label="Brands"
          className="mt-6 grid grid-cols-2 gap-3 md:mt-8 md:grid-cols-4 md:gap-4 lg:grid-cols-6"
        >
          {brands.map((brand) => (
            <li key={brand.handle}>
              <Link
                to={brand.to}
                prefetch="intent"
                className={cn(
                  cardStyles({interactive: true, padding: 'none'}),
                  'flex h-full min-h-19 flex-col items-center justify-center gap-2 p-4 text-center text-base font-extrabold break-words md:min-h-33 md:text-lg',
                )}
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
