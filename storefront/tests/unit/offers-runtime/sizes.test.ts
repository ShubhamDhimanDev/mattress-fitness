import {describe, expect, it} from 'vitest';
import {
  isSizeSwap,
  otherOptionsKey,
  swapChoicesFor,
  type VariantOptions,
} from '~/lib/offers-runtime/sizes';

// REQ-CART-001: a size swap keeps every other option (colour) and never leaves the line's product.

const size = (value: string) => ({name: 'Size', value});
const color = (value: string) => ({name: 'Color', value});
const variant = (
  id: string,
  options: VariantOptions['options'],
  available = true,
): VariantOptions => ({variantId: id, available, options});

const VARIANTS = [
  variant('twin-sand', [size('Twin'), color('Sand')]),
  variant('king-sand', [size('King'), color('Sand')]),
  variant('king-slate', [size('King'), color('Slate')]),
  variant('queen-sand', [size('Queen'), color('Sand')], false),
];

describe('swapChoicesFor', () => {
  it('offers the other sizes in the same colour, with availability', () => {
    expect(swapChoicesFor([size('Twin'), color('Sand')], VARIANTS)).toEqual([
      {variantId: 'twin-sand', size: 'Twin', available: true},
      {variantId: 'king-sand', size: 'King', available: true},
      {variantId: 'queen-sand', size: 'Queen', available: false},
    ]);
  });

  it('is empty when there is only one size to choose, or the line has no size', () => {
    expect(swapChoicesFor([size('King'), color('Slate')], VARIANTS)).toEqual(
      [],
    );
    expect(swapChoicesFor([color('Sand')], VARIANTS)).toEqual([]);
    expect(swapChoicesFor([size('Twin')], [])).toEqual([]);
  });

  it('matches the size option name case-insensitively and ignores option order', () => {
    expect(
      otherOptionsKey([color('Sand'), {name: 'size', value: 'Twin'}]),
    ).toBe(otherOptionsKey([size('King'), color(' sand ')]));
  });
});

describe('isSizeSwap (tampered target)', () => {
  it('accepts a change of size only', () => {
    expect(
      isSizeSwap([size('Twin'), color('Sand')], [size('King'), color('Sand')]),
    ).toBe(true);
  });

  it('refuses a different colour, a target without a size, and a line without a size', () => {
    expect(
      isSizeSwap([size('Twin'), color('Sand')], [size('King'), color('Slate')]),
    ).toBe(false);
    expect(isSizeSwap([size('Twin'), color('Sand')], [color('Sand')])).toBe(
      false,
    );
    expect(isSizeSwap([color('Sand')], [size('King'), color('Sand')])).toBe(
      false,
    );
  });
});
