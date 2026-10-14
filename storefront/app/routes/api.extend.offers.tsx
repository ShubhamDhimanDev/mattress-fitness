// Server-side Extend offers for the product page and the cart (P5A-04, REQ-EXT-001, REQ-EXT-005, NFR-013, T-13).
// Resource route.
//   GET  /api/extend/offers?variantId=gid://shopify/ProductVariant/1&quantity=1
//   POST /api/extend/offers   {"items": [{"variantId": "gid://shopify/ProductVariant/1", "quantity": 1}]}  (up to 10)
// The browser sends variant ids and quantities only. Prices, categories and plans are read on the server; the Extend
// access token never leaves it. The answer is private and never cached (it follows the shopper's cart contents).
// `{"status": "unavailable"}` means "show no offer": Extend off, slow, down or without a matching price point.
import type {Route} from './+types/api.extend.offers';
import {isSameOriginRequest, noStoreHeaders} from '~/lib/cart/http';
import {
  parseOffersBody,
  parseOffersQuery,
  type ParsedOffersRequest,
} from '~/lib/extend/offers-endpoint';
import {answerOffersFor} from '~/lib/extend/runtime';

function json(body: unknown, status: number, extra?: HeadersInit): Response {
  const headers = noStoreHeaders(extra);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(body), {status, headers});
}

async function respond(
  parsed: ParsedOffersRequest,
  context: Route.LoaderArgs['context'],
): Promise<Response> {
  if (parsed.status === 'invalid') return json({status: 'invalid'}, 400);
  return json(
    await answerOffersFor(parsed.items, {
      env: context.env,
      production: import.meta.env.PROD,
      storefront: context.storefront,
    }),
    200,
  );
}

export function loader({request, context}: Route.LoaderArgs) {
  return respond(parseOffersQuery(new URL(request.url)), context);
}

export async function action({request, context}: Route.ActionArgs) {
  if (request.method !== 'POST') {
    return json({status: 'invalid'}, 405, {Allow: 'GET, POST'});
  }
  // Same-site only: the answer is private, and this keeps other sites from spending our Extend and Shopify quota.
  if (!isSameOriginRequest(request)) return json({status: 'invalid'}, 403);
  return respond(await parseOffersBody(request), context);
}
