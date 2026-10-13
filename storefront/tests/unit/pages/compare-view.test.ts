import {describe, expect, it} from 'vitest';
import {FIXTURE_PRODUCTS, getFixtureProduct} from '~/lib/catalog/fixtures';
import type {CatalogProduct} from '~/lib/catalog/types';
import {
  comparePath,
  handlesOf,
  parseHandlesParam,
  parseSizeParam,
  pickerItems,
  resolveSelection,
  withHandle,
  withoutHandle,
} from '~/lib/pages/compare-view';

// REQ-CMP-001: selection in the URL, the rules and their rejection messages.

const A = 'wrenfield-solace-plush-memory-foam';
const B = 'wrenfield-solace-medium-memory-foam';
const C = 'larkmoor-cedar-medium-hybrid';
const D = 'larkmoor-cedar-plush-hybrid';
const E = 'tidewell-harbor-medium-foam';

const bedFrame: CatalogProduct = {
  ...getFixtureProduct(A),
  id: 'fixture-product:frame',
  handle: 'oak-bed-frame',
  title: 'Oak Bed Frame',
  productType: 'Bed Frame',
};
const catalog = [...FIXTURE_PRODUCTS, bedFrame];

describe('REQ-CMP-001 handles in the URL', () => {
  it('reads comma lists and repeated parameters, lower-cased and de-duplicated', () => {
    expect(parseHandlesParam(new URLSearchParams(`handles=${A},${B}`))).toEqual(
      [A, B],
    );
    expect(
      parseHandlesParam(new URLSearchParams(`handles=${A}&handles=${B},${A}`)),
    ).toEqual([A, B]);
    expect(
      parseHandlesParam(new URLSearchParams(`handles=${A.toUpperCase()}`)),
    ).toEqual([A]);
  });

  it.each([
    ['empty', 'handles='],
    ['script', 'handles=<script>alert(1)</script>'],
    ['path traversal', 'handles=../../etc/passwd'],
    ['spaces and symbols', 'handles=a b,c;d'],
    ['leading hyphen', 'handles=-abc'],
  ])('drops hostile input (%s)', (_name, query) => {
    expect(parseHandlesParam(new URLSearchParams(query))).toEqual([]);
  });

  it('caps what it keeps and survives a flood of values', () => {
    const many = Array.from({length: 5000}, (_, i) => `p${i}`).join(',');
    expect(
      parseHandlesParam(new URLSearchParams({handles: many})),
    ).toHaveLength(8);
  });

  it('validates the size and builds readable paths', () => {
    expect(parseSizeParam(new URLSearchParams('size=Queen'))).toBe('Queen');
    expect(parseSizeParam(new URLSearchParams('size=Huge'))).toBeNull();
    expect(comparePath([])).toBe('/compare');
    expect(comparePath([A, B])).toBe(`/compare?handles=${A},${B}`);
    expect(comparePath([A], 'King')).toBe(`/compare?handles=${A}&size=King`);
    expect(comparePath([], 'King')).toBe('/compare');
  });

  it('adds and removes handles without duplicating', () => {
    expect(withHandle([A], B)).toEqual([A, B]);
    expect(withHandle([A], A)).toEqual([A]);
    expect(withoutHandle([A, B], A)).toEqual([B]);
  });
});

describe('REQ-CMP-001 selection rules and messages', () => {
  it('keeps valid products and explains each rejection', () => {
    const result = resolveSelection([A, B, C, D, E, 'gone-product'], catalog);
    expect(handlesOf(result.selection)).toEqual([A, B, C, D]);
    expect(result.notices).toHaveLength(1);
    expect(result.notices[0]).toMatch(/Tidewell Harbor Medium Foam.*up to 4/);
  });

  it('rejects a different category with its own message', () => {
    const result = resolveSelection([A, 'oak-bed-frame'], catalog);
    expect(handlesOf(result.selection)).toEqual([A]);
    expect(result.notices[0]).toMatch(/Oak Bed Frame.*same type/);
  });

  it('unknown handles are skipped without a notice', () => {
    const result = resolveSelection(['nope'], catalog);
    expect(result).toEqual({selection: [], notices: []});
  });

  it('picker marks selected items and blocks the rest when full', () => {
    const full = resolveSelection([A, B, C, D], catalog).selection;
    const items = pickerItems(full, catalog);
    expect(items.find((i) => i.handle === A)).toMatchObject({
      checked: true,
      blocked: null,
    });
    expect(items.find((i) => i.handle === E)?.blocked).toBe('full');
    expect(items.find((i) => i.handle === 'oak-bed-frame')?.checked).toBe(
      false,
    );
  });

  it('picker blocks a different category even when not full', () => {
    const one = resolveSelection([A], catalog).selection;
    const frame = pickerItems(one, catalog).find(
      (i) => i.handle === 'oak-bed-frame',
    );
    expect(frame?.blocked).toBe('different_category');
    expect(
      pickerItems(one, catalog).find((i) => i.handle === B)?.blocked,
    ).toBeNull();
  });
});
