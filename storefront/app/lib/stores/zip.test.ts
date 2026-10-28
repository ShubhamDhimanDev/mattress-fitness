import {describe, expect, it} from 'vitest';
import {FIXTURE_STORES, getFixtureStore} from '~/lib/stores/fixtures';
import type {Store} from '~/lib/stores/types';
import {matchStoresByZip, parseZipQuery} from '~/lib/stores/zip';

const BUFFALO = getFixtureStore('fixture-store-buffalo');

function store(id: string, postalCode: string, city = 'Testville'): Store {
  return {...BUFFALO, id, name: `Store ${id}`, slug: id, city, postalCode};
}

describe('parseZipQuery (REQ-LOC-001, CR31-10)', () => {
  it.each([
    ['14201', '14201'],
    [' 14201 ', '14201'],
    ['14201-1234', '14201'],
    ['00501', '00501'],
  ])('accepts %j and keeps five digits', (raw, zip) => {
    expect(parseZipQuery(raw)).toEqual({status: 'valid', zip});
  });

  it.each([[null], [undefined], [''], ['   ']])(
    'treats %j as no search',
    (raw) => {
      expect(parseZipQuery(raw)).toEqual({status: 'none'});
    },
  );

  it.each([
    ['1420'],
    ['142011'],
    ['14201-12'],
    ['14201-12345'],
    ['142011234'],
    ['14201 1234'],
    ['14201+1234'],
    ['abcde'],
    ['1420a'],
    ['K1A 0B1'],
    ['<script>alert(1)</script>'],
    ['14201\n14202'],
    ['14201%00'],
    ['１４２０１'],
    ['1'.repeat(5000)],
  ])('rejects %j and carries nothing from it', (raw) => {
    expect(parseZipQuery(raw)).toEqual({status: 'invalid'});
  });
});

describe('matchStoresByZip (REQ-LOC-001, CR31-10)', () => {
  const stores = [
    store('c', '14202', 'Buffalo'),
    store('a', '14201', 'Buffalo'),
    store('b', '14201-5678', 'Amherst'),
    store('d', '14288'),
    store('e', '15201'),
    store('f', 'K1A 0B1'),
    store('g', ''),
  ];

  it('puts exact ZIP matches first (ZIP+4 on the store counts), sorted by city, name, id', () => {
    const result = matchStoresByZip(stores, '14201');
    expect(result.kind).toBe('found');
    if (result.kind !== 'found') return;
    expect(result.exact.map((s) => s.id)).toEqual(['b', 'a']);
  });

  it('lists the same 3-digit area after the exact ones without repeating them', () => {
    const result = matchStoresByZip(stores, '14201');
    if (result.kind !== 'found') throw new Error('expected a match');
    expect(result.area.map((s) => s.id)).toEqual(['c', 'd']);
  });

  it('finds the area when no store has the exact ZIP', () => {
    const result = matchStoresByZip(stores, '14250');
    if (result.kind !== 'found') throw new Error('expected a match');
    expect(result.exact).toEqual([]);
    expect(result.area.map((s) => s.id)).toEqual(['b', 'a', 'c', 'd']);
  });

  it('says none when no store shares the first three digits', () => {
    expect(matchStoresByZip(stores, '90001')).toEqual({kind: 'none'});
    expect(matchStoresByZip([], '14201')).toEqual({kind: 'none'});
  });

  it('never matches a store whose postal code is not a US ZIP', () => {
    expect(
      matchStoresByZip([store('f', 'K1A 0B1'), store('g', '')], '14201'),
    ).toEqual({
      kind: 'none',
    });
  });

  it('does not depend on the order the stores arrive in', () => {
    const forward = matchStoresByZip(stores, '14201');
    const backward = matchStoresByZip([...stores].reverse(), '14201');
    expect(backward).toEqual(forward);
  });

  it('works on the fixture stores', () => {
    const result = matchStoresByZip(
      FIXTURE_STORES,
      BUFFALO.postalCode.slice(0, 5),
    );
    if (result.kind !== 'found') throw new Error('expected a match');
    expect(result.exact.map((s) => s.id)).toContain(BUFFALO.id);
  });
});
