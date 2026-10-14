import {describe, expect, it} from 'vitest';
import {mulberry32} from '~/lib/catalog/test-helpers';
import {hasControlCharacter} from '~/lib/catalog/text';
import {
  DAY_NAMES,
  formatDayHours,
  formatInterval,
  formatMinutes,
  formatWeeklyHours,
  isOpenNow,
  isValidTimeZone,
  openStatus,
  parseDaySelector,
  parseWeeklyHours,
  todaysHours,
} from '~/lib/stores/hours';
import type {DayHours, WeeklyHours} from '~/lib/stores/types';

const CHICAGO = 'America/Chicago';

function hoursFrom(raw: unknown): WeeklyHours {
  const result = parseWeeklyHours(raw);
  if (!result.hours)
    throw new Error(`hours did not parse: ${result.warnings.join(' | ')}`);
  return result.hours;
}

const STANDARD = hoursFrom(
  'Mon-Fri 10:00 AM - 9:00 PM; Sat 10am-6pm; Sun Closed',
);
const standardStore = {hours: STANDARD};

// 2026-10-12 is a Monday. Chicago is on CDT (UTC-5) until 2026-11-01, then CST (UTC-6).
const chicago = (iso: string) => Date.parse(iso);

describe('parsing weekly hours (REQ-LOC-001)', () => {
  const standardDays = [
    [],
    [600, 1260],
    [600, 1260],
    [600, 1260],
    [600, 1260],
    [600, 1260],
    [600, 1080],
  ];

  function shape(hours: WeeklyHours) {
    return hours.map((day) =>
      day.flatMap((i) => [i.openMinutes, i.closeMinutes]),
    );
  }

  it('reads the text form', () => {
    const result = parseWeeklyHours(
      'Mon-Fri 10:00 AM - 9:00 PM; Sat 10am-6pm; Sun Closed',
    );
    expect(result.warnings).toEqual([]);
    expect(result.hours && shape(result.hours)).toEqual(standardDays);
  });

  it.each([
    [
      'one line per group',
      'Mon-Fri 10:00 AM - 9:00 PM\nSat 10am-6pm\nSun Closed',
    ],
    [
      'pipes and different dashes',
      'Mon–Fri: 10:00 AM – 9:00 PM | Sat: 10 AM to 6 PM | Sun: closed'.replace(
        '10 AM to 6 PM',
        '10am to 6pm',
      ),
    ],
    ['24-hour clock', 'Mon-Fri 10:00-21:00; Sat 10:00-18:00; Sun closed'],
    [
      'full day names and a day list',
      'Monday, Tuesday, Wednesday, Thursday, Friday 10:00am-9:00pm; Saturday 10:00am-6:00pm; Sunday closed',
    ],
    [
      'mixed case and dots',
      'MON - FRI 10:00 a.m. - 9:00 p.m.; sat 10:00 A.M. - 6:00 P.M.; Sun: CLOSED',
    ],
    [
      'JSON object',
      '{"Mon-Fri":"10:00-21:00","Sat":"10:00 AM - 6:00 PM","Sun":"closed"}',
    ],
    ['parsed JSON object', {'Mon-Fri': '10am-9pm', Sat: '10am-6pm', Sun: null}],
    [
      'JSON object with nested hours',
      {hours: {'Mon-Fri': '10am-9pm', Sat: '10am-6pm', Sun: 'closed'}},
    ],
    [
      'object values as {open, close}',
      {
        'Mon-Fri': {open: '10:00', close: '21:00'},
        Sat: {open: '10:00', close: '18:00'},
        Sun: {closed: true},
      },
    ],
    [
      'list of entries',
      [
        {day: 'Mon-Fri', open: '10:00 AM', close: '9:00 PM'},
        {day: 'Sat', hours: '10am-6pm'},
        {days: ['Sun'], closed: true},
      ],
    ],
    ['list of text lines', ['Mon-Fri 10am-9pm', 'Sat 10am-6pm', 'Sun closed']],
  ])('reads %s the same way', (_name, raw) => {
    const result = parseWeeklyHours(raw);
    expect(result.hours && shape(result.hours)).toEqual(standardDays);
  });

  it('understands day words and ranges that wrap the week', () => {
    expect(parseDaySelector('Mon-Fri')).toEqual([1, 2, 3, 4, 5]);
    expect(parseDaySelector('Fri-Mon')).toEqual([0, 1, 5, 6]);
    expect(parseDaySelector('weekdays')).toEqual([1, 2, 3, 4, 5]);
    expect(parseDaySelector('Weekends')).toEqual([0, 6]);
    expect(parseDaySelector('daily')).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(parseDaySelector('Sat & Sun')).toEqual([0, 6]);
    expect(parseDaySelector('Tues thru Thurs')).toEqual([2, 3, 4]);
    expect(parseDaySelector('Mon to Wed')).toEqual([1, 2, 3]);
  });

  it.each([
    [''],
    ['Funday'],
    ['Mon-Funday'],
    ['Mon-Tue-Wed'],
    ['12'],
    ['<b>Mon</b>'],
  ])('rejects the day text %j', (text) => {
    expect(parseDaySelector(text)).toBeNull();
  });

  it('reads overnight hours as belonging to the day they start', () => {
    const hours = hoursFrom('Fri 6pm-2am; Mon-Thu 10am-9pm');
    expect(hours[5]).toEqual([{openMinutes: 1080, closeMinutes: 1560}]);
  });

  it('reads midnight and noon words, "12 AM" and 24:00', () => {
    expect(hoursFrom('Mon noon-midnight')[1]).toEqual([
      {openMinutes: 720, closeMinutes: 1440},
    ]);
    expect(hoursFrom('Mon 10am-12am')[1]).toEqual([
      {openMinutes: 600, closeMinutes: 1440},
    ]);
    expect(hoursFrom('Mon 12pm-12am')[1]).toEqual([
      {openMinutes: 720, closeMinutes: 1440},
    ]);
    expect(hoursFrom('Mon 9:00-24:00')[1]).toEqual([
      {openMinutes: 540, closeMinutes: 1440},
    ]);
    expect(hoursFrom('Mon 12:00 AM - 10:00 AM')[1]).toEqual([
      {openMinutes: 0, closeMinutes: 600},
    ]);
  });

  it('reads open 24 hours and split days', () => {
    expect(hoursFrom('Sat Open 24 hours')[6]).toEqual([
      {openMinutes: 0, closeMinutes: 1440},
    ]);
    expect(hoursFrom('Sat 24/7')[6]).toEqual([
      {openMinutes: 0, closeMinutes: 1440},
    ]);
    expect(hoursFrom('Sat 9am-12pm, 1pm-5pm')[6]).toEqual([
      {openMinutes: 540, closeMinutes: 720},
      {openMinutes: 780, closeMinutes: 1020},
    ]);
  });

  it('treats days that are not mentioned as closed and says so', () => {
    const result = parseWeeklyHours('Mon-Fri 9am-5pm');
    expect(result.hours?.[0]).toEqual([]);
    expect(result.hours?.[6]).toEqual([]);
    expect(result.warnings).toEqual([
      'No hours given for Sunday, Saturday; shown as closed.',
    ]);
  });

  it('lets a later entry override an earlier one for the same day, with a warning', () => {
    const result = parseWeeklyHours(
      'Mon-Fri 9am-5pm; Wed 10am-4pm; Sat closed; Sun closed',
    );
    expect(result.hours?.[3]).toEqual([{openMinutes: 600, closeMinutes: 960}]);
    expect(result.warnings).toEqual([
      'Wednesday is given more than once; the later entry is used.',
    ]);
  });

  it('sorts times within a day and drops an overlapping one', () => {
    const result = parseWeeklyHours('Mon 1pm-5pm, 9am-2pm; Tue-Sun closed');
    // Sorted by opening time: 9am-2pm stays, 1pm-5pm overlaps it and is dropped.
    expect(result.hours?.[1]).toEqual([{openMinutes: 540, closeMinutes: 840}]);
    expect(result.warnings).toContain(
      'Two opening times overlap; the later one was ignored.',
    );
  });

  describe('invalid hours never throw: the entry is skipped and reported', () => {
    it.each([
      ['a bare hour with no am or pm', 'Mon-Fri 9-5'],
      ['an hour without minutes on a 24-hour clock', 'Mon 09-17'],
      ['an impossible time', 'Mon 25:00-26:00'],
      ['minutes above 59', 'Mon 9:75am-5pm'],
      ['hour 13 with pm', 'Mon 13pm-5pm'],
      ['hour 0 with am', 'Mon 0am-5pm'],
      ['the same open and close', 'Mon 10:00-10:00'],
      ['a likely AM/PM typo (20 hours overnight)', 'Mon 9:00-5:00'],
      ['an opening time of 24:00', 'Mon 24:00-10:00'],
      ['a missing close', 'Mon 9am-'],
      ['three times', 'Mon 9am-5pm-7pm'],
      ['hours with no days', '9am-5pm'],
      ['days with no hours', 'Mon-Fri'],
      ['words', 'Monday open sometimes'],
    ])('%s', (_name, raw) => {
      const result = parseWeeklyHours(raw);
      expect(result.hours).toBeNull();
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('keeps the good lines when others are bad', () => {
      const result = parseWeeklyHours('Mon 9am-5pm; Tue 9-5; Wed-Sun closed');
      expect(result.hours?.[1]).toEqual([
        {openMinutes: 540, closeMinutes: 1020},
      ]);
      expect(result.hours?.[2]).toEqual([]);
      expect(
        result.warnings.some((w) => w.includes('not a readable time range')),
      ).toBe(true);
    });

    it.each([[null], [undefined], ['']])(
      'treats %j as no hours given, without a warning',
      (raw) => {
        expect(parseWeeklyHours(raw)).toEqual({hours: null, warnings: []});
      },
    );

    it.each([
      [42],
      [true],
      [[]],
      [{}],
      ['{broken'],
      ['[1, 2, 3]'],
      ['{"Mon": 5}'],
      ['{"Funday": "9am-5pm"}'],
      [[{day: 'Mon'}]],
      [[{open: '9:00', close: '17:00'}]],
      [['<script>alert(1)</script>']],
      ['x'.repeat(5000)],
      [Symbol('x')],
    ])('returns no hours for %j', (raw) => {
      const result = parseWeeklyHours(raw);
      expect(result.hours).toBeNull();
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('survives input whose properties throw', () => {
      const hostile = new Proxy(
        {},
        {
          ownKeys() {
            throw new Error('boom');
          },
          get() {
            throw new Error('boom');
          },
        },
      );
      const result = parseWeeklyHours(hostile);
      expect(result.hours).toBeNull();
      expect(JSON.stringify(result.warnings)).not.toContain('boom');
    });

    it('keeps markup and control characters out of warnings', () => {
      const result = parseWeeklyHours(
        '<img src=x onerror=alert(1)> 9-5\u0000; Mon <b>9-5</b>',
      );
      const text = result.warnings.join(' ');
      expect(text).not.toContain('<');
      expect(text).not.toContain('>');
      expect(hasControlCharacter(text)).toBe(false);
      expect(text.length).toBeLessThan(400);
    });

    it('only reads a bounded number of entries', () => {
      const lines = Array.from({length: 250}, () => 'Mon 9am-5pm').join('\n');
      expect(parseWeeklyHours(lines).hours).not.toBeNull();
      const result = parseWeeklyHours(
        Object.fromEntries(
          Array.from({length: 5000}, (_, i) => [`Mon${i}`, '9am-5pm']),
        ),
      );
      expect(result.hours).toBeNull();
    });
  });

  describe('property: formatted hours read back as the same hours', () => {
    function randomDay(random: () => number): DayHours {
      const kind = Math.floor(random() * 5);
      if (kind === 0) return [];
      if (kind === 1) return [{openMinutes: 0, closeMinutes: 1440}];
      const open = Math.floor(random() * 48) * 30;
      const length = (1 + Math.floor(random() * 30)) * 30; // 30 minutes to 15 hours
      if (kind === 2 || open + length > 1380)
        return [{openMinutes: open, closeMinutes: open + length}];
      // Two separate times in one day.
      const secondOpen = open + length + 30;
      const secondLength = 30 * (1 + Math.floor(random() * 8));
      return secondOpen + secondLength <= 1440
        ? [
            {openMinutes: open, closeMinutes: open + length},
            {openMinutes: secondOpen, closeMinutes: secondOpen + secondLength},
          ]
        : [{openMinutes: open, closeMinutes: open + length}];
    }

    it('holds for 300 random weeks (text form, one line per day)', () => {
      const random = mulberry32(31);
      for (let run = 0; run < 300; run += 1) {
        const days = Array.from({length: 7}, () => randomDay(random));
        const text = days
          .map((day, index) => `${DAY_NAMES[index]}: ${formatDayHours(day)}`)
          .join('\n');
        const parsed = parseWeeklyHours(text);
        expect(parsed.warnings, text).toEqual([]);
        expect(parsed.hours, text).toEqual(days);
      }
    });
  });
});

describe('formatting hours (REQ-LOC-001)', () => {
  it.each([
    [0, '12:00 AM'],
    [60, '1:00 AM'],
    [600, '10:00 AM'],
    [720, '12:00 PM'],
    [780, '1:00 PM'],
    [1260, '9:00 PM'],
    [1439, '11:59 PM'],
    [1440, '12:00 AM'],
    [1560, '2:00 AM'],
  ])('formatMinutes(%i) = %s', (minutes, expected) => {
    expect(formatMinutes(minutes)).toBe(expected);
  });

  it('formats intervals and days', () => {
    expect(formatInterval({openMinutes: 600, closeMinutes: 1260})).toBe(
      '10:00 AM – 9:00 PM',
    );
    expect(formatInterval({openMinutes: 1080, closeMinutes: 1560})).toBe(
      '6:00 PM – 2:00 AM',
    );
    expect(formatInterval({openMinutes: 0, closeMinutes: 1440})).toBe(
      'Open 24 hours',
    );
    expect(formatDayHours([])).toBe('Closed');
    expect(
      formatDayHours([
        {openMinutes: 540, closeMinutes: 720},
        {openMinutes: 780, closeMinutes: 1020},
      ]),
    ).toBe('9:00 AM – 12:00 PM, 1:00 PM – 5:00 PM');
  });

  it('lists the week Monday first', () => {
    const rows = formatWeeklyHours(STANDARD);
    expect(rows.map((r) => r.day)).toEqual([
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ]);
    expect(rows[0]).toEqual({
      dayIndex: 1,
      day: 'Monday',
      text: '10:00 AM – 9:00 PM',
      closed: false,
    });
    expect(rows[5]?.text).toBe('10:00 AM – 6:00 PM');
    expect(rows[6]).toEqual({
      dayIndex: 0,
      day: 'Sunday',
      text: 'Closed',
      closed: true,
    });
  });
});

describe('is the store open now (REQ-LOC-001)', () => {
  // Each row: instant (ISO, UTC), Chicago local time for reference, expected status.
  it.each([
    ['2026-10-12T14:59:00Z', 'Mon 09:59 CDT', 'closed'],
    ['2026-10-12T15:00:00Z', 'Mon 10:00 CDT (opening minute)', 'open'],
    ['2026-10-12T19:30:00Z', 'Mon 14:30 CDT', 'open'],
    ['2026-10-13T01:59:00Z', 'Mon 20:59 CDT', 'open'],
    ['2026-10-13T02:00:00Z', 'Mon 21:00 CDT (closing minute)', 'closed'],
    ['2026-10-17T22:59:00Z', 'Sat 17:59 CDT', 'open'],
    ['2026-10-17T23:00:00Z', 'Sat 18:00 CDT', 'closed'],
    ['2026-10-18T17:00:00Z', 'Sun 12:00 CDT (closed day)', 'closed'],
    ['2026-10-18T05:30:00Z', 'Sun 00:30 CDT', 'closed'],
  ])('%s is %s -> %s', (iso, _local, expected) => {
    expect(openStatus(standardStore, chicago(iso), CHICAGO).status).toBe(
      expected,
    );
    expect(isOpenNow(standardStore, chicago(iso), CHICAGO)).toBe(
      expected === 'open',
    );
  });

  it('reports when it closes and how long is left', () => {
    expect(
      openStatus(standardStore, chicago('2026-10-12T19:30:00Z'), CHICAGO),
    ).toEqual({
      status: 'open',
      closesAt: '9:00 PM',
      minutesUntilClose: 390,
    });
    expect(
      openStatus(standardStore, chicago('2026-10-13T01:59:00Z'), CHICAGO),
    ).toMatchObject({minutesUntilClose: 1});
  });

  it('reports when it opens next: today, tomorrow or a named day', () => {
    expect(
      openStatus(standardStore, chicago('2026-10-12T14:00:00Z'), CHICAGO),
    ).toEqual({
      status: 'closed',
      next: {dayIndex: 1, dayLabel: 'today', opensAt: '10:00 AM'},
    });
    expect(
      openStatus(standardStore, chicago('2026-10-13T03:00:00Z'), CHICAGO),
    ).toEqual({
      status: 'closed',
      next: {dayIndex: 2, dayLabel: 'tomorrow', opensAt: '10:00 AM'},
    });
    // Saturday evening: Sunday is closed, so the next opening is Monday.
    expect(
      openStatus(standardStore, chicago('2026-10-18T01:00:00Z'), CHICAGO),
    ).toEqual({
      status: 'closed',
      next: {dayIndex: 1, dayLabel: 'Monday', opensAt: '10:00 AM'},
    });
  });

  it('is closed with no next opening when the store is closed all week', () => {
    const never = {hours: hoursFrom('Mon-Sun closed')};
    expect(openStatus(never, chicago('2026-10-12T19:30:00Z'), CHICAGO)).toEqual(
      {status: 'closed', next: null},
    );
  });

  it('answers in the zone it is given: the same instant is a different local time elsewhere', () => {
    const instant = chicago('2026-10-12T15:00:00Z'); // 10:00 in Chicago
    expect(isOpenNow(standardStore, instant, 'America/Chicago')).toBe(true);
    expect(isOpenNow(standardStore, instant, 'America/New_York')).toBe(true); // 11:00
    expect(isOpenNow(standardStore, instant, 'America/Los_Angeles')).toBe(
      false,
    ); // 08:00
    expect(isOpenNow(standardStore, instant, 'Pacific/Honolulu')).toBe(false); // 05:00
    // Late Monday UTC is already early Tuesday morning in Tokyo.
    expect(
      isOpenNow(standardStore, chicago('2026-10-12T20:00:00Z'), 'Asia/Tokyo'),
    ).toBe(false); // Tue 05:00
  });

  it('follows daylight saving time: Chicago moves from UTC-5 to UTC-6 on 1 November 2026', () => {
    expect(
      isOpenNow(standardStore, chicago('2026-10-31T15:00:00Z'), CHICAGO),
    ).toBe(true); // Sat 10:00 CDT
    expect(
      isOpenNow(standardStore, chicago('2026-10-31T14:59:00Z'), CHICAGO),
    ).toBe(false);
    expect(
      isOpenNow(standardStore, chicago('2026-11-02T16:00:00Z'), CHICAGO),
    ).toBe(true); // Mon 10:00 CST
    expect(
      isOpenNow(standardStore, chicago('2026-11-02T15:59:00Z'), CHICAGO),
    ).toBe(false); // Mon 09:59 CST
    // Spring forward: Sunday 8 March 2026, 02:00 CST becomes 03:00 CDT.
    expect(
      isOpenNow(standardStore, chicago('2026-03-09T15:00:00Z'), CHICAGO),
    ).toBe(true); // Mon 10:00 CDT
    expect(
      isOpenNow(standardStore, chicago('2026-03-09T14:59:00Z'), CHICAGO),
    ).toBe(false);
  });

  describe('overnight hours', () => {
    const nightclubStyle = {
      hours: hoursFrom(
        'Fri 6pm-2am; Sat 6pm-2am; Mon-Thu 10am-9pm; Sun closed',
      ),
    };

    it.each([
      ['2026-10-16T22:59:00Z', 'Fri 17:59 CDT', 'closed'],
      ['2026-10-16T23:00:00Z', 'Fri 18:00 CDT', 'open'],
      ['2026-10-17T04:59:00Z', 'Fri 23:59 CDT', 'open'],
      [
        '2026-10-17T05:00:00Z',
        'Sat 00:00 CDT (after midnight, still Friday hours)',
        'open',
      ],
      ['2026-10-17T06:59:00Z', 'Sat 01:59 CDT', 'open'],
      ['2026-10-17T07:00:00Z', 'Sat 02:00 CDT (closing time)', 'closed'],
      ['2026-10-17T23:00:00Z', 'Sat 18:00 CDT', 'open'],
      [
        '2026-10-18T06:30:00Z',
        'Sun 01:30 CDT (Saturday hours carry over)',
        'open',
      ],
      ['2026-10-18T07:00:00Z', 'Sun 02:00 CDT', 'closed'],
      ['2026-10-19T05:30:00Z', 'Mon 00:30 CDT (Sunday is closed)', 'closed'],
      ['2026-10-13T05:30:00Z', 'Tue 00:30 CDT (Monday ends at 9 PM)', 'closed'],
    ])('%s %s -> %s', (iso, _local, expected) => {
      expect(openStatus(nightclubStyle, chicago(iso), CHICAGO).status).toBe(
        expected,
      );
    });

    it('reports the early-morning closing time and minutes left', () => {
      expect(
        openStatus(nightclubStyle, chicago('2026-10-17T06:00:00Z'), CHICAGO),
      ).toEqual({
        status: 'open',
        closesAt: '2:00 AM',
        minutesUntilClose: 60,
      });
    });

    it('a midnight close ends exactly at midnight', () => {
      const midnight = {hours: hoursFrom('Mon 10am-12am; Tue-Sun closed')};
      expect(
        isOpenNow(midnight, chicago('2026-10-13T04:59:00Z'), CHICAGO),
      ).toBe(true); // Mon 23:59
      expect(
        isOpenNow(midnight, chicago('2026-10-13T05:00:00Z'), CHICAGO),
      ).toBe(false); // Tue 00:00
      expect(
        openStatus(midnight, chicago('2026-10-13T04:00:00Z'), CHICAGO),
      ).toMatchObject({closesAt: '12:00 AM'});
    });
  });

  it('open 24 hours is open at every minute of that day', () => {
    const always = {hours: hoursFrom('Sat Open 24 hours; Sun-Fri closed')};
    expect(isOpenNow(always, chicago('2026-10-17T05:00:00Z'), CHICAGO)).toBe(
      true,
    ); // Sat 00:00
    expect(isOpenNow(always, chicago('2026-10-18T04:59:00Z'), CHICAGO)).toBe(
      true,
    ); // Sat 23:59
    expect(isOpenNow(always, chicago('2026-10-18T05:00:00Z'), CHICAGO)).toBe(
      false,
    ); // Sun 00:00
  });

  it('split days are closed between the two times', () => {
    const split = {hours: hoursFrom('Mon 9am-12pm, 1pm-5pm; Tue-Sun closed')};
    expect(isOpenNow(split, chicago('2026-10-12T16:30:00Z'), CHICAGO)).toBe(
      true,
    ); // 11:30 CDT
    expect(isOpenNow(split, chicago('2026-10-12T17:30:00Z'), CHICAGO)).toBe(
      false,
    ); // 12:30 CDT, break
    expect(isOpenNow(split, chicago('2026-10-12T18:30:00Z'), CHICAGO)).toBe(
      true,
    ); // 13:30 CDT
  });

  describe('unknown is never reported as open', () => {
    it.each([
      ['no hours published', {hours: null}, CHICAGO, 1_760_000_000_000],
      [
        'an unknown time zone',
        standardStore,
        'Mars/Olympus',
        1_760_000_000_000,
      ],
      ['an empty time zone', standardStore, '', 1_760_000_000_000],
      [
        'a hostile time zone',
        standardStore,
        '../../etc/passwd',
        1_760_000_000_000,
      ],
      [
        'a very long time zone',
        standardStore,
        'America/'.padEnd(100, 'x'),
        1_760_000_000_000,
      ],
      ['a NaN clock', standardStore, CHICAGO, Number.NaN],
      ['an out of range clock', standardStore, CHICAGO, 9e15],
      ['an infinite clock', standardStore, CHICAGO, Number.POSITIVE_INFINITY],
    ])('%s', (_name, store, zone, now) => {
      expect(openStatus(store, now, zone)).toEqual({status: 'unknown'});
      expect(isOpenNow(store, now, zone)).toBe(false);
    });

    it('accepts a Date as well as epoch milliseconds', () => {
      expect(
        isOpenNow(standardStore, new Date('2026-10-12T19:30:00Z'), CHICAGO),
      ).toBe(true);
      expect(isOpenNow(standardStore, new Date('nope'), CHICAGO)).toBe(false);
    });
  });
});

describe("today's hours (REQ-LOC-001)", () => {
  it.each([
    [
      '2026-10-12T19:30:00Z',
      {status: 'hours', dayIndex: 1, day: 'Monday', text: '10:00 AM – 9:00 PM'},
    ],
    [
      '2026-10-17T19:30:00Z',
      {
        status: 'hours',
        dayIndex: 6,
        day: 'Saturday',
        text: '10:00 AM – 6:00 PM',
      },
    ],
    [
      '2026-10-18T19:30:00Z',
      {
        status: 'closed_today',
        dayIndex: 0,
        day: 'Sunday',
        text: 'Closed today',
      },
    ],
  ])('%s', (iso, expected) => {
    expect(todaysHours(standardStore, chicago(iso), CHICAGO)).toEqual(expected);
  });

  it('uses the store day, not the shopper day', () => {
    // 02:00Z Tuesday is still Monday evening in Chicago.
    expect(
      todaysHours(standardStore, chicago('2026-10-13T02:30:00Z'), CHICAGO),
    ).toMatchObject({day: 'Monday'});
    expect(
      todaysHours(standardStore, chicago('2026-10-13T02:30:00Z'), 'Asia/Tokyo'),
    ).toMatchObject({day: 'Tuesday'});
  });

  it('says hours are not available when unknown', () => {
    const unknown = {status: 'unknown', text: 'Hours not available'};
    expect(
      todaysHours({hours: null}, chicago('2026-10-12T19:30:00Z'), CHICAGO),
    ).toEqual(unknown);
    expect(
      todaysHours(
        standardStore,
        chicago('2026-10-12T19:30:00Z'),
        'Nowhere/Land',
      ),
    ).toEqual(unknown);
  });
});

describe('time zone validation', () => {
  it.each([
    ['America/Chicago', true],
    ['UTC', true],
    ['America/Argentina/Buenos_Aires', true],
    ['Mars/Olympus', false],
    ['', false],
    ['chicago', false],
    ['America/Chicago; DROP', false],
    ['A/B/C/D', false],
  ])('%j -> %s', (zone, expected) => {
    expect(isValidTimeZone(zone)).toBe(expected);
  });
});
