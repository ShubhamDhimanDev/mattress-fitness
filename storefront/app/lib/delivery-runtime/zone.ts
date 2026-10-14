// SERVER ONLY. The delivery zone for the ZIP check and the product-page promise. It comes from the same
// non-secret offer configuration the cart gate reads (offers-runtime/config.ts, the OFFER_CONFIG_JSON seam
// until the `delivery_zone` metaobject reader replaces it), so the product page, the cart and the haul-away
// step cannot disagree about who is inside the zone (REQ-DEL-001).
//
// Same switch as the gate: with OFFERS_ENABLED=false the gate runs on the empty configuration (no zone), so
// this claims nothing either. A missing or unreadable configuration also means "no zone known": callers say
// nothing about delivery rather than claiming a yes. The gate logs configuration problems by name; this
// stays quiet so a product page view does not repeat the line.

import type {DeliveryZone} from '~/lib/delivery/zone';
import {readOfferConfig} from '~/lib/offers-runtime/config';

export function loadDeliveryZone(env: object): DeliveryZone | null {
  if (Reflect.get(env, 'OFFERS_ENABLED') === 'false') return null;
  return readOfferConfig(env).config.zone;
}

/** The haul-away service variant from the same configuration, or null when the offer is off. */
export function loadHaulAwayVariantId(env: object): string | null {
  if (Reflect.get(env, 'OFFERS_ENABLED') === 'false') return null;
  return readOfferConfig(env).config.rules.haulAway?.variantId ?? null;
}
