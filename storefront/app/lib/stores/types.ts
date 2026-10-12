// Store locator model (REQ-LOC-001 to REQ-LOC-003). Stores are managed in
// Shopify admin as `store` metaobjects (SHOPIFY_DATA_MODEL); parse.ts turns a
// loosely typed record into this type. Pure data: no Shopify shapes here.

/** Two-letter codes for the 50 states and the District of Columbia (US only, NFR-008). */
export const US_STATES = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  DC: 'District of Columbia',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
} as const;

export type UsStateCode = keyof typeof US_STATES;

/** 0 is Sunday, matching JavaScript's Date#getDay. */
export type DayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * One opening interval, in minutes after local midnight of the day it starts.
 * `closeMinutes` is above 1440 when the store closes after midnight, for
 * example 6 PM to 2 AM is 1080 to 1560. 1440 means "until midnight".
 */
export type TimeInterval = {
  readonly openMinutes: number;
  readonly closeMinutes: number;
};

/** Sorted, non-overlapping intervals; empty means closed all day. */
export type DayHours = readonly TimeInterval[];

/** Hours for Sunday to Saturday (index = DayIndex). */
export type WeeklyHours = readonly [
  DayHours,
  DayHours,
  DayHours,
  DayHours,
  DayHours,
  DayHours,
  DayHours,
];

export type Store = {
  /** Metaobject ID; stable, used for tie-breaks and de-duplication. */
  readonly id: string;
  readonly name: string;
  /** URL slug, unique within its city once indexed (grouping.ts). */
  readonly slug: string;
  readonly addressLine1: string;
  readonly addressLine2: string | null;
  readonly city: string;
  readonly state: UsStateCode;
  readonly postalCode: string;
  /** Display form, for example (212) 555-0100; null when missing or unusable. */
  readonly phone: string | null;
  /** Null when the client has not published hours (shown as "hours not available"). */
  readonly hours: WeeklyHours | null;
  /**
   * IANA zone such as America/Chicago. ASSUMPTION: the `store` metaobject gets a
   * `time_zone` field, because stores can sit in different zones and the data
   * model does not list one yet (raise with the P3A-02 owner).
   */
  readonly timeZone: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  /** Pickup is offered only when true (maps to a Shopify location, REQ-LOC-002). */
  readonly pickupEnabled: boolean;
  /** Handle of the mapped Shopify location, used for pickup availability. */
  readonly locationHandle: string | null;
  readonly photoUrl: string | null;
};
