import {describe, expect, it} from 'vitest';
import {isValidZip, normalizeZip, parseZip} from '~/lib/delivery/zip';

// REQ-DEL-001 (ZIP fixtures, boundary and invalid ZIPs), REQ-DEL-002.
describe('normalizeZip (REQ-DEL-001)', () => {
  it.each([
    ['60601', '60601'],
    ['  60601  ', '60601'],
    ['60601-1234', '60601'],
    ['60601 1234', '60601'],
    [' 60601-1234 ', '60601'],
    ['60601\n', '60601'],
    [' 60601 ', '60601'],
    ['02134', '02134'], // leading zero is preserved
    ['00000', '00000'],
    ['99999-9999', '99999'],
  ])('accepts %j and returns %j', (input, expected) => {
    expect(normalizeZip(input)).toBe(expected);
    expect(isValidZip(input)).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['whitespace only', '   '],
    ['four digits', '1234'],
    ['six digits', '123456'],
    ['nine digits without separator', '606011234'],
    ['letters', 'abcde'],
    ['letters inside', '6060a'],
    ['canadian postal code', 'K1A 0B1'],
    ['plus four too short', '60601-123'],
    ['plus four too long', '60601-12345'],
    ['double hyphen', '60601--1234'],
    ['two spaces before plus four', '60601  1234'],
    ['underscore separator', '60601_1234'],
    ['tab separator', '60601\t1234'],
    ['newline separator', '60601\n1234'],
    ['en dash separator', '60601–1234'],
    ['trailing separator', '60601-'],
    ['leading separator', '-60601'],
    ['space inside the five digits', '606 01'],
    ['sql injection', "12345'; DROP TABLE zips;--"],
    ['script tag', '<script>alert(1)</script>'],
    ['null byte', '12345\u0000'],
    ['wildcard', '606*'],
    ['negative number as text', '-1234'],
    ['decimal', '60601.5'],
    ['exponent', '6e4'],
    ['full-width digits', '１２３４５'],
    ['arabic-indic digits', '٦٠٦٠١'],
    ['huge input', '1'.repeat(100_000)],
    ['valid zip buried in padding', `${' '.repeat(100)}60601`],
  ])('rejects %s', (_label, input) => {
    expect(normalizeZip(input)).toBeNull();
    expect(isValidZip(input)).toBe(false);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a number', 60601],
    ['a number that lost its leading zero', 2134],
    ['NaN', Number.NaN],
    ['a boolean', true],
    ['an object', {}],
    ['an array holding a zip', ['60601']],
    ['a bigint', BigInt(60601)],
    ['a symbol', Symbol('60601')],
    [
      'an object whose toString throws',
      {
        toString() {
          throw new Error('boom');
        },
      },
    ],
    ['a function', () => '60601'],
  ])('rejects %s without throwing', (_label, input) => {
    expect(() => normalizeZip(input)).not.toThrow();
    expect(normalizeZip(input)).toBeNull();
    expect(isValidZip(input)).toBe(false);
  });
});

describe('parseZip reasons (REQ-DEL-002)', () => {
  it.each([
    [null, 'not-a-string'],
    [undefined, 'not-a-string'],
    [60601, 'not-a-string'],
    ['', 'empty'],
    ['   ', 'empty'],
    ['1234', 'invalid-format'],
    ['x'.repeat(40), 'invalid-format'],
  ])('parseZip(%j) fails with %s', (input, reason) => {
    expect(parseZip(input)).toEqual({ok: false, reason});
  });

  it('returns the 5-digit ZIP on success', () => {
    expect(parseZip('60601-1234')).toEqual({ok: true, zip: '60601'});
  });
});
