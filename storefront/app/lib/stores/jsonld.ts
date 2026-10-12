// schema.org LocalBusiness structured data for a store page (REQ-LOC-001).
// Built from the same Store object the page renders, so it cannot drift from
// the visible hours, address and phone.

import {googleMapsSearchUrl, normalizeUsPhone} from '~/lib/stores/directions';
import {storePath} from '~/lib/stores/grouping';
import {DAY_NAMES, DISPLAY_ORDER} from '~/lib/stores/hours';
import type {Store} from '~/lib/stores/types';

export type OpeningHoursSpecification = {
  readonly '@type': 'OpeningHoursSpecification';
  readonly dayOfWeek: readonly string[];
  readonly opens: string;
  readonly closes: string;
};

export type LocalBusinessJsonLd = {
  readonly '@context': 'https://schema.org';
  readonly '@type': 'LocalBusiness';
  readonly '@id'?: string;
  readonly name: string;
  readonly url?: string;
  readonly image?: string;
  readonly telephone?: string;
  readonly hasMap: string;
  readonly address: {
    readonly '@type': 'PostalAddress';
    readonly streetAddress: string;
    readonly addressLocality: string;
    readonly addressRegion: string;
    readonly postalCode: string;
    readonly addressCountry: 'US';
  };
  readonly geo?: {
    readonly '@type': 'GeoCoordinates';
    readonly latitude: number;
    readonly longitude: number;
  };
  readonly openingHoursSpecification?: readonly OpeningHoursSpecification[];
};

/** "HH:MM"; 24:00 becomes 23:59 because schema.org times stay within one day. */
function clockText(minutes: number): string {
  if (minutes >= 1440 && minutes % 1440 === 0) return '23:59';
  const within = minutes % 1440;
  const hh = String(Math.floor(within / 60)).padStart(2, '0');
  const mm = String(within % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

function openingHours(store: Store): readonly OpeningHoursSpecification[] {
  const hours = store.hours;
  if (!hours) return [];
  // Days with identical hours share one entry. Closed days are left out, which
  // is how structured data says "closed".
  const groups = new Map<
    string,
    {days: string[]; opens: string; closes: string}
  >();
  for (const dayIndex of DISPLAY_ORDER) {
    for (const interval of hours[dayIndex]) {
      const opens = clockText(interval.openMinutes);
      const closes = clockText(interval.closeMinutes);
      const key = `${opens}-${closes}`;
      const group = groups.get(key) ?? {days: [], opens, closes};
      group.days.push(DAY_NAMES[dayIndex]);
      groups.set(key, group);
    }
  }
  return [...groups.values()].map((group) => ({
    '@type': 'OpeningHoursSpecification',
    dayOfWeek: group.days,
    opens: group.opens,
    closes: group.closes,
  }));
}

function httpsUrl(raw: string | null): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/**
 * `siteOrigin` is the canonical origin of the storefront, for example
 * "https://www.example.com". Without a valid one the url fields are left out.
 */
export function buildStoreJsonLd(
  store: Store,
  options: {readonly siteOrigin?: string | null} = {},
): LocalBusinessJsonLd {
  const origin = (() => {
    const parsed = httpsUrl(options.siteOrigin ?? null);
    return parsed ? new URL(parsed).origin : undefined;
  })();
  const url = origin ? `${origin}${storePath(store)}` : undefined;
  const phone = normalizeUsPhone(store.phone);
  const image = httpsUrl(store.photoUrl);
  const hours = openingHours(store);

  return {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    ...(url && {'@id': url, url}),
    name: store.name,
    ...(image && {image}),
    ...(phone && {telephone: phone.e164}),
    hasMap: googleMapsSearchUrl(store),
    address: {
      '@type': 'PostalAddress',
      streetAddress: store.addressLine2
        ? `${store.addressLine1}, ${store.addressLine2}`
        : store.addressLine1,
      addressLocality: store.city,
      addressRegion: store.state,
      postalCode: store.postalCode,
      addressCountry: 'US',
    },
    ...(store.latitude !== null &&
      store.longitude !== null && {
        geo: {
          '@type': 'GeoCoordinates',
          latitude: store.latitude,
          longitude: store.longitude,
        },
      }),
    ...(hours.length > 0 && {openingHoursSpecification: hours}),
  };
}

// U+2028 and U+2029 end a line in JavaScript source; built from code points so
// this file never contains the raw characters.
const LINE_SEPARATOR = new RegExp(String.fromCharCode(0x2028), 'g');
const PARAGRAPH_SEPARATOR = new RegExp(String.fromCharCode(0x2029), 'g');

/**
 * JSON text that is safe inside <script type="application/ld+json">. Store names
 * and addresses are client-entered, so "</script>" must not be able to end the
 * block: the characters that matter are written as unicode escapes.
 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(LINE_SEPARATOR, '\\u2028')
    .replace(PARAGRAPH_SEPARATOR, '\\u2029');
}
