import {describe, expect, it} from 'vitest';
import {
  MAX_DISCOUNT_CODES,
  mergeDiscountCodes,
} from '~/lib/shopify/discount-codes';

// P-L4 (security review 2026-10-13): a /discount/:code link adds a code; it must not remove the shopper's own.
describe('mergeDiscountCodes', () => {
  it('adds the new code after the existing ones', () => {
    expect(mergeDiscountCodes(['SPRING10'], 'FREESHIP')).toEqual([
      'SPRING10',
      'FREESHIP',
    ]);
  });

  it('works on a cart with no codes', () => {
    expect(mergeDiscountCodes([], 'FREESHIP')).toEqual(['FREESHIP']);
  });

  it('does not repeat a code, whatever its case', () => {
    expect(mergeDiscountCodes(['SPRING10', 'FREESHIP'], 'freeship')).toEqual([
      'SPRING10',
      'FREESHIP',
    ]);
    expect(mergeDiscountCodes(['a', 'A', 'a'], 'b')).toEqual(['a', 'b']);
  });

  it('caps the list at 5 and keeps the newest code', () => {
    const merged = mergeDiscountCodes(['a', 'b', 'c', 'd', 'e'], 'f');
    expect(merged).toHaveLength(MAX_DISCOUNT_CODES);
    expect(merged).toEqual(['b', 'c', 'd', 'e', 'f']);
  });

  it('ignores blank existing entries', () => {
    expect(mergeDiscountCodes(['', '  '], 'X')).toEqual(['X']);
  });
});
