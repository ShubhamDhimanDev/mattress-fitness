import {describe, expect, it} from 'vitest';
import {
  isNonEmptyString,
  isValidQuantity,
  limitOrZero,
  normalizeSize,
  sizeMap,
} from '~/lib/offers/helpers';

// Supports REQ-PRE-006 (hostile Shopify and CMS values never reach a rule unchecked).
describe('offer helpers (REQ-PRE-006)', () => {
  it.each([
    ['Queen', 'queen'],
    ['  Cal   King ', 'cal king'],
    ['TWIN XL', 'twin xl'],
    ['Cal\tKing', 'cal king'],
  ])('normalizeSize(%j) = %j', (input, expected) => {
    expect(normalizeSize(input)).toBe(expected);
  });

  it.each(['', '   ', null, undefined, 5, {}, ['Queen']])(
    'normalizeSize(%j) has no size',
    (input) => {
      expect(normalizeSize(input)).toBeNull();
    },
  );

  it('sizeMap matches sizes loosely, keeps the first of a repeated size and skips blank ids', () => {
    const map = sizeMap({
      Queen: 'v1',
      'queen ': 'v2',
      King: '',
      '  ': 'v3',
      'Cal King': 'v4',
    });
    expect([...map.keys()]).toEqual(['queen', 'cal king']);
    expect(map.get('queen')).toEqual({size: 'Queen', id: 'v1'});
  });

  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty'])(
    'sizeMap never resolves the inherited name %j',
    (name) => {
      const map = sizeMap({Queen: 'v1'});
      expect(map.get(name)).toBeUndefined();
      expect(map.get(normalizeSize(name) ?? '')).toBeUndefined();
    },
  );

  it('sizeMap keeps an own "__proto__" entry as data, not as a prototype change', () => {
    // fromEntries defines "__proto__" as an own property, like JSON.parse does for a forged CMS payload.
    const hostile: Record<string, string> = Object.fromEntries([
      ['__proto__', 'v-evil'],
      ['Queen', 'v1'],
    ]);
    const map = sizeMap(hostile);
    expect(map.get('__proto__')).toEqual({size: '__proto__', id: 'v-evil'});
    expect(map.get('queen')?.id).toBe('v1');
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });

  it.each([1, 2, 99, Number.MAX_SAFE_INTEGER])(
    'isValidQuantity accepts %i',
    (value) => {
      expect(isValidQuantity(value)).toBe(true);
    },
  );

  it.each([
    0,
    -1,
    1.5,
    0.1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    2 ** 53,
    '2',
    null,
    undefined,
    [],
  ])('isValidQuantity rejects %j', (value) => {
    expect(isValidQuantity(value)).toBe(false);
  });

  it.each([
    [0, 0],
    [3, 3],
    [-1, 0],
    [2.5, 0],
    [Number.NaN, 0],
    [2 ** 60, 0],
    ['3', 0],
    [null, 0],
  ])('limitOrZero(%j) = %i', (value, expected) => {
    expect(limitOrZero(value)).toBe(expected);
  });

  it('isNonEmptyString', () => {
    expect(isNonEmptyString('a')).toBe(true);
    expect(isNonEmptyString('')).toBe(false);
    expect(isNonEmptyString(null)).toBe(false);
    expect(isNonEmptyString(1)).toBe(false);
  });
});
