import {useLoaderData, useRouteLoaderData} from 'react-router';
import type {Route} from './+types/_index';
import {HomeSections} from '~/components/home/HomeSections';
import {formatPageTitle} from '~/components/layout/documentTitle';
import type {RootLoader} from '~/root';
import {loadHome} from '~/lib/shopify/home-data';

export const meta: Route.MetaFunction = () => [{title: formatPageTitle()}];

export async function loader({context}: Route.LoaderArgs) {
  return loadHome(context.storefront);
}

/**
 * Home (REQ-HOME-001). The blocks and their order come from the `homepage_section` entries in Shopify admin
 * (P3B-13); catalog blocks fill themselves from catalog data and are left out when it is missing, so a new
 * or half-configured store still gets a working page.
 */
export default function Homepage() {
  const home = useLoaderData<typeof loader>();
  // The signup block's configuration comes from the root loader (one place decides whether Klaviyo is set up, P7-02).
  const root = useRouteLoaderData<RootLoader>('root');
  return <HomeSections home={home} signup={root?.signup ?? null} />;
}
