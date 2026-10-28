// The hours port must read what the website reads (storefront/app/lib/stores/hours.ts). These cases are taken from the
// formats documented there; if hours.ts changes, extend them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidTimeZone, parseDaySelector, parseWeeklyHours, splitTextLine } from './hours.mjs';

const MON_FRI = [1, 2, 3, 4, 5];

test('day selectors: ranges, lists, wrap-around and words', () => {
  assert.deepEqual(parseDaySelector('Mon-Fri'), MON_FRI);
  assert.deepEqual(parseDaySelector('Mon–Fri'), MON_FRI);
  assert.deepEqual(parseDaySelector('Sat, Sun'), [0, 6]);
  assert.deepEqual(parseDaySelector('Fri-Mon'), [0, 1, 5, 6]);
  assert.deepEqual(parseDaySelector('weekdays'), MON_FRI);
  assert.deepEqual(parseDaySelector('Monday through Friday'), MON_FRI);
  assert.equal(parseDaySelector('daily')?.length, 7);
  assert.equal(parseDaySelector('Funday'), null);
  assert.equal(parseDaySelector(''), null);
});

test('text form: ranges, 24-hour times, Closed, several intervals and overnight', () => {
  const result = parseWeeklyHours('Mon-Fri 10:00 AM - 9:00 PM; Sat 10am-6pm; Sun Closed');
  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.missingDays, []);
  assert.deepEqual(result.hours?.[1], [{ openMinutes: 600, closeMinutes: 1260 }]);
  assert.deepEqual(result.hours?.[6], [{ openMinutes: 600, closeMinutes: 1080 }]);
  assert.deepEqual(result.hours?.[0], []);

  assert.deepEqual(parseWeeklyHours('daily 09:00-17:00').hours?.[3], [{ openMinutes: 540, closeMinutes: 1020 }]);
  assert.deepEqual(parseWeeklyHours('daily 9am-12pm, 1pm-5pm').hours?.[3]?.length, 2);
  assert.deepEqual(parseWeeklyHours('daily 6pm-2am').hours?.[2], [{ openMinutes: 1080, closeMinutes: 1560 }]);
  assert.deepEqual(parseWeeklyHours('daily open 24 hours').hours?.[2], [{ openMinutes: 0, closeMinutes: 1440 }]);
});

test('object and list forms are read the same way', () => {
  const object = parseWeeklyHours('{"Mon-Fri": "10:00-20:00", "Sat": "10:00-18:00", "Sun": "closed"}');
  const text = parseWeeklyHours('Mon-Fri 10:00-20:00; Sat 10:00-18:00; Sun closed');
  assert.deepEqual(object.hours, text.hours);
  const list = parseWeeklyHours('[{"day": "Mon", "open": "10:00", "close": "21:00"}]');
  assert.deepEqual(list.hours?.[1], [{ openMinutes: 600, closeMinutes: 1260 }]);
  assert.equal(list.missingDays.length, 6);
});

test('problems the site would drop are reported, not hidden', () => {
  assert.ok(parseWeeklyHours('Mon 9-5').problems.length > 0, 'a bare "9-5" is ambiguous');
  assert.ok(parseWeeklyHours('Mon 9am-9am').problems.length > 0);
  assert.ok(parseWeeklyHours('Mon 9am-10pm-11pm').problems.length > 0);
  assert.ok(parseWeeklyHours('Mon 10am-8pm; Mon-Tue 9am-5pm').problems.some((problem) => problem.includes('more than once')));
  assert.ok(parseWeeklyHours('daily 9am-1pm, 12pm-5pm').problems.some((problem) => problem.includes('overlap')));
  assert.ok(parseWeeklyHours('daily 9am-8am').problems.some((problem) => problem.includes('16 hours')));
  assert.ok(parseWeeklyHours('Someday 9am-5pm').problems.length > 0);
  assert.ok(parseWeeklyHours('{not json').problems.length > 0 || parseWeeklyHours('{not json').hours === null);
  assert.equal(parseWeeklyHours('').hours, null);
});

test('days not mentioned are notes, not problems', () => {
  const result = parseWeeklyHours('Mon-Fri 9am-5pm');
  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.missingDays, ['Sunday', 'Saturday']);
});

test('splitTextLine separates the day part from the hours', () => {
  assert.deepEqual(splitTextLine('Mon-Fri: 10am-6pm'), { dayPart: 'Mon-Fri', hoursPart: '10am-6pm' });
  assert.deepEqual(splitTextLine('Sun Closed'), { dayPart: 'Sun', hoursPart: 'Closed' });
  assert.equal(splitTextLine('Monday'), null);
});

test('time zones: IANA names only', () => {
  for (const zone of ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Indiana/Indianapolis', 'UTC']) {
    assert.equal(isValidTimeZone(zone), true, zone);
  }
  for (const zone of ['EST', 'Central', 'america/chicago', 'America/Nowhere', 'America/', '', 'America Chicago', '../etc/passwd', 'GMT+5']) {
    assert.equal(isValidTimeZone(zone), false, zone);
  }
});
