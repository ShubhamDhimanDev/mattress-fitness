// Store pickup for the product page (P3B-10, REQ-PDP-003). Resource route.
//   GET /api/pickup-availability?variantId=gid://shopify/ProductVariant/1&store=new-york.buffalo.buffalo-gallery
// The browser names a variant and a store key and nothing else. Both are validated here: the key must resolve in our own
// store list (so a tampered key selects nothing), the variant must be a variant id. Stock is Shopify's, read on the
// server for the store's mapped location; the answer is one of four states and never a count. A failed read is a 502
// the slot hides on (fail soft); it is never cached as an empty answer.
import type {Route} from './+types/api.pickup-availability';
import {isSameSiteFetch} from '~/lib/extend/offers-endpoint';
import {noStoreHeaders} from '~/lib/cart/http';
import {errorFields, logError} from '~/lib/logging/logger';
import {resolveMyStore} from '~/lib/pages/my-store';
import {loadStoreIndex} from '~/lib/pages/stores-data';
import {loadPickupLocations} from '~/lib/shopify/pickup-data';
import {isVariantGid, pickupAnswerFor} from '~/lib/stores/pickup';

function json(body: unknown, status: number, cacheControl?: string): Response {
  const headers = noStoreHeaders();
  if (cacheControl) headers.set('Cache-Control', cacheControl);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(body), {status, headers});
}

export async function loader({request, context}: Route.LoaderArgs) {
  if (!isSameSiteFetch(request.headers)) return json({status: 'invalid'}, 403);
  const params = new URL(request.url).searchParams;
  const variantId = params.get('variantId');
  if (!isVariantGid(variantId)) return json({status: 'invalid'}, 400);

  try {
    const {index} = await loadStoreIndex(context.storefront);
    const store = resolveMyStore(index, params.get('store'));
    // No store (or a key that is not in the list): nothing to look up, nothing to cache for long.
    if (!store)
      return json({status: 'choose_store'}, 200, 'private, max-age=60');
    // A store without pickup or a mapped location needs no stock read at all.
    if (!store.pickupEnabled || store.locationHandle === null) {
      return json(pickupAnswerFor(store, []), 200, 'private, max-age=60');
    }
    const read = await loadPickupLocations(context.storefront, variantId);
    const answer = pickupAnswerFor(
      store,
      read.status === 'ok' ? read.locations : [],
    );
    // Same window as the price and stock on the page (DEC-024); private because it is per store choice.
    return json(answer, 200, 'private, max-age=60');
  } catch (error: unknown) {
    // Class name only (T-05); the slot shows nothing about pickup rather than a wrong answer.
    logError('pickup.availability_read_failed', errorFields(error));
    return json({status: 'unavailable_read'}, 502);
  }
}
