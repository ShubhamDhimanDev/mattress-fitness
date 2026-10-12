import {describe, expect, it} from 'vitest';
import {mulberry32, shuffled} from '~/lib/catalog/test-helpers';
import {
  addressLines,
  googleMapsDirectionsUrl,
  googleMapsSearchUrl,
  normalizeUsPhone,
  singleLineAddress,
  telHref,
} from '~/lib/stores/directions';
import {
  FIXTURE_STORES,
  FIXTURE_STORE_RECORDS,
  FIXTURE_STORE_WARNINGS,
  getFixtureStore,
} from '~/lib/stores/fixtures';
import {
  allStores,
  buildStoreIndex,
  cityPath,
  findCity,
  findState,
  findStore,
  isValidSlug,
  pickupStores,
  statePath,
  storePath,
  storesIndexPath,
} from '~/lib/stores/grouping';
import {buildStoreJsonLd, serializeJsonLd} from '~/lib/stores/jsonld';
import {
  parseStoreRecord,
  parseStoreRecords,
  resolveState,
} from '~/lib/stores/parse';
import type {Store} from '~/lib/stores/types';
import {US_STATES} from '~/lib/stores/types';

const BUFFALO = getFixtureStore('fixture-store-buffalo');
const ROCHESTER = getFixtureStore('fixture-store-rochester');
const AUSTIN_CENTRAL = getFixtureStore('fixture-store-austin-central');
const PORTLAND = getFixtureStore('fixture-store-portland');

function store(overrides: Partial<Store> = {}): Store {
  return {...BUFFALO, ...overrides};
}

describe('store fixtures and parsing (REQ-LOC-002)', () => {
  it('parse with no warnings and cover several states, cities and a sparse record', () => {
    expect(FIXTURE_STORE_WARNINGS).toEqual([]);
    expect(FIXTURE_STORES).toHaveLength(FIXTURE_STORE_RECORDS.length);
    expect(
      new Set(FIXTURE_STORES.map((s) => s.state)).size,
    ).toBeGreaterThanOrEqual(4);
    expect(FIXTURE_STORES.filter((s) => s.city === 'Austin')).toHaveLength(2);
    expect(PORTLAND).toMatchObject({
      phone: null,
      hours: null,
      latitude: null,
      longitude: null,
      pickupEnabled: false,
    });
  });

  it('normalises the fields', () => {
    expect(BUFFALO).toMatchObject({
      id: 'fixture-store-buffalo',
      slug: 'buffalo-gallery',
      state: 'NY',
      phone: '(716) 555-0101',
      timeZone: 'America/New_York',
      latitude: 42.8864,
      longitude: -78.8784,
      pickupEnabled: true,
      locationHandle: 'buffalo-gallery',
    });
    expect(ROCHESTER).toMatchObject({
      state: 'NY',
      addressLine2: 'Suite 4',
      latitude: 43.1566,
      longitude: -77.6088,
    });
    expect(AUSTIN_CENTRAL.phone).toBe('(512) 555-0103');
  });

  it.each([
    ['ny', 'NY'],
    ['NY', 'NY'],
    [' new york ', 'NY'],
    ['New-York', 'NY'],
    ['District of Columbia', 'DC'],
    ['dc', 'DC'],
    ['Texas', 'TX'],
  ])('resolveState(%j) = %j', (raw, expected) => {
    expect(resolveState(raw)).toBe(expected);
  });

  it.each([
    [''],
    ['Ontario'],
    ['XX'],
    ['N'],
    [null],
    [undefined],
    [42],
    ['x'.repeat(100)],
    ['<script>'],
  ])('resolveState rejects %j', (raw) => {
    expect(resolveState(raw)).toBeNull();
  });

  it('knows 50 states and DC', () => {
    expect(Object.keys(US_STATES)).toHaveLength(51);
  });

  const valid = {
    id: 'x1',
    name: 'Test Store',
    address_line1: '1 Test St',
    city: 'Testville',
    state: 'CA',
    postal_code: '90001',
  };

  it('accepts a minimal record with every optional field empty', () => {
    const result = parseStoreRecord(valid);
    expect(result.status).toBe('ok');
    expect(result.status === 'ok' && result.store).toMatchObject({
      slug: 'test-store',
      phone: null,
      hours: null,
      timeZone: null,
      latitude: null,
      pickupEnabled: false,
      locationHandle: null,
      photoUrl: null,
      addressLine2: null,
    });
    expect(result.status === 'ok' && result.warnings).toEqual([]);
  });

  it.each([
    ['not an object', 'text', 'not_an_object'],
    ['null', null, 'not_an_object'],
    ['a list', [], 'not_an_object'],
    ['no id', {...valid, id: undefined}, 'missing_id'],
    ['an empty id', {...valid, id: ''}, 'missing_id'],
    ['a numeric id', {...valid, id: 7}, 'missing_id'],
    ['a very long id', {...valid, id: 'x'.repeat(300)}, 'missing_id'],
    ['no name', {...valid, name: undefined}, 'missing_name'],
    ['a name of only markup', {...valid, name: '<b></b>'}, 'missing_name'],
    [
      'a name that is too long',
      {...valid, name: 'n'.repeat(200)},
      'missing_name',
    ],
    ['no address', {...valid, address_line1: undefined}, 'missing_address'],
    ['no city', {...valid, city: ''}, 'missing_city'],
    ['an unknown state', {...valid, state: 'Atlantis'}, 'invalid_state'],
    ['a Canadian province', {...valid, state: 'ON'}, 'invalid_state'],
    ['a short ZIP', {...valid, postal_code: '1234'}, 'invalid_postal_code'],
    [
      'a Canadian postal code',
      {...valid, postal_code: 'K1A 0B1'},
      'invalid_postal_code',
    ],
    ['a numeric ZIP', {...valid, postal_code: 90001}, 'invalid_postal_code'],
  ])('rejects a record with %s', (_name, raw, reason) => {
    expect(parseStoreRecord(raw)).toEqual({status: 'rejected', reason});
  });

  it('accepts alias field names and ZIP+4', () => {
    const result = parseStoreRecord({
      id: 'a',
      title: 'Alias',
      address1: '2 B St',
      address2: 'Floor 2',
      city: 'C',
      region: 'Ohio',
      zip: '44101-1234',
    });
    expect(result.status === 'ok' && result.store).toMatchObject({
      name: 'Alias',
      addressLine1: '2 B St',
      addressLine2: 'Floor 2',
      state: 'OH',
      postalCode: '44101-1234',
    });
  });

  it('drops a bad optional field with a warning and keeps the store', () => {
    const result = parseStoreRecord({
      ...valid,
      phone: 'call us!',
      hours: 'whenever',
      time_zone: 'Mars/Olympus',
      latitude: 'north',
      longitude: 10,
      photo_url: 'http://insecure.example/x.jpg',
      pickup_enabled: 'maybe',
      location_handle: '../etc',
    });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.store).toMatchObject({
      phone: null,
      hours: null,
      timeZone: null,
      latitude: null,
      longitude: null,
      photoUrl: null,
      pickupEnabled: false,
      locationHandle: null,
    });
    expect(result.warnings.length).toBeGreaterThanOrEqual(7);
  });

  it.each([
    [0, 0],
    [91, 10],
    [10, 181],
    [Number.NaN, 5],
    ['12.5.6', '5'],
  ])(
    'rejects the coordinates (%j, %j) but keeps the store',
    (latitude, longitude) => {
      const result = parseStoreRecord({...valid, latitude, longitude});
      expect(
        result.status === 'ok' && [
          result.store.latitude,
          result.store.longitude,
        ],
      ).toEqual([null, null]);
      expect(result.status === 'ok' && result.warnings).toHaveLength(1);
    },
  );

  it('warns when pickup is on but no location is mapped', () => {
    const result = parseStoreRecord({...valid, pickup_enabled: true});
    expect(result.status === 'ok' && result.store.pickupEnabled).toBe(true);
    expect(result.status === 'ok' && result.warnings).toEqual([
      'Pickup is on but no Shopify location is mapped.',
    ]);
  });

  it('strips markup and control characters from text fields', () => {
    const result = parseStoreRecord({
      ...valid,
      name: '<img src=x onerror=alert(1)>Evil\u0000 Store <b>Sale</b>',
      address_line1: '1 Test St\n<script>x</script>',
    });
    expect(result.status === 'ok' && result.store.name).toBe('Evil Store Sale');
    expect(result.status === 'ok' && result.store.addressLine1).toBe(
      '1 Test St x',
    );
  });

  it('keeps the slug safe whatever the admin typed', () => {
    const result = parseStoreRecord({...valid, slug: '../../Evil Slug!!'});
    expect(result.status === 'ok' && result.store.slug).toBe('evil-slug');
    expect(isValidSlug(result.status === 'ok' ? result.store.slug : '')).toBe(
      true,
    );
    const empty = parseStoreRecord({...valid, slug: '!!!', name: '???'});
    expect(empty.status === 'ok' && empty.store.slug).toBe('store');
  });

  it('survives a record whose properties throw', () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error('boom');
        },
      },
    );
    expect(parseStoreRecord(hostile)).toEqual({
      status: 'rejected',
      reason: 'not_an_object',
    });
  });

  it('skips bad records in a list, reports positions only, and drops duplicate ids', () => {
    const result = parseStoreRecords([
      valid,
      null,
      {...valid, id: 'x2', state: 'Atlantis'},
      {...valid, name: 'Duplicate'},
      {...valid, id: 'x3'},
    ]);
    expect(result.stores.map((s) => s.id)).toEqual(['x1', 'x3']);
    expect(result.warnings).toEqual([
      'stores[1] skipped: not_an_object.',
      'stores[2] skipped: invalid_state.',
      'stores[3] skipped: duplicate_id.',
    ]);
    expect(parseStoreRecords('nope').stores).toEqual([]);
    expect(parseStoreRecords(null).warnings).toHaveLength(1);
  });
});

describe('grouping stores: state > city > store (REQ-LOC-001)', () => {
  const index = buildStoreIndex(FIXTURE_STORES);

  it('groups alphabetically at every level', () => {
    expect(index.storeCount).toBe(6);
    expect(
      index.states.map((s) => [s.code, s.name, s.slug, s.storeCount]),
    ).toEqual([
      ['IL', 'Illinois', 'illinois', 1],
      ['NY', 'New York', 'new-york', 2],
      ['OR', 'Oregon', 'oregon', 1],
      ['TX', 'Texas', 'texas', 2],
    ]);
    expect(
      index.states[1]?.cities.map((c) => [c.name, c.slug, c.stores.length]),
    ).toEqual([
      ['Buffalo', 'buffalo', 1],
      ['Rochester', 'rochester', 1],
    ]);
    const austin = index.states[3]?.cities[0];
    expect(austin?.stores.map((s) => s.slug)).toEqual([
      'austin-central',
      'austin-north',
    ]);
  });

  it('lists every store once, in index order', () => {
    expect(allStores(index).map((s) => s.id)).toEqual([
      'fixture-store-chicago',
      'fixture-store-buffalo',
      'fixture-store-rochester',
      'fixture-store-portland',
      'fixture-store-austin-central',
      'fixture-store-austin-north',
    ]);
    expect(pickupStores(index).map((s) => s.id)).toEqual([
      'fixture-store-chicago',
      'fixture-store-buffalo',
      'fixture-store-rochester',
      'fixture-store-austin-central',
    ]);
  });

  it('builds the URLs', () => {
    expect(storesIndexPath()).toBe('/stores');
    expect(statePath('NY')).toBe('/stores/new-york');
    expect(cityPath('NY', 'Buffalo')).toBe('/stores/new-york/buffalo');
    expect(cityPath('MO', 'St. Louis')).toBe('/stores/missouri/st-louis');
    expect(cityPath('DC', 'Washington')).toBe(
      '/stores/district-of-columbia/washington',
    );
    expect(storePath(BUFFALO)).toBe('/stores/new-york/buffalo/buffalo-gallery');
  });

  it('every store path resolves back to the same store through the lookups', () => {
    for (const s of allStores(index)) {
      const [, root, state, city, slug] = storePath(s).split('/');
      expect(root).toBe('stores');
      expect(findStore(index, state, city, slug)?.store.id).toBe(s.id);
      expect(
        findCity(index, state, city)?.city.stores.some((c) => c.id === s.id),
      ).toBe(true);
      expect(findState(index, state)?.code).toBe(s.state);
    }
  });

  it('a valid state with a wrong city or store still finds the state but not the rest', () => {
    expect(findState(index, 'new-york')?.code).toBe('NY');
    expect(findCity(index, 'new-york', 'austin')).toBeNull();
    expect(findStore(index, 'new-york', 'austin', 'austin-central')).toBeNull();
    expect(findStore(index, 'new-york', 'buffalo', 'nope')).toBeNull();
    // A real store slug under the wrong city does not resolve either.
    expect(
      findStore(index, 'new-york', 'rochester', 'buffalo-gallery'),
    ).toBeNull();
  });

  it.each([
    ['unknown state', 'atlantis', 'buffalo', 'buffalo-gallery'],
    ['upper case', 'NEW-YORK', 'buffalo', 'buffalo-gallery'],
    ['path traversal', '..', 'buffalo', 'buffalo-gallery'],
    ['encoded slash', 'new-york%2Fbuffalo', 'buffalo', 'x'],
    ['script', '<script>', 'buffalo', 'x'],
    ['empty', '', '', ''],
    ['non-string', 42, {}, []],
    ['undefined', undefined, undefined, undefined],
    ['a prototype key', '__proto__', 'constructor', 'toString'],
    ['very long', 'a'.repeat(500), 'b', 'c'],
  ])('lookups return null for %s', (_name, state, city, slug) => {
    expect(findStore(index, state, city, slug)).toBeNull();
    expect(findState(index, state)).toBeNull();
  });

  it('city and state pages exist for every store in the data', () => {
    for (const s of FIXTURE_STORES) {
      expect(findState(index, statePath(s.state).split('/')[2])).not.toBeNull();
      expect(
        findCity(
          index,
          statePath(s.state).split('/')[2],
          cityPath(s.state, s.city).split('/')[3],
        ),
      ).not.toBeNull();
    }
  });

  it('gives clashing slugs a stable suffix by store ID, whatever order stores arrive in', () => {
    const clash = (id: string) =>
      store({id, slug: 'main', name: `Store ${id}`, city: 'Buffalo'});
    const stores = [clash('c'), clash('a'), clash('b')];
    const expected = [
      ['a', 'main'],
      ['b', 'main-2'],
      ['c', 'main-3'],
    ];
    const random = mulberry32(5);
    for (let run = 0; run < 20; run += 1) {
      const built = buildStoreIndex(shuffled(stores, random));
      const found = allStores(built).map((s) => [s.id, s.slug]);
      expect(found).toEqual(expected);
    }
  });

  it('does not clash slugs between different cities', () => {
    const built = buildStoreIndex([
      store({id: '1', slug: 'main', city: 'Buffalo'}),
      store({id: '2', slug: 'main', city: 'Rochester'}),
    ]);
    expect(allStores(built).map((s) => s.slug)).toEqual(['main', 'main']);
  });

  it('merges spellings of one city and shows the one from the lowest store ID', () => {
    const built = buildStoreIndex([
      store({id: 'b', slug: 'two', city: 'St Louis', state: 'MO'}),
      store({id: 'a', slug: 'one', city: 'St. Louis', state: 'MO'}),
    ]);
    const cities = built.states[0]?.cities ?? [];
    expect(cities).toHaveLength(1);
    expect(cities[0]).toMatchObject({name: 'St. Louis', slug: 'st-louis'});
    expect(cities[0]?.stores).toHaveLength(2);
  });

  it('keeps the first of repeated IDs and handles an empty list', () => {
    const built = buildStoreIndex([
      store({id: 'x', name: 'First'}),
      store({id: 'x', name: 'Second'}),
    ]);
    expect(built.storeCount).toBe(1);
    expect(allStores(built)[0]?.name).toBe('First');
    expect(buildStoreIndex([])).toEqual({states: [], storeCount: 0});
  });

  it('property: the index does not depend on the order stores arrive in (50 shuffles)', () => {
    const random = mulberry32(77);
    const expected = JSON.stringify(buildStoreIndex(FIXTURE_STORES));
    for (let run = 0; run < 50; run += 1) {
      expect(
        JSON.stringify(buildStoreIndex(shuffled(FIXTURE_STORES, random))),
      ).toBe(expected);
    }
  });

  it('falls back to the name when the slug is empty, and caps long slugs', () => {
    const built = buildStoreIndex([
      store({id: '1', slug: '', name: 'Fallback Name'}),
      store({id: '2', slug: 'a'.repeat(200), city: 'Elsewhere'}),
    ]);
    const slugs = allStores(built).map((s) => s.slug);
    expect(slugs).toContain('fallback-name');
    expect(slugs.every((slug) => slug.length <= 80 && isValidSlug(slug))).toBe(
      true,
    );
  });
});

describe('directions, address and phone (REQ-LOC-001)', () => {
  const springfield = store({
    addressLine1: '123 Main St',
    addressLine2: 'Suite 4',
    city: 'Springfield',
    state: 'IL',
    postalCode: '62704',
  });

  it('formats the address', () => {
    expect(addressLines(springfield)).toEqual([
      '123 Main St',
      'Suite 4',
      'Springfield, IL 62704',
    ]);
    expect(addressLines(store({addressLine2: null}))).toHaveLength(2);
    expect(singleLineAddress(springfield)).toBe(
      '123 Main St, Suite 4, Springfield, IL 62704',
    );
  });

  it('builds the keyless Google Maps directions link', () => {
    expect(googleMapsDirectionsUrl(springfield)).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=123%20Main%20St%2C%20Suite%204%2C%20Springfield%2C%20IL%2062704',
    );
    expect(googleMapsSearchUrl(springfield)).toBe(
      'https://www.google.com/maps/search/?api=1&query=123%20Main%20St%2C%20Suite%204%2C%20Springfield%2C%20IL%2062704',
    );
  });

  it.each([
    ['ampersand and equals', '1 Main St & evil=1'],
    ['hash and question mark', '1 Main St #frag ?x=y'],
    ['percent encoding', '100%25 Main St'],
    ['unicode', '12 Rue de léglise'],
    ['quotes and angle brackets', '1 "Main" <St>'],
    ['a javascript scheme', 'javascript:alert(1)'],
    ['a redirect attempt', '1 Main St\r\nLocation: https://evil.example'],
    ['a protocol relative link', '//evil.example/steal'],
  ])(
    'keeps the link on Google Maps whatever the address contains: %s',
    (_name, line) => {
      const url = new URL(
        googleMapsDirectionsUrl(
          store({addressLine1: line, addressLine2: null}),
        ),
      );
      expect(url.origin).toBe('https://www.google.com');
      expect(url.pathname).toBe('/maps/dir/');
      expect([...url.searchParams.keys()]).toEqual(['api', 'destination']);
      expect(url.searchParams.get('destination')).toContain(line);
      expect(url.hash).toBe('');
    },
  );

  it('never includes the shopper location', () => {
    expect(googleMapsDirectionsUrl(springfield)).not.toMatch(/origin=/);
  });

  it.each([
    ['716-555-0101', '+17165550101', '(716) 555-0101'],
    ['(716) 555-0101', '+17165550101', '(716) 555-0101'],
    ['716.555.0101', '+17165550101', '(716) 555-0101'],
    ['716 555 0101', '+17165550101', '(716) 555-0101'],
    ['7165550101', '+17165550101', '(716) 555-0101'],
    ['1-716-555-0101', '+17165550101', '(716) 555-0101'],
    ['+1 716 555 0101', '+17165550101', '(716) 555-0101'],
    ['+1(716)555-0101', '+17165550101', '(716) 555-0101'],
    [' 716-555-0101 ', '+17165550101', '(716) 555-0101'],
  ])('reads the phone number %j', (raw, e164, display) => {
    expect(normalizeUsPhone(raw)).toEqual({e164, display});
    expect(telHref(raw)).toBe(`tel:${e164}`);
  });

  it.each([
    [''],
    ['555-0101'],
    ['716-555-010'],
    ['716-555-01011'],
    ['0165550101'],
    ['716-155-0101'],
    ['+44 20 7946 0958'],
    ['+2 716 555 0101'],
    ['716-555-0101 ext 5'],
    ['716-555-0101x5'],
    ['call 716-555-0101'],
    ['javascript:alert(1)'],
    ['716-555-0101;rm'],
    ['+++17165550101'],
    ['1'.repeat(40)],
    [null],
    [undefined],
    [7165550101],
  ])('rejects the phone number %j', (raw) => {
    expect(normalizeUsPhone(raw)).toBeNull();
    expect(telHref(typeof raw === 'string' ? raw : null)).toBeNull();
  });
});

describe('LocalBusiness JSON-LD (REQ-LOC-001)', () => {
  const ORIGIN = 'https://www.example.com';

  it('builds a complete record from a store', () => {
    expect(buildStoreJsonLd(BUFFALO, {siteOrigin: ORIGIN})).toEqual({
      '@context': 'https://schema.org',
      '@type': 'LocalBusiness',
      '@id': 'https://www.example.com/stores/new-york/buffalo/buffalo-gallery',
      url: 'https://www.example.com/stores/new-york/buffalo/buffalo-gallery',
      name: 'Wrenfield Sleep Gallery Buffalo',
      telephone: '+17165550101',
      hasMap:
        'https://www.google.com/maps/search/?api=1&query=100%20Example%20Street%2C%20Buffalo%2C%20NY%2014201',
      address: {
        '@type': 'PostalAddress',
        streetAddress: '100 Example Street',
        addressLocality: 'Buffalo',
        addressRegion: 'NY',
        postalCode: '14201',
        addressCountry: 'US',
      },
      geo: {'@type': 'GeoCoordinates', latitude: 42.8864, longitude: -78.8784},
      openingHoursSpecification: [
        {
          '@type': 'OpeningHoursSpecification',
          dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
          opens: '10:00',
          closes: '21:00',
        },
        {
          '@type': 'OpeningHoursSpecification',
          dayOfWeek: ['Saturday'],
          opens: '10:00',
          closes: '18:00',
        },
      ],
    });
  });

  it('matches the hours the page shows: closed days are omitted, other days are all present', () => {
    const spec =
      buildStoreJsonLd(AUSTIN_CENTRAL).openingHoursSpecification ?? [];
    expect(spec.map((s) => [s.dayOfWeek.length, s.opens, s.closes])).toEqual([
      [6, '10:00', '20:00'],
      [1, '12:00', '18:00'],
    ]);
  });

  it('joins a second address line into the street address', () => {
    expect(buildStoreJsonLd(ROCHESTER).address.streetAddress).toBe(
      '25 Sample Avenue, Suite 4',
    );
  });

  it('leaves out what the store does not have', () => {
    const json = buildStoreJsonLd(PORTLAND);
    expect(json).not.toHaveProperty('telephone');
    expect(json).not.toHaveProperty('geo');
    expect(json).not.toHaveProperty('openingHoursSpecification');
    expect(json).not.toHaveProperty('image');
    expect(json).not.toHaveProperty('url');
    expect(json).not.toHaveProperty('@id');
  });

  it.each([
    ['nothing', undefined],
    ['null', null],
    ['an insecure origin', 'http://www.example.com'],
    ['a script scheme', 'javascript:alert(1)'],
    ['text', 'not a url'],
  ])('omits url fields when the origin is %s', (_name, siteOrigin) => {
    expect(buildStoreJsonLd(BUFFALO, {siteOrigin})).not.toHaveProperty('url');
  });

  it('uses only the origin of the site URL it is given', () => {
    expect(
      buildStoreJsonLd(BUFFALO, {
        siteOrigin: 'https://www.example.com/some/path?x=1#y',
      }).url,
    ).toBe('https://www.example.com/stores/new-york/buffalo/buffalo-gallery');
  });

  it('includes only an https photo', () => {
    expect(
      buildStoreJsonLd(store({photoUrl: 'https://cdn.example.com/a.jpg'}))
        .image,
    ).toBe('https://cdn.example.com/a.jpg');
    expect(
      buildStoreJsonLd(store({photoUrl: 'http://cdn.example.com/a.jpg'})),
    ).not.toHaveProperty('image');
    expect(
      buildStoreJsonLd(store({photoUrl: 'javascript:alert(1)'})),
    ).not.toHaveProperty('image');
  });

  it('writes hours after midnight and all-day hours in schema.org form', () => {
    const night = store({
      hours: parseHours('Fri 6pm-2am; Sat Open 24 hours; Sun-Thu closed'),
    });
    expect(buildStoreJsonLd(night).openingHoursSpecification).toEqual([
      {
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: ['Friday'],
        opens: '18:00',
        closes: '02:00',
      },
      {
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: ['Saturday'],
        opens: '00:00',
        closes: '23:59',
      },
    ]);
    const midnight = store({
      hours: parseHours('Mon 10am-12am; Tue-Sun closed'),
    });
    expect(
      buildStoreJsonLd(midnight).openingHoursSpecification?.[0]?.closes,
    ).toBe('23:59');
  });

  it('lists a split day as two entries', () => {
    const split = store({
      hours: parseHours('Mon 9am-12pm, 1pm-5pm; Tue-Sun closed'),
    });
    expect(buildStoreJsonLd(split).openingHoursSpecification).toEqual([
      {
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: ['Monday'],
        opens: '09:00',
        closes: '12:00',
      },
      {
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: ['Monday'],
        opens: '13:00',
        closes: '17:00',
      },
    ]);
  });

  describe('serialising for a <script> block is safe', () => {
    const LINE_SEPARATOR = String.fromCharCode(0x2028);
    const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

    it.each([
      ['a closing script tag', '</script><script>alert(1)</script>'],
      ['an HTML comment', '<!-- x -->'],
      ['an ampersand entity', 'Tom &amp; Jerry'],
      [
        'line and paragraph separators',
        `a${LINE_SEPARATOR}b${PARAGRAPH_SEPARATOR}c`,
      ],
      ['quotes and backslashes', '"quoted" \\ back'],
    ])('survives %s in the store name', (_name, name) => {
      const text = serializeJsonLd(buildStoreJsonLd(store({name})));
      expect(text).not.toMatch(/[<>&]/);
      expect(text).not.toContain(LINE_SEPARATOR);
      expect(text).not.toContain(PARAGRAPH_SEPARATOR);
      const parsed: unknown = JSON.parse(text);
      expect(parsed).toMatchObject({name});
    });
  });
});

function parseHours(raw: string) {
  const result = parseStoreRecord({
    id: 'h',
    name: 'Hours Test',
    address_line1: '1 A St',
    city: 'B',
    state: 'NY',
    postal_code: '14201',
    hours: raw,
  });
  if (result.status !== 'ok' || !result.store.hours)
    throw new Error(`hours did not parse: ${raw}`);
  return result.store.hours;
}
