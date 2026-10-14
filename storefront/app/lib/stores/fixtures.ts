// SYNTHETIC stores for tests and demos. Names, streets and people are invented;
// phone numbers use the 555-01xx range reserved for fiction. The records are in
// the loose shape the `store` metaobject returns and are parsed by the same code
// as real data, so they also prove the parser accepts what admin will hold.
// Removed from runtime paths once the Storefront API store query lands (P3A-07).

import {parseStoreRecords} from '~/lib/stores/parse';
import type {Store} from '~/lib/stores/types';

const WEEKDAY_TEXT = 'Mon-Fri 10:00 AM - 9:00 PM; Sat 10am-6pm; Sun Closed';

export const FIXTURE_STORE_RECORDS: readonly Record<string, unknown>[] = [
  {
    id: 'fixture-store-buffalo',
    name: 'Wrenfield Sleep Gallery Buffalo',
    slug: 'buffalo-gallery',
    address_line1: '100 Example Street',
    city: 'Buffalo',
    state: 'NY',
    postal_code: '14201',
    phone: '716-555-0101',
    hours: WEEKDAY_TEXT,
    time_zone: 'America/New_York',
    latitude: 42.8864,
    longitude: -78.8784,
    pickup_enabled: true,
    location_handle: 'buffalo-gallery',
  },
  {
    id: 'fixture-store-rochester',
    name: 'Wrenfield Sleep Studio Rochester',
    slug: 'rochester-studio',
    address_line1: '25 Sample Avenue',
    address_line2: 'Suite 4',
    city: 'Rochester',
    state: 'New York',
    postal_code: '14604',
    phone: '(585) 555-0102',
    hours: {'Mon-Fri': '10:00-20:00', Sat: '10am-6pm', Sun: '12pm-5pm'},
    time_zone: 'America/New_York',
    latitude: '43.1566',
    longitude: '-77.6088',
    pickup_enabled: true,
    location_handle: 'rochester-studio',
  },
  {
    id: 'fixture-store-austin-central',
    name: 'Larkmoor Sleep Austin Central',
    slug: 'austin-central',
    address_line1: '300 Placeholder Boulevard',
    city: 'Austin',
    state: 'TX',
    postal_code: '78701',
    phone: '+1 512 555 0103',
    hours: [
      {day: 'Mon-Sat', open: '10:00 AM', close: '8:00 PM'},
      {day: 'Sun', open: '12:00', close: '18:00'},
    ],
    time_zone: 'America/Chicago',
    latitude: 30.2672,
    longitude: -97.7431,
    pickup_enabled: true,
    location_handle: 'austin-central',
  },
  {
    id: 'fixture-store-austin-north',
    name: 'Larkmoor Sleep Austin North',
    slug: 'austin-north',
    address_line1: '9500 Demo Parkway',
    city: 'Austin',
    state: 'TX',
    postal_code: '78758',
    phone: '512-555-0104',
    hours: WEEKDAY_TEXT,
    time_zone: 'America/Chicago',
    latitude: 30.3875,
    longitude: -97.7062,
    pickup_enabled: false,
  },
  {
    id: 'fixture-store-chicago',
    name: 'Tidewell Sleep Chicago Loop',
    slug: 'chicago-loop',
    address_line1: '1 Test Plaza',
    city: 'Chicago',
    state: 'IL',
    postal_code: '60601',
    phone: '312-555-0105',
    hours: 'Mon-Thu 10am-9pm\nFri-Sat 10am-10pm\nSun 11am-6pm',
    time_zone: 'America/Chicago',
    latitude: 41.8864,
    longitude: -87.6186,
    pickup_enabled: true,
    location_handle: 'chicago-loop',
  },
  {
    // Sparse on purpose: no phone, hours or coordinates, as a half-filled admin entry.
    id: 'fixture-store-portland',
    name: 'Ashvale Home Sleep Portland',
    slug: 'portland-pearl',
    address_line1: '77 Mock Way',
    city: 'Portland',
    state: 'OR',
    postal_code: '97209',
    pickup_enabled: false,
  },
];

const parsed = parseStoreRecords(FIXTURE_STORE_RECORDS);

export const FIXTURE_STORES: readonly Store[] = parsed.stores;

/** Warnings from parsing the fixtures; a test asserts there are none. */
export const FIXTURE_STORE_WARNINGS: readonly string[] = parsed.warnings;

export function getFixtureStore(id: string): Store {
  const found = FIXTURE_STORES.find((store) => store.id === id);
  if (!found) throw new Error(`Unknown fixture store: ${id}`);
  return found;
}
