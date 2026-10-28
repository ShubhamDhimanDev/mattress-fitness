import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffStore, sameFieldValue } from './map.mjs';
import { GOOD, sheet } from './test-helpers.mjs';
import { validateStoreSheet } from './validate.mjs';

const desired = () => {
  const report = validateStoreSheet(sheet([GOOD]));
  assert.ok(report.ok);
  return report.stores[0].fields;
};

test('a new entry sends every filled field and nothing blank', () => {
  const diff = diffStore(desired(), null);
  assert.deepEqual(diff.changed, ['slug', 'name', 'address_line_1', 'city', 'state', 'postal_code', 'latitude', 'longitude', 'phone', 'hours', 'time_zone', 'pickup_enabled', 'location_handle']);
  assert.equal(diff.send.find((field) => field.key === 'address_line_2'), undefined);
});

test('an existing identical entry sends nothing, even when Shopify formats values differently', () => {
  const existing = {
    ...desired(),
    latitude: '41.88640', // number_decimal as Shopify may print it
    hours: JSON.stringify({ Sun: 'Closed', Sat: '10am-6pm', 'Mon-Fri': '10:00 AM - 8:00 PM' }), // other key order
    pickup_enabled: 'True',
  };
  assert.deepEqual(diffStore(desired(), existing).changed, []);
});

test('only the differing fields are sent on update', () => {
  const diff = diffStore({ ...desired(), city: 'Elsewhere', phone: '(312) 555-0199' }, desired());
  assert.deepEqual(diff.changed, ['city', 'phone']);
});

test('a blank cell never erases an existing value, and is reported', () => {
  const wanted = desired();
  delete wanted.phone;
  const diff = diffStore(wanted, { ...desired(), photo: 'gid://x' });
  assert.deepEqual(diff.changed, []);
  assert.deepEqual(diff.leftAlone, ['phone']);
});

test('comparison rules per field', () => {
  assert.equal(sameFieldValue('latitude', '41.8', '41.80'), true);
  assert.equal(sameFieldValue('latitude', '41.8', ''), false);
  assert.equal(sameFieldValue('hours', '{"a":"1"}', 'not json'), false);
  assert.equal(sameFieldValue('city', 'A', ' A '), true);
  assert.equal(sameFieldValue('city', 'A', undefined), false);
});
