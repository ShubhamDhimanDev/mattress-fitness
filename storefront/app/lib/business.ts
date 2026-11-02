// The client's one store: address, phone and map position, as the owner supplied them (2026-11-02). Pure data, no
// framework imports. The storefront shows them in the footer; the phone is also the fallback support number when
// neither `PUBLIC_SUPPORT_PHONE` nor the admin `site_settings` value is set (lib/shopify/site-settings.ts).

import type {SupportPhone} from '~/lib/navigation';

export const BUSINESS_ADDRESS = {
  lines: ['24324 Northwest Freeway, Suite 200', 'Cypress, TX 77429'],
} as const;

export const BUSINESS_PHONE: SupportPhone = {
  display: '(281) 758-5279',
  href: 'tel:+12817585279',
};

/** Where the store is on the map (WGS 84). */
export const BUSINESS_POSITION = {
  lat: 29.95610189349137,
  lng: -95.67583049999999,
} as const;

/** Half the width of the map window in degrees: about 0.7 km, enough to show the street and the nearest junction. */
const MAP_SPAN = 0.006;

/**
 * The OpenStreetMap embed for the store, with a pin. OpenStreetMap needs no key or account and sets no cookie; it is
 * the only third-party frame the site allows (`MAP_FRAME_ORIGIN` in lib/security-headers.ts).
 */
export function mapEmbedUrl(position = BUSINESS_POSITION): string {
  const {lat, lng} = position;
  const bbox = [lng - MAP_SPAN, lat - MAP_SPAN, lng + MAP_SPAN, lat + MAP_SPAN]
    .map((value) => value.toFixed(5))
    .join(',');
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat.toFixed(6)},${lng.toFixed(6)}`;
}

/** Opens the phone's maps app or Google Maps with the route to the store. */
export function directionsUrl(position = BUSINESS_POSITION): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${position.lat.toFixed(6)},${position.lng.toFixed(6)}`;
}
