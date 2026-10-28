// Columns of the store sheet = the keys of the `store` metaobject (scripts/shopify/definitions.json), minus `photo`
// (a file reference cannot come from a spreadsheet cell; the photo is attached in Shopify admin, ADMIN_GUIDE 5.1).
// The entry's HANDLE is the `slug`: the seed script does the same, and the slug is what the store page URL uses.

/** @typedef {{ key: string, required: boolean, hint: string }} Column */

/** @type {readonly Column[]} */
export const COLUMNS = Object.freeze([
  { key: 'slug', required: true, hint: 'lowercase letters, digits and single hyphens; also the entry handle, so never change it once imported' },
  { key: 'name', required: true, hint: 'store name shown to shoppers' },
  { key: 'address_line_1', required: true, hint: 'street address' },
  { key: 'address_line_2', required: false, hint: 'suite or unit' },
  { key: 'city', required: true, hint: '' },
  { key: 'state', required: true, hint: 'US state or DC: two-letter code or full name' },
  { key: 'postal_code', required: true, hint: '5-digit ZIP code (format the column as text so a leading 0 survives)' },
  { key: 'latitude', required: false, hint: 'decimal degrees, give both latitude and longitude or neither' },
  { key: 'longitude', required: false, hint: 'decimal degrees' },
  { key: 'phone', required: false, hint: 'US number, for example (212) 555-0100' },
  { key: 'hours', required: false, hint: 'weekly hours, for example: Mon-Fri 10:00 AM - 9:00 PM; Sat 10am-6pm; Sun Closed' },
  { key: 'time_zone', required: false, hint: 'IANA name such as America/Chicago; without it the site does not show Open now' },
  { key: 'pickup_enabled', required: false, hint: 'true or false' },
  { key: 'location_handle', required: false, hint: 'matching Shopify location, written like buffalo-gallery, or its numeric id' },
]);

export const COLUMN_KEYS = Object.freeze(COLUMNS.map((column) => column.key));

export const LIMITS = Object.freeze({
  maxFileBytes: 1_000_000,
  maxStores: 250,
  name: 120,
  address: 120,
  city: 80,
  slug: 80,
  hours: 4000,
});

/** The metaobject type the importer writes to. */
export const STORE_TYPE = 'store';
