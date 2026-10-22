import {describe, expect, it} from 'vitest';
import {
  DISPLAY_TYPE_MAX_LENGTH,
  displayHeadingClass,
  fitsDisplayType,
} from '~/lib/display-type';

// REQ-HOME-001, NFR-003: heavy uppercase display type is for short labels only; a long heading written in Shopify
// admin goes back to sentence case so it stays readable (BRAND_APPLICATION_SPEC 2.7).
describe('display type length rule', () => {
  it.each([
    ['Shop by size', true],
    ['x'.repeat(DISPLAY_TYPE_MAX_LENGTH), true],
    ['x'.repeat(DISPLAY_TYPE_MAX_LENGTH + 1), false],
    ['  padded to the limit  ', true],
    ['', true],
  ])('%j fits: %s', (text, fits) => {
    expect(fitsDisplayType(text)).toBe(fits);
  });

  it('chooses the display utility for short text and plain heavy type for long text', () => {
    expect(displayHeadingClass('Shop by size')).toBe('type-display');
    expect(displayHeadingClass('y'.repeat(60))).toBe('font-extrabold');
  });

  it('the placeholder hero wording fits the display type', () => {
    expect(fitsDisplayType('Find the mattress that fits you')).toBe(true);
  });
});
