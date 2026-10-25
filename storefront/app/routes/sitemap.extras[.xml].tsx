import type {Route} from './+types/sitemap.extras[.xml]';
import {loadStoreIndex} from '~/lib/pages/stores-data';
import {
  allStores,
  cityPath,
  statePath,
  storePath,
  storesIndexPath,
} from '~/lib/stores/grouping';
import {brandPath, loadBrandsIndex} from '~/lib/shopify/brand-data';
import {loadPolicyPaths} from '~/lib/shopify/shop-policies';
import {
  bareUrlRedirect,
  extraSitemapEntries,
  renderUrlset,
} from '~/lib/seo/sitemap';
import {
  sitemapOriginFor,
  sitemapResponse,
  sitemapUnavailable,
} from '~/lib/seo/sitemap-route';

// The pages Shopify's sitemap does not know: home, collection index, brands, stores and shop policies (P7-04). Brands and
// stores are listed only when they come from real data; sample brands and fixture stores are noindex pages.
export async function loader({
  request,
  context: {storefront, env},
}: Route.LoaderArgs) {
  const bare = bareUrlRedirect(request);
  if (bare) return bare;
  const origin = sitemapOriginFor(env, request);
  if (origin === null) return sitemapUnavailable();

  const [brands, storeIndex, policyPaths] = await Promise.all([
    // No `allowFixtures`: an empty or failed read lists no brands.
    loadBrandsIndex(storefront),
    loadStoreIndex(storefront),
    // Only policies the shop has written: Shopify's sitemap omits them and an unwritten one is a 404.
    loadPolicyPaths(storefront),
  ]);
  const stores =
    storeIndex.source === 'shopify' ? allStores(storeIndex.index) : [];
  const storePaths = stores.flatMap((store) => [
    statePath(store.state),
    cityPath(store.state, store.city),
    storePath(store),
  ]);
  const entries = extraSitemapEntries({
    origin,
    brandPaths:
      brands.source === 'shopify'
        ? brands.brands.map((brand) => brandPath(brand.handle))
        : [],
    storePaths: storePaths.length > 0 ? [storesIndexPath(), ...storePaths] : [],
    policyPaths,
  });
  return sitemapResponse(
    new Response(renderUrlset(entries), {
      headers: {'Content-Type': 'application/xml'},
    }),
    request,
  );
}
