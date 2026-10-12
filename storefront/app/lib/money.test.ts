import {describe, expect, it} from 'vitest';
import {formatCents, formatMoney, fromCents, toCents} from '~/lib/money';

// NFR-008 (US dollars only); proves the Vitest harness works (P1-04).
describe('money helpers (NFR-008)', () => {
  it.each([
    ['0', 0],
    ['1999', 199900],
    ['1999.0', 199900],
    ['1999.5', 199950],
    ['19.99', 1999],
    [' 0.07 ', 7],
  ])('toCents(%j) = %i', (input, expected) => {
    expect(toCents(input)).toBe(expected);
  });

  it.each(['', '-1', '1,999', '12.345', 'abc', '1e3'])(
    'toCents rejects %j',
    (input) => {
      expect(() => toCents(input)).toThrow(/Invalid money amount/);
    },
  );

  it('round-trips cents through fromCents', () => {
    for (const cents of [0, 1, 99, 100, 101, 199900, 1234567]) {
      expect(toCents(fromCents(cents))).toBe(cents);
    }
    expect(() => fromCents(-1)).toThrow();
    expect(() => fromCents(1.5)).toThrow();
  });

  it('formats US dollars, with an optional compact form for whole dollars', () => {
    expect(formatCents(199900)).toBe('$1,999.00');
    expect(formatCents(199900, {compact: true})).toBe('$1,999');
    expect(formatCents(199950, {compact: true})).toBe('$1,999.50');
  });

  it('refuses any currency other than USD', () => {
    expect(formatMoney({amount: '10.00', currencyCode: 'USD'})).toBe('$10.00');
    expect(() => formatMoney({amount: '10.00', currencyCode: 'CAD'})).toThrow(
      /Only USD/,
    );
  });
});
