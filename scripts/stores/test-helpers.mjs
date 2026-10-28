// TEST SUPPORT ONLY: made-up rows and a sheet builder shared by the unit tests. Not used by the tools.
import { stringifyCsv } from '../catalog/csv.mjs';
import { COLUMN_KEYS } from './schema.mjs';

/** A fully valid, made-up row. */
export const GOOD = Object.freeze({
  slug: 'test-store-one', name: 'Test Store One', address_line_1: '1 Test Road', address_line_2: '', city: 'Testville', state: 'il', postal_code: '60601',
  latitude: '41.8864', longitude: '-87.6186', phone: '312-555-0101', hours: 'Mon-Fri 10:00 AM - 8:00 PM; Sat 10am-6pm; Sun Closed',
  time_zone: 'America/Chicago', pickup_enabled: 'yes', location_handle: 'test-store-one',
});

/** @param {Record<string, string>[]} rows @param {string[]} [columns] */
export function sheet(rows, columns = [...COLUMN_KEYS]) {
  return stringifyCsv([columns, ...rows.map((row) => columns.map((column) => row[column] ?? ''))]);
}
