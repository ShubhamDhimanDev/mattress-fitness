// SERVER ONLY. The delivery zone for the ZIP check and the product-page promise. It comes from the same
// non-secret offer configuration the cart gate reads (offers-runtime/config.ts, the OFFER_CONFIG_JSON seam
// until the `delivery_zone` metaobject reader replaces it), so the product page, the cart and the haul-away
// step cannot disagree about who is inside the zone (REQ-DEL-001).
//
// A missing or unreadable configuration means "no zone known": callers then say nothing about delivery
// rather than claiming a yes. The cart gate logs configuration problems by name; this stays quiet so a
// product page view does not repeat the line.

import type {DeliveryZone} from '~/lib/delivery/zone';
import {readOfferConfig} from '~/lib/offers-runtime/config';

export function loadDeliveryZone(env: object): DeliveryZone | null {
  return readOfferConfig(env).config.zone;
}
