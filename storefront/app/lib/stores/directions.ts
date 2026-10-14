// Address, directions and phone helpers (REQ-LOC-001). The directions link is
// the keyless Google Maps URL form and is also the fallback when the map fails
// to load (Q-010). It never carries the shopper's location or ZIP: Google Maps
// asks for the origin itself.

import type {Store} from '~/lib/stores/types';

type AddressFields = Pick<
  Store,
  'addressLine1' | 'addressLine2' | 'city' | 'state' | 'postalCode'
>;

/** ["123 Main St", "Suite 4", "Springfield, IL 62704"] for a postal-style block. */
export function addressLines(store: AddressFields): readonly string[] {
  return [
    store.addressLine1,
    ...(store.addressLine2 ? [store.addressLine2] : []),
    `${store.city}, ${store.state} ${store.postalCode}`,
  ];
}

export function singleLineAddress(store: AddressFields): string {
  return addressLines(store).join(', ');
}

const MAPS_ORIGIN = 'https://www.google.com/maps';

/**
 * Google Maps directions to the store's address (Maps URLs, no API key).
 * Every dynamic part goes through encodeURIComponent, so an address containing
 * "&", "#" or "?" cannot add parameters or change the host.
 */
export function googleMapsDirectionsUrl(store: AddressFields): string {
  return `${MAPS_ORIGIN}/dir/?api=1&destination=${encodeURIComponent(singleLineAddress(store))}`;
}

/** Google Maps search for the address, for a "view larger map" link. */
export function googleMapsSearchUrl(store: AddressFields): string {
  return `${MAPS_ORIGIN}/search/?api=1&query=${encodeURIComponent(singleLineAddress(store))}`;
}

export type UsPhone = {
  /** "+12125550100", for tel: links and structured data. */
  readonly e164: string;
  /** "(212) 555-0100", for display. */
  readonly display: string;
};

/**
 * Reads a US phone number (NANP) typed any common way: 212-555-0100,
 * (212) 555-0100, +1 212 555 0100. Returns null for anything else, including
 * extensions and letters, so nothing odd ever lands in a tel: link.
 */
export function normalizeUsPhone(raw: unknown): UsPhone | null {
  if (typeof raw !== 'string' || raw.length > 30) return null;
  if (!/^[\d\s().+-]+$/.test(raw)) return null;
  if (raw.includes('+') && !/^\s*\+1(?!\d)/.test(raw)) return null;
  let digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (digits.length !== 10) return null;
  // NANP: area code and exchange cannot start with 0 or 1.
  if (/^[01]/.test(digits) || /^[01]/.test(digits.slice(3))) return null;
  return {
    e164: `+1${digits}`,
    display: `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`,
  };
}

/** tel: link for a stored phone number, or null when it is not a usable US number. */
export function telHref(phone: string | null): string | null {
  const parsed = normalizeUsPhone(phone);
  return parsed ? `tel:${parsed.e164}` : null;
}
