// Size-matched add-ons for the product page (P4-03, REQ-ADD-001). Resource route.
//   GET /api/product-addons?productId=gid://shopify/Product/1
// The browser names a product and nothing else. The relations are the admin-configured offer rules and the prices and
// availability are Shopify's, read on the server; the answer holds every size so the page swaps variants without another
// request. `{"status": "ok", "items": []}` means "show nothing". Adding an item is a separate, revalidated cart action
// (`CustomAddAddOn` on /cart): this route only lists.
import type {Route} from './+types/api.product-addons';
import {isSameSiteFetch} from '~/lib/extend/offers-endpoint';
import {noStoreHeaders} from '~/lib/cart/http';
import {isProductGid} from '~/lib/offers-runtime/product-addons';
import {loadProductAddOns} from '~/lib/offers-runtime/product-addons-server';

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
  const answer = await loadProductAddOns(
    context.storefront,
    context.env,
    productId,
  );
  // A failed Shopify read is an error the slot can retry, never an empty list that a cache would keep for a minute.
  if (answer.status === 'unavailable') return json(answer, 502);
  // The same for every shopper (rules plus Shopify's price and stock), so a short private browser cache is safe; the
  // 60 s matches the priced window of the catalog cards (DEC-024). Never shared: nothing here needs a CDN.
  return json(answer, 200, 'private, max-age=60');
}
