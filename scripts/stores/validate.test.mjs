import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COLUMN_KEYS } from './schema.mjs';
import { GOOD, sheet } from './test-helpers.mjs';
import { normalizeHours, normalizeUsPhone, renderReport, resolveState, validateStoreSheet } from './validate.mjs';

/** @param {Record<string, string>} change */
const row = (change) => ({ ...GOOD, ...change });

test('a valid row is normalised for Shopify', () => {
  const report = validateStoreSheet(sheet([GOOD]));
  assert.equal(report.ok, true, JSON.stringify(report.errors));
  const [store] = report.stores;
  assert.equal(store.handle, 'test-store-one');
  assert.equal(store.row, 2);
  assert.equal(store.fields.state, 'IL');
  assert.equal(store.fields.phone, '(312) 555-0101');
  assert.equal(store.fields.pickup_enabled, 'true');
  assert.equal(store.fields.latitude, '41.8864');
  assert.equal(store.fields.address_line_2, undefined, 'blank cells are not sent');
  assert.deepEqual(JSON.parse(store.fields.hours), { 'Mon-Fri': '10:00 AM - 8:00 PM', Sat: '10am-6pm', Sun: 'Closed' });
});

test('every problem is reported with its row number, not just the first', () => {
  const report = validateStoreSheet(sheet([
    row({ slug: 'a-store' }),
    row({ slug: 'Bad Slug', state: 'Atlantis', postal_code: '1234', phone: '123', time_zone: 'EST', hours: 'Mon 9-5', pickup_enabled: 'maybe', latitude: '95', longitude: '10', location_handle: 'Buffalo <Gallery>' }),
    row({ slug: 'a-store' }),
    row({ slug: 'third', name: '', city: '' }),
  ]));
  assert.equal(report.ok, false);
  assert.equal(report.stores.length, 0 + 1, 'only the valid first row survives');
  const at = (/** @type {number} */ n) => report.errors.filter((issue) => issue.row === n).map((issue) => issue.column);
  assert.deepEqual(at(3).sort(), ['hours', 'latitude', 'location_handle', 'phone', 'pickup_enabled', 'postal_code', 'slug', 'state', 'time_zone'].sort());
  assert.ok(report.errors.some((issue) => issue.row === 4 && issue.column === 'slug' && issue.message.includes('row 2')), 'duplicate slug names the first row');
  assert.deepEqual(at(5).sort(), ['city', 'name']);
});

test('required columns and unknown columns are checked on the header', () => {
  const missing = validateStoreSheet(sheet([GOOD], COLUMN_KEYS.filter((key) => key !== 'city' && key !== 'state')));
  assert.deepEqual(missing.errors.map((issue) => issue.column).sort(), ['city', 'state']);
  const unknown = validateStoreSheet(sheet([GOOD], [...COLUMN_KEYS, 'photo']));
  assert.ok(unknown.errors.some((issue) => issue.message.includes('Unknown column "photo"')));
  const twice = validateStoreSheet(sheet([GOOD], [...COLUMN_KEYS, 'city']));
  assert.ok(twice.errors.some((issue) => issue.message.includes('appears twice')));
});

test('empty, unreadable and row-less sheets fail with a clear error', () => {
  assert.equal(validateStoreSheet('').ok, false);
  assert.equal(validateStoreSheet('slug,name\n"unterminated').ok, false);
  const headerOnly = validateStoreSheet(`${COLUMN_KEYS.join(',')}\n`);
  assert.equal(headerOnly.ok, false);
  assert.match(headerOnly.errors[0].message, /no store rows/);
});

test('ZIP rules: exactly 5 digits, with a hint when a leading zero was lost', () => {
  const run = (/** @type {string} */ zip) => validateStoreSheet(sheet([row({ postal_code: zip })]));
  assert.equal(run('02108').ok, true);
  assert.match(run('2108').errors[0].message, /leading 0/);
  assert.match(run('60601-1234').errors[0].message, /5-digit/);
  assert.equal(run('ABCDE').ok, false);
});

test('state accepts a code or a name, case-insensitively', () => {
  assert.equal(resolveState('ny'), 'NY');
  assert.equal(resolveState('New York'), 'NY');
  assert.equal(resolveState('district of columbia'), 'DC');
  assert.equal(resolveState('PR'), null);
  assert.equal(resolveState('x'.repeat(50)), null);
});

test('phone matches the site: NANP 10 digits, no extensions, no letters', () => {
  assert.equal(normalizeUsPhone('212-555-0100'), '(212) 555-0100');
  assert.equal(normalizeUsPhone('+1 212 555 0100'), '(212) 555-0100');
  assert.equal(normalizeUsPhone('+44 212 555 0100'), null);
  assert.equal(normalizeUsPhone('(012) 555-0100'), null);
  assert.equal(normalizeUsPhone('212-555-0100 x5'), null);
  assert.equal(normalizeUsPhone('555-0100'), null);
});

test('coordinates: both or neither, in range, never 0,0', () => {
  const run = (/** @type {string} */ latitude, /** @type {string} */ longitude) => validateStoreSheet(sheet([row({ latitude, longitude })]));
  assert.equal(run('', '').ok, true);
  assert.ok(run('', '').warnings.some((issue) => issue.column === 'latitude'));
  assert.equal(run('41.8', '').ok, false);
  assert.equal(run('91', '10').ok, false);
  assert.equal(run('10', '-181').ok, false);
  assert.equal(run('0', '0').ok, false);
  assert.equal(run('41.8864', '-87.6186').stores[0].fields.longitude, '-87.6186');
});

test('hours: text becomes the JSON object the site reads; JSON is kept; bad hours fail', () => {
  const text = normalizeHours('Mon-Fri: 9am-5pm\nSat 10am-2pm\nSun closed');
  assert.deepEqual(text.problems, []);
  assert.deepEqual(JSON.parse(text.json ?? 'null'), { 'Mon-Fri': '9am-5pm', Sat: '10am-2pm', Sun: 'closed' });
  const json = normalizeHours('{ "Mon-Sun": "09:00-17:00" }');
  assert.equal(json.json, '{"Mon-Sun":"09:00-17:00"}');
  assert.equal(normalizeHours('Mon-Fri 9am-5pm; Mon-Fri 10am-4pm').json, null, 'the same day group twice');
  assert.equal(normalizeHours('Mon-Fri 9am-5pm; Wed 10am-4pm').json, null, 'Wednesday given twice');
  assert.equal(normalizeHours('9am-5pm').json, null, 'no day');
  assert.equal(normalizeHours('Mon-Fri').json, null, 'no hours');
  assert.equal(normalizeHours('[1, 2]').json, null);
  assert.equal(normalizeHours('x'.repeat(5000)).json, null);
  assert.match(normalizeHours('Mon-Fri 9am-5pm').notes[0], /Saturday|Sunday/);
});

test('notes: no time zone, no hours, pickup without a location', () => {
  const report = validateStoreSheet(sheet([row({ time_zone: '', location_handle: '' }), row({ slug: 'two', hours: '' })]));
  assert.equal(report.ok, true);
  const notes = report.warnings.map((issue) => `${issue.row}:${issue.column}`);
  assert.ok(notes.includes('2:time_zone'));
  assert.ok(notes.includes('2:location_handle'));
  assert.ok(notes.includes('3:hours'));
});

test('text fields: HTML, spreadsheet formulas, control characters and length', () => {
  const run = (/** @type {Record<string, string>} */ change) => validateStoreSheet(sheet([row(change)]));
  assert.equal(run({ name: '<b>Shop</b>' }).ok, false);
  assert.equal(run({ name: '=HYPERLINK("x")' }).ok, false);
  assert.equal(run({ city: 'Test\u0007ville' }).ok, false);
  assert.equal(run({ address_line_1: 'x'.repeat(121) }).ok, false);
});

test('the template\'s example row is refused on purpose, and is otherwise valid', () => {
  const template = readFileSync(new URL('./template/stores.csv', import.meta.url), 'utf8');
  const report = validateStoreSheet(template);
  assert.equal(report.ok, false);
  assert.equal(report.errors.length, 1, JSON.stringify(report.errors));
  assert.equal(report.errors[0].column, 'slug');
  assert.match(report.errors[0].message, /example row/);
  const fixed = validateStoreSheet(template.replace('example-store-delete-this-row', 'my-first-store'));
  assert.equal(fixed.ok, true, JSON.stringify(fixed.errors));
});

test('the same address twice is a note, rows with only blanks are ignored', () => {
  const blank = Object.fromEntries(COLUMN_KEYS.map((key) => [key, '']));
  const report = validateStoreSheet(sheet([GOOD, blank, row({ slug: 'second' })]));
  assert.equal(report.ok, true);
  assert.equal(report.stores.length, 2);
  assert.ok(report.warnings.some((issue) => issue.message.includes('Same address')));
});

test('the report text lists errors with rows and never claims a send', () => {
  const text = renderReport(validateStoreSheet(sheet([row({ state: 'Nope' })])));
  assert.match(text, /row 2 \[state\]/);
  assert.match(text, /Nothing was sent/);
});

test('a problem that repeats for every day is reported once', () => {
  assert.deepEqual(normalizeHours('daily 9am-1pm, 12pm-5pm').problems.length, 1);
});
