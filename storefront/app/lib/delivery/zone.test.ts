import {describe, expect, it} from 'vitest';
import {
  SHOPIFY_POSTAL_CODE_LIST_LIMIT,
  deliveryQuote,
  diffZoneLists,
  isInZone,
  parseZoneList,
  promiseFor,
  serializeZoneList,
  type DeliveryZone,
} from '~/lib/delivery/zone';
import {isValidCents, safeCents} from '~/lib/delivery/cents';

const zone: DeliveryZone = {
  name: 'Chicago metro',
  postalCodes: ['606*', '60007', '1101*'],
  feeCents: 14900,
  freeOverCents: 99900,
  promise: {
    inHome: 'White-glove delivery in 3 to 5 days.',
    parcel: 'Ships in 5 to 7 business days.',
    pickup: 'Ready for pickup in 2 hours.',
  },
};

function withZone(overrides: Partial<DeliveryZone>): DeliveryZone {
  return {...zone, ...overrides};
}

// Small seeded generator so property loops are reproducible.
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function expandEntries(entries: readonly string[]): Set<number> {
  const zips = new Set<number>();
  for (const entry of entries) {
    if (entry.endsWith('*')) {
      const digits = entry.slice(0, -1);
      const span = 10 ** (5 - digits.length);
      const start = Number(digits) * span;
      for (let zip = start; zip < start + span; zip++) zips.add(zip);
    } else {
      zips.add(Number(entry));
    }
  }
  return zips;
}

describe('isInZone (REQ-DEL-001)', () => {
  it.each([
    ['exact code', '60007', true],
    ['wildcard lower edge', '60600', true],
    ['wildcard inside', '60645', true],
    ['wildcard upper edge', '60699', true],
    ['just below the wildcard', '60599', false],
    ['just above the wildcard', '60700', false],
    ['next to the exact code', '60008', false],
    ['ZIP+4 inside the zone', '60645-1234', true],
    ['ZIP+4 with a space', '60645 1234', true],
    ['padded input', '  60645 ', true],
    ['second wildcard edge', '11010', true],
    ['second wildcard upper edge', '11019', true],
    ['second wildcard just above', '11020', false],
    ['far away', '90210', false],
    ['four digits', '6064', false],
    ['letters', '606ab', false],
    ['the wildcard text itself', '606*', false],
    ['injection', "60645' OR '1'='1", false],
    ['empty', '', false],
  ])('%s (%s) -> %s', (_label, zip, expected) => {
    expect(isInZone(zone, zip)).toBe(expected);
  });

  it.each([null, undefined, 60645, {}, ['60645']])(
    'treats non-string %j as outside the zone',
    (zip) => {
      expect(isInZone(zone, zip)).toBe(false);
    },
  );

  it('is not fooled by malformed zone entries', () => {
    const broken = withZone({
      postalCodes: ['*', '', '12345*', 'abc', '6*', '606 *', '99999-9999'],
    });
    // Only the valid one-digit prefix "6*" works; "*" and the rest cover nothing.
    expect(isInZone(broken, '60645')).toBe(true);
    expect(isInZone(broken, '70000')).toBe(false);
    expect(isInZone(broken, '12345')).toBe(false);
    expect(isInZone(broken, '99999')).toBe(false);
  });

  it('an empty zone serves nobody', () => {
    expect(isInZone(withZone({postalCodes: []}), '60645')).toBe(false);
  });
});

describe('parseZoneList (REQ-DEL-001)', () => {
  it.each([
    ['comma and space (Shopify format)', '60601, 60602, 606*'],
    ['comma only', '60601,60602,606*'],
    ['extra spaces', '  60601 ,   60602 ,606*  '],
    ['line breaks', '60601\n60602\r\n606*'],
    ['trailing and doubled commas', '60601,, 60602,,606*,'],
  ])('splits %s', (_label, text) => {
    const parsed = parseZoneList(text);
    expect(parsed.entries).toEqual(['60601', '60602', '606*']);
    // 60601 and 60602 sit inside 606*, which is reported as redundant but kept.
    expect(parsed.warnings.map((w) => w.code)).toEqual([
      'redundant',
      'redundant',
    ]);
  });

  it('keeps first-seen order and reports duplicates', () => {
    const parsed = parseZoneList('70001, 60601, 70001, 60601, 80001');
    expect(parsed.entries).toEqual(['70001', '60601', '80001']);
    expect(parsed.warnings).toEqual([
      {code: 'duplicate', entry: '70001'},
      {code: 'duplicate', entry: '60601'},
    ]);
  });

  it.each([
    'abc',
    '6060',
    '*',
    '**',
    '12345*',
    '123456',
    '60601-1234',
    '60 601',
    '--',
    '606**',
    '*606',
    '6O601', // letter O
    '<script>alert(1)</script>',
  ])('rejects invalid entry %j and keeps the valid ones', (bad) => {
    const parsed = parseZoneList(`70001, ${bad}, 80001`);
    expect(parsed.entries).toEqual(['70001', '80001']);
    expect(parsed.warnings).toEqual([{code: 'invalid-entry', entry: bad}]);
  });

  it('clips very long invalid entries in warnings', () => {
    const parsed = parseZoneList(`70001, ${'x'.repeat(500)}`);
    const warning = parsed.warnings[0];
    expect(warning).toEqual({
      code: 'invalid-entry',
      entry: `${'x'.repeat(40)}...`,
    });
  });

  it.each([null, undefined, '', '   ', ',,,', '\n\n'])(
    'returns an empty list for %j',
    (text) => {
      expect(parseZoneList(text)).toEqual({entries: [], warnings: []});
    },
  );

  it('reports wildcards that cover other entries, in either order', () => {
    expect(parseZoneList('60601, 606*').warnings).toEqual([
      {code: 'redundant', entry: '60601', coveredBy: '606*'},
    ]);
    expect(parseZoneList('606*, 6060*').warnings).toEqual([
      {code: 'redundant', entry: '6060*', coveredBy: '606*'},
    ]);
    expect(parseZoneList('606*, 607*, 60701').warnings).toEqual([
      {code: 'redundant', entry: '60701', coveredBy: '607*'},
    ]);
    expect(parseZoneList('606*, 607*').warnings).toEqual([]);
  });

  it('warns above the Shopify limit but still parses', () => {
    const codes = Array.from({length: 600}, (_, index) =>
      String(10000 + index * 3).padStart(5, '0'),
    );
    const text = codes.join(', ');
    expect(text.length).toBeGreaterThan(SHOPIFY_POSTAL_CODE_LIST_LIMIT);
    const parsed = parseZoneList(text);
    expect(parsed.entries).toHaveLength(600);
    expect(parsed.warnings).toEqual([
      {
        code: 'too-long',
        length: text.length,
        limit: SHOPIFY_POSTAL_CODE_LIST_LIMIT,
      },
    ]);
  });

  it('does not warn at exactly the Shopify limit and warns one character over', () => {
    const atLimit = `60601${' '.repeat(SHOPIFY_POSTAL_CODE_LIST_LIMIT - 5)}`;
    expect(atLimit).toHaveLength(SHOPIFY_POSTAL_CODE_LIST_LIMIT);
    expect(parseZoneList(atLimit).warnings).toEqual([]);
    expect(parseZoneList(`${atLimit} `).warnings).toEqual([
      {
        code: 'too-long',
        length: SHOPIFY_POSTAL_CODE_LIST_LIMIT + 1,
        limit: SHOPIFY_POSTAL_CODE_LIST_LIMIT,
      },
    ]);
  });

  it('fails closed on hostile, enormous input', () => {
    const parsed = parseZoneList('60601, '.repeat(50_000));
    expect(parsed.entries).toEqual([]);
    expect(parsed.warnings).toEqual([
      {code: 'too-large-to-parse', length: 350_000, limit: 100_000},
    ]);
  });

  it('serializes in the Shopify format and round-trips', () => {
    const entries = ['60601', '607*', '70001'];
    const text = serializeZoneList(entries);
    expect(text).toBe('60601, 607*, 70001');
    expect(parseZoneList(text).entries).toEqual(entries);
  });
});

describe('deliveryQuote (REQ-DEL-001, REQ-CART-004)', () => {
  it.each([
    ['empty cart', 0, 14900, false, 99900],
    ['one cent below the threshold', 99899, 14900, false, 1],
    ['exactly at the threshold', 99900, 0, true, 0],
    ['one cent above', 99901, 0, true, 0],
    ['far above', 5_000_000, 0, true, 0],
  ])(
    'in zone, %s: subtotal %i -> fee %i, free %s, remaining %i',
    (_label, subtotal, fee, free, remaining) => {
      expect(deliveryQuote(zone, '60645', subtotal)).toEqual({
        eligible: true,
        method: 'in-home',
        feeCents: fee,
        free,
        freeDeliveryRemainingCents: remaining,
      });
    },
  );

  it('accepts ZIP+4 and padded ZIPs', () => {
    expect(deliveryQuote(zone, ' 60645-1234 ', 0).eligible).toBe(true);
  });

  it('a zone that never gives free delivery reports null remaining', () => {
    const never = withZone({freeOverCents: null});
    expect(deliveryQuote(never, '60645', 5_000_000)).toEqual({
      eligible: true,
      method: 'in-home',
      feeCents: 14900,
      free: false,
      freeDeliveryRemainingCents: null,
    });
  });

  it('a zero fee is free even without a threshold', () => {
    const flatFree = withZone({feeCents: 0, freeOverCents: null});
    const quote = deliveryQuote(flatFree, '60645', 100);
    expect(quote).toMatchObject({eligible: true, free: true, feeCents: 0});
  });

  it('a zero threshold means always free', () => {
    const quote = deliveryQuote(withZone({freeOverCents: 0}), '60645', 0);
    expect(quote).toMatchObject({
      eligible: true,
      free: true,
      freeDeliveryRemainingCents: 0,
    });
  });

  it.each([
    ['outside the zone', '90210', 'outside-zone'],
    ['a letter ZIP', 'ABCDE', 'invalid-zip'],
    ['an empty ZIP', '', 'invalid-zip'],
    ['an injection string', "60645'; --", 'invalid-zip'],
  ])('is unavailable for %s', (_label, zip, reason) => {
    expect(deliveryQuote(zone, zip, 200_000)).toEqual({
      eligible: false,
      method: 'unavailable',
      reason,
      feeCents: 0,
      free: false,
      freeDeliveryRemainingCents: null,
    });
  });

  it.each([null, undefined, 60645])(
    'is unavailable for the non-string ZIP %j',
    (zip) => {
      expect(deliveryQuote(zone, zip, 0)).toMatchObject({
        eligible: false,
        reason: 'invalid-zip',
      });
    },
  );

  it.each([
    ['negative fee', {feeCents: -1}],
    ['fractional fee', {feeCents: 14900.5}],
    ['NaN fee', {feeCents: Number.NaN}],
    ['infinite fee', {feeCents: Number.POSITIVE_INFINITY}],
    ['negative threshold', {freeOverCents: -5}],
    ['fractional threshold', {freeOverCents: 99900.1}],
  ])('refuses to quote a zone with a %s', (_label, overrides) => {
    expect(deliveryQuote(withZone(overrides), '60645', 0)).toMatchObject({
      eligible: false,
      reason: 'zone-misconfigured',
    });
  });

  it.each([-100, Number.NaN, 1.5, Number.POSITIVE_INFINITY, 2 ** 60])(
    'treats the hostile subtotal %s as zero (never as free)',
    (subtotal) => {
      expect(deliveryQuote(zone, '60645', subtotal)).toMatchObject({
        eligible: true,
        free: false,
        feeCents: 14900,
        freeDeliveryRemainingCents: 99900,
      });
    },
  );
});

describe('promiseFor (REQ-DEL-002)', () => {
  it('returns the in-home promise for a ZIP inside the zone', () => {
    expect(promiseFor(zone, '60645', 'in-home')).toEqual({
      status: 'promise',
      deliveryType: 'in-home',
      text: 'White-glove delivery in 3 to 5 days.',
    });
  });

  it('shows no in-home promise outside the zone', () => {
    expect(promiseFor(zone, '90210', 'in-home')).toEqual({
      status: 'unavailable',
      reason: 'outside-zone',
    });
  });

  it.each([null, undefined, '', '   '])(
    'asks for a ZIP when %j is given for in-home delivery',
    (zip) => {
      expect(promiseFor(zone, zip, 'in-home')).toEqual({status: 'needs-zip'});
    },
  );

  it.each(['1234', 'abcde', "60645'; --", 60645, {}])(
    'flags %j as an invalid ZIP for in-home delivery',
    (zip) => {
      expect(promiseFor(zone, zip, 'in-home')).toEqual({
        status: 'invalid-zip',
      });
    },
  );

  it.each([
    ['parcel', 'Ships in 5 to 7 business days.'],
    ['pickup', 'Ready for pickup in 2 hours.'],
  ] as const)(
    'returns the static %s promise whether or not the ZIP is in the zone',
    (deliveryType, text) => {
      for (const zip of ['60645', '90210', null, 'garbage']) {
        expect(promiseFor(zone, zip, deliveryType)).toEqual({
          status: 'promise',
          deliveryType,
          text,
        });
      }
    },
  );

  it.each([
    ['in-home', {inHome: '   '}],
    ['parcel', {parcel: ''}],
    ['pickup', {pickup: '\n'}],
  ] as const)('shows nothing when the %s wording is blank', (type, promise) => {
    const blank = withZone({promise: {...zone.promise, ...promise}});
    expect(promiseFor(blank, '60645', type)).toEqual({
      status: 'unavailable',
      reason: 'no-promise-text',
    });
  });

  it('trims the client wording', () => {
    const padded = withZone({promise: {...zone.promise, pickup: '  Soon.  '}});
    expect(promiseFor(padded, null, 'pickup')).toMatchObject({text: 'Soon.'});
  });
});

describe('diffZoneLists (REQ-DEL-001 parity)', () => {
  it('reports identical lists when wildcards and exact codes mean the same ZIPs', () => {
    const exact = Array.from(
      {length: 100},
      (_, index) => `606${String(index).padStart(2, '0')}`,
    );
    const diff = diffZoneLists(['606*'], exact);
    expect(diff).toEqual({
      onlyInA: [],
      onlyInB: [],
      common: ['606*'],
      identical: true,
    });
  });

  it('merges adjacent wildcards into the wider one', () => {
    const tens = Array.from({length: 10}, (_, index) => `606${index}*`);
    expect(diffZoneLists(tens, ['606*']).identical).toBe(true);
    expect(diffZoneLists(tens, ['606*']).common).toEqual(['606*']);
  });

  it('describes a partial overlap with the smallest entries', () => {
    const diff = diffZoneLists(['606*'], ['60650', '60651', '60652']);
    expect(diff.common).toEqual(['60650', '60651', '60652']);
    expect(diff.onlyInB).toEqual([]);
    expect(diff.onlyInA).toEqual([
      '6060*',
      '6061*',
      '6062*',
      '6063*',
      '6064*',
      '60653',
      '60654',
      '60655',
      '60656',
      '60657',
      '60658',
      '60659',
      '6066*',
      '6067*',
      '6068*',
      '6069*',
    ]);
    expect(diff.identical).toBe(false);
  });

  it('reports disjoint lists', () => {
    expect(diffZoneLists(['606*'], ['10001', '10002'])).toEqual({
      onlyInA: ['606*'],
      onlyInB: ['10001', '10002'],
      common: [],
      identical: false,
    });
  });

  it('catches a single missing ZIP in a large list (drift)', () => {
    const shopify = Array.from(
      {length: 100},
      (_, index) => `606${String(index).padStart(2, '0')}`,
    ).filter((zip) => zip !== '60642');
    const diff = diffZoneLists(['606*'], shopify);
    expect(diff.onlyInA).toEqual(['60642']);
    expect(diff.onlyInB).toEqual([]);
    expect(diff.identical).toBe(false);
  });

  it('handles the whole ZIP space and its edges', () => {
    const all = Array.from({length: 10}, (_, index) => `${index}*`);
    expect(diffZoneLists(all, ['0*', '9*']).onlyInA).toEqual([
      '1*',
      '2*',
      '3*',
      '4*',
      '5*',
      '6*',
      '7*',
      '8*',
    ]);
    expect(diffZoneLists(['00000'], ['99999'])).toEqual({
      onlyInA: ['00000'],
      onlyInB: ['99999'],
      common: [],
      identical: false,
    });
    expect(diffZoneLists(['0*'], ['00000*']).onlyInA).toEqual(['0*']);
  });

  it('keeps leading zeros in the output', () => {
    expect(diffZoneLists(['021*', '02134'], []).onlyInA).toEqual(['021*']);
    expect(diffZoneLists(['02134'], []).onlyInA).toEqual(['02134']);
  });

  it('ignores invalid entries and treats empty lists as identical', () => {
    expect(diffZoneLists([], []).identical).toBe(true);
    expect(diffZoneLists(['abc', '*', '12345*'], []).identical).toBe(true);
    expect(diffZoneLists(['abc', '60601'], ['60601']).identical).toBe(true);
  });

  it('is unaffected by order and duplicates', () => {
    const diff = diffZoneLists(['70001', '606*', '70001'], ['606*', '70001']);
    expect(diff.identical).toBe(true);
    expect(diff.common).toEqual(['606*', '70001']);
  });

  it('matches a brute-force expansion on random lists (property)', () => {
    const random = mulberry32(20261012);
    // A small universe keeps overlaps frequent: prefixes under "60" and "61".
    const universe = [
      ...Array.from({length: 40}, (_, i) => `60${String(i).padStart(3, '0')}`),
      ...Array.from(
        {length: 40},
        (_, i) => `61${String(i * 7).padStart(3, '0')}`,
      ),
      ...Array.from({length: 10}, (_, i) => `60${i}*`),
      ...Array.from({length: 10}, (_, i) => `61${i}*`),
      ...Array.from({length: 10}, (_, i) => `6${String(i).padStart(2, '0')}*`),
      ...Array.from({length: 10}, (_, i) => `6${i}*`),
    ];
    for (let round = 0; round < 300; round++) {
      const pick = () =>
        Array.from(
          {length: Math.floor(random() * 25)},
          () => universe[Math.floor(random() * universe.length)] ?? '60000',
        );
      const a = pick();
      const b = pick();
      const diff = diffZoneLists(a, b);
      const setA = expandEntries(a);
      const setB = expandEntries(b);
      const expectedOnlyA = [...setA].filter((zip) => !setB.has(zip));
      const expectedOnlyB = [...setB].filter((zip) => !setA.has(zip));
      const expectedCommon = [...setA].filter((zip) => setB.has(zip));
      const sortNumbers = (values: number[]) =>
        [...values].sort((x, y) => x - y);
      expect(sortNumbers([...expandEntries(diff.onlyInA)])).toEqual(
        sortNumbers(expectedOnlyA),
      );
      expect(sortNumbers([...expandEntries(diff.onlyInB)])).toEqual(
        sortNumbers(expectedOnlyB),
      );
      expect(sortNumbers([...expandEntries(diff.common)])).toEqual(
        sortNumbers(expectedCommon),
      );
      expect(diff.identical).toBe(
        expectedOnlyA.length === 0 && expectedOnlyB.length === 0,
      );
      // isInZone must agree with the same expansion (one definition of coverage).
      const probe = Math.floor(random() * 100_000);
      const probeZip = String(probe).padStart(5, '0');
      expect(isInZone({...zone, postalCodes: a}, probeZip)).toBe(
        setA.has(probe),
      );
    }
  });
});

describe('cents guards (NFR-008)', () => {
  it.each([0, 1, 14900, Number.MAX_SAFE_INTEGER])('accepts %i', (value) => {
    expect(isValidCents(value)).toBe(true);
    expect(safeCents(value)).toBe(value);
  });

  it.each([
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    2 ** 60,
    '100',
    null,
    undefined,
  ])('rejects %j and reads it as zero', (value) => {
    expect(isValidCents(value)).toBe(false);
    expect(safeCents(value)).toBe(0);
  });
});
