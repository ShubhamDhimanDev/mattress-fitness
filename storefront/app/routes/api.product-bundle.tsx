// The "Frequently bought together" set for the product page (P4-06, REQ-ADD-002). Resource route.
//   GET /api/product-bundle?productId=gid://shopify/Product/1
// The browser names a product and nothing else. The bundle rules are admin-configured and the prices and availability are
// Shopify's, read on the server; the answer holds every size so the page swaps the set without another request.
// `{"status": "ok", "bundle": null}` means "show nothing". Adding the set is a separate, revalidated cart action
// (`CustomAddProductBundle` on /cart): this route only lists.
import type {Route} from './+types/api.product-bundle';
import {isSameSiteFetch} from '~/lib/extend/offers-endpoint';
import {noStoreHeaders} from '~/lib/cart/http';
import {isProductGid} from '~/lib/offers-runtime/product-addons';
import {loadProductBundle} from '~/lib/offers-runtime/product-bundle-server';

function json(body: unknown, status: number, cacheControl?: string): Response {
  const headers = noStoreHeaders();
  if (cacheControl) headers.set('Cache-Control', cacheControl);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(body), {status, headers});
}

export async function loader({request, context}: Route.LoaderArgs) {
  // A browser that says the request is cross-site is refused; no header means curl or an old client and passes.
  if (!isSameSiteFetch(request.headers)) return json({status: 'invalid'}, 403);
  const productId = new URL(request.url).searchParams.get('productId');
  if (!isProductGid(productId)) return json({status: 'invalid'}, 400);
  const answer = await loadProductBundle(
    context.storefront,
    context.env,
    productId,
  );
  // A failed Shopify read is an error the card can retry, never an empty answer that a cache would keep for a minute.
  if (answer.status === 'unavailable') return json(answer, 502);
  // The same for every shopper (rules plus Shopify's price and stock), so a short private browser cache is safe; the
  // 60 s matches the priced window of the catalog cards (DEC-024). Never shared: nothing here needs a CDN.
  return json(answer, 200, 'private, max-age=60');
}
