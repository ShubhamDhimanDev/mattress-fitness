// SERVER ONLY. The delivery zone for the ZIP check and the product-page promise. It comes from the same offer
// configuration the cart gate reads (offers-runtime/shopify-rules.ts: the `delivery_zone` metaobject, ADR-0013), so the
// product page, the cart and the haul-away step cannot disagree about who is inside the zone (REQ-DEL-001).
//
// A missing or unreadable configuration means "no zone known": callers say nothing about delivery rather than claiming
// a yes. The gate logs configuration problems by name; this stays quiet so a product page view does not repeat the line.

import type {DeliveryZone} from '~/lib/delivery/zone';
import {loadOfferConfig} from '~/lib/offers-runtime/shopify-rules';

export async function loadDeliveryZone(
  env: object,
): Promise<DeliveryZone | null> {
  return (await loadOfferConfig(env)).config.zone;
}

/** The haul-away service variant from the same configuration, or null when the offer is off. */
export async function loadHaulAwayVariantId(
  env: object,
): Promise<string | null> {
  return (await loadOfferConfig(env)).config.rules.haulAway?.variantId ?? null;
}
