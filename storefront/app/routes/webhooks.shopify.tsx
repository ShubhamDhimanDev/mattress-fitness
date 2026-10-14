// Shopify webhook receiver for the Extend order sync (P5A-08, REQ-EXT-003, T-03). Resource route: POST only.
// Subscribe orders/paid, orders/updated, orders/cancelled, refunds/create and fulfillments/create to
// https://<storefront host>/webhooks/shopify (docs/integrations/EXTEND.md). All logic is in app/lib/extend/webhook-handler.ts.
import type {Route} from './+types/webhooks.shopify';
import {respondToShopifyWebhook} from '~/lib/extend/runtime';

export function loader() {
  return new Response(null, {
    status: 405,
    headers: {Allow: 'POST', 'Cache-Control': 'no-store'},
  });
}

export function action({request, context}: Route.ActionArgs) {
  return respondToShopifyWebhook(request, {
    env: context.env,
    production: import.meta.env.PROD,
    waitUntil: context.waitUntil,
  });
}
