import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL_DELIVERY_MAX_CHARACTERS, checkParity, compressRanges, expandCoverage, findPostalCodeValues, flattenValue, main, parseTokens, renderParityReport } from './check-delivery-parity.mjs';

const zone = (/** @type {string} */ codes) => ({ fields: [{ key: 'name', value: 'Zone' }, { key: 'postal_codes', value: codes }] });
const local = (/** @type {string} */ codes) => ({ postal_codes: codes });
const explicit = (/** @type {number} */ from, /** @type {number} */ to) => Array.from({ length: to - from + 1 }, (_, i) => String(from + i).padStart(5, '0')).join(',');

test('identical lists have parity', () => {
  const report = checkParity({ zoneJson: zone('10001, 10002, 10003'), localJson: local('10003,10002,10001') });
  assert.equal(report.ok, true);
  assert.deepEqual([report.onlyInZone, report.onlyInLocal], [[], []]);
});

test('a wildcard and the explicit codes it stands for are the same coverage (with a note, not a failure)', () => {
  const report = checkParity({ zoneJson: zone('100*'), localJson: local(explicit(10000, 10099)) });
  assert.equal(report.ok, true, renderParityReport(report));
  assert.match(report.notes.join(' '), /written differently/);
  assert.equal(report.sides.zone.covered, 100);
});

test('a one-digit wildcard covers ten thousand codes', () => {
  const report = checkParity({ zoneJson: zone('1*'), localJson: local('10*,11*,12*,13*,14*,15*,16*,17*,18*,19*') });
  assert.equal(report.ok, true);
  assert.equal(report.sides.zone.covered, 10_000);
});

test('drift in both directions is reported as ranges and the check fails', () => {
  const report = checkParity({ zoneJson: zone('10001,10002,10003,10010'), localJson: local('10002,10003,10099') });
  assert.equal(report.ok, false);
  assert.deepEqual(report.onlyInZone, ['10001', '10010']);
  assert.deepEqual(report.onlyInLocal, ['10099']);
  const text = renderParityReport(report);
  assert.match(text, /PARITY FAILED/);
  assert.match(text, /Only in the delivery zone \(add to Local delivery\): 10001, 10010/);
  assert.match(text, /Only in Local delivery \(add to the delivery zone\): 10099/);
});

test('a wildcard that is only partly covered names the wildcard and the missing range', () => {
  const report = checkParity({ zoneJson: zone('10*'), localJson: local('100*,101*,102*,103*,104*,105*,106*,107*,108*') });
  assert.equal(report.ok, false);
  assert.deepEqual(report.onlyInZone, ['10900-10999']);
  assert.deepEqual(report.zoneTokensNotInLocal, ['10*']);
});

test('leading zeros are kept in reports', () => {
  const report = checkParity({ zoneJson: zone('02134,02135'), localJson: local('02134') });
  assert.deepEqual(report.onlyInZone, ['02135']);
});

test('compressRanges merges consecutive codes and pads to five digits', () => {
  assert.deepEqual(compressRanges([1, 2, 3, 10, 12, 13]), ['00001-00003', '00010', '00012-00013']);
  assert.deepEqual(compressRanges([]), []);
});

test('list separators can be commas, spaces, semicolons or new lines; ZIP+4 is reduced to the five-digit code', () => {
  assert.deepEqual(flattenValue('10001; 10002\n10003 ,10004').items, ['10001', '10002', '10003', '10004']);
  const parsed = parseTokens(['10001-1234', '10002']);
  assert.deepEqual(parsed.invalid, []);
  assert.deepEqual(parsed.tokens.map((token) => token.text), ['10001', '10002']);
  const report = checkParity({ zoneJson: zone('10001\n10002'), localJson: local('10001-1234 10002') });
  assert.equal(report.ok, true);
});

test('invalid entries are errors with helpful hints, never silently dropped', () => {
  const report = checkParity({ zoneJson: zone('1000, 10001-10010, ABCDE, 12*3, 100000'), localJson: local('10001') });
  assert.equal(report.ok, false);
  const errors = report.errors.join('\n');
  assert.match(errors, /"1000" is not a 5-digit ZIP.*leading zero may have been lost/);
  assert.match(errors, /"ABCDE"/);
  assert.match(errors, /"12\*3"/);
  assert.match(errors, /"100000"/);
});

test('the Local delivery list must fit Shopify\'s 3,000 character limit (F-28)', () => {
  const long = explicit(10000, 10600); // 601 codes, 4,206 characters with separators
  const report = checkParity({ zoneJson: zone(long), localJson: local(long) });
  assert.equal(report.ok, false);
  assert.match(report.errors.join(' '), new RegExp(`${LOCAL_DELIVERY_MAX_CHARACTERS}`));
  assert.match(report.errors.join(' '), /wildcard/);
});

test('a missing list on either side is an error that says what was expected', () => {
  assert.match(checkParity({ zoneJson: {}, localJson: local('10001') }).errors.join(' '), /delivery zone: no postal code list found/);
  assert.match(checkParity({ zoneJson: zone('10001'), localJson: [] }).errors.join(' '), /Local delivery: no postal code list found/);
});

test('exactly one delivery zone is expected on the metaobject side (ADR-0007) but Local delivery may have several zones', () => {
  const two = { entries: [zone('10001'), zone('10002')] };
  assert.match(checkParity({ zoneJson: two, localJson: local('10001,10002') }).errors.join(' '), /exactly one delivery zone is expected/);
  const localZones = { zones: [{ name: 'A', postal_codes: '10001' }, { name: 'B', postal_codes: '10002' }] };
  assert.equal(checkParity({ zoneJson: zone('10001,10002'), localJson: localZones }).ok, true);
});

test('several export shapes are understood', () => {
  const shapes = [
    ['array of codes', ['10001', '10002']],
    ['text value', { postal_codes: '10001, 10002' }],
    ['camelCase key', { postalCodes: '10001 10002' }],
    ['metaobject fields', zone('10001,10002')],
    ['nested GraphQL answer', { data: { metaobject: zone('10001,10002') } }],
    ['JSON-encoded list value', { postal_codes: '["10001","10002"]' }],
    ['array value', { postal_codes: ['10001', '10002'] }],
  ];
  for (const [label, json] of shapes) {
    const report = checkParity({ zoneJson: json, localJson: local('10001,10002') });
    assert.equal(report.ok, true, `${label}: ${report.errors.join(' ')}`);
  }
  assert.deepEqual(findPostalCodeValues({ a: { b: [{ postal_codes: 'x' }] } }), ['x']);
  assert.deepEqual(findPostalCodeValues('nothing'), []);
});

test('expandCoverage handles exact codes and prefixes together', () => {
  const coverage = expandCoverage(parseTokens(['00001', '9*']).tokens);
  assert.equal(coverage[1], 1);
  assert.equal(coverage[90000], 1);
  assert.equal(coverage[99999], 1);
  assert.equal(coverage[89999], 0);
});

test('an over-broad or empty zone is called out', () => {
  assert.match(checkParity({ zoneJson: zone('0*,1*,2*,3*,4*,5*,6*,7*,8*,9*'), localJson: local('0*,1*,2*,3*,4*,5*,6*,7*,8*,9*') }).notes.join(' '), /every ZIP/);
});

test('the shipped sample exports: one pair has parity, the other shows exactly the planted drift', async () => {
  const sample = (/** @type {string} */ name) => path.join(path.dirname(fileURLToPath(import.meta.url)), 'sample', name);
  /** @param {string[]} argv */
  const cli = async (argv) => {
    /** @type {string[]} */
    const out = [];
    const code = await main(argv, { out: (text) => out.push(text), err: () => {} });
    return { code, out: out.join('\n') };
  };
  const same = await cli(['--zone', sample('delivery-zone.json'), '--local', sample('local-delivery.json')]);
  assert.equal(same.code, 0, same.out);
  assert.match(same.out, /PARITY OK/);
  const drift = await cli(['--zone', sample('delivery-zone.json'), '--local', sample('local-delivery-drift.json')]);
  assert.equal(drift.code, 1);
  assert.match(drift.out, /Only in the delivery zone \(add to Local delivery\): 30902/);
  assert.match(drift.out, /Only in Local delivery \(add to the delivery zone\): 32000/);
});

test('the CLI prints the report and uses exit codes 0, 1 and 2', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'parity-test-'));
  try {
    const write = async (/** @type {string} */ name, /** @type {unknown} */ value) => {
      const file = path.join(dir, name);
      await writeFile(file, typeof value === 'string' ? value : JSON.stringify(value));
      return file;
    };
    const same = await write('zone.json', zone('10001,10002'));
    const sameLocal = await write('local.json', local('10002,10001'));
    const drift = await write('drift.json', local('10001'));
    /** @param {string[]} argv */
    const cli = async (argv) => {
      /** @type {string[]} */
      const out = [];
      /** @type {string[]} */
      const err = [];
      const code = await main(argv, { out: (text) => out.push(text), err: (text) => err.push(text) });
      return { code, out: out.join('\n'), err: err.join('\n') };
    };
    const ok = await cli(['--zone', same, '--local', sameLocal]);
    assert.equal(ok.code, 0);
    assert.match(ok.out, /PARITY OK/);
    const bad = await cli(['--zone', same, '--local', drift]);
    assert.equal(bad.code, 1);
    assert.match(bad.out, /Only in the delivery zone/);
    assert.equal((await cli(['--zone', same])).code, 2);
    assert.equal((await cli([])).code, 2);
    assert.equal((await cli(['--zone', same, '--local', path.join(dir, 'nope.json')])).code, 2);
    assert.equal((await cli(['--zone', same, '--local', await write('broken.json', '{not json')])).code, 2);
    assert.equal((await cli(['--zone', same, '--local', sameLocal, '--extra'])).code, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
