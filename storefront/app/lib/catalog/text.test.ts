import {describe, expect, it} from 'vitest';
import {
  cleanText,
  hasControlCharacter,
  hashString,
  removeInvisibleCharacters,
} from '~/lib/catalog/text';

// Built from code points so this file holds no invisible characters itself.
const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);
const RIGHT_TO_LEFT_OVERRIDE = String.fromCharCode(0x202e);
const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);
const NUL = String.fromCharCode(0);

// Text hygiene for untrusted strings (threats T-07, T-15); used by the quiz
// configuration, store records and guest lookup (REQ-QZ-004, REQ-LOC-002, REQ-ACC-003).
describe('text hygiene helpers', () => {
  it.each([
    ['plain', false],
    ['', false],
    ['tab\there', true],
    ['line\nbreak', true],
    [`nul${NUL}byte`, true],
    [String.fromCharCode(0x7f), true],
    [String.fromCharCode(0x85), true],
    ['café über', false],
  ])('hasControlCharacter(%j) = %s', (value, expected) => {
    expect(hasControlCharacter(value)).toBe(expected);
  });

  it('removes only zero-width and direction-override characters', () => {
    const disguised = `a${ZERO_WIDTH_SPACE}b${RIGHT_TO_LEFT_OVERRIDE}c${BYTE_ORDER_MARK}d`;
    expect(removeInvisibleCharacters(disguised)).toBe('abcd');
    expect(removeInvisibleCharacters('keep <b> and é and  spaces')).toBe(
      'keep <b> and é and  spaces',
    );
  });

  it.each([
    ['  spaced   out  ', 'spaced out'],
    ['line\nbreaks\tand\ttabs', 'line breaks and tabs'],
    [`nul${NUL}byte`, 'nul byte'],
    ['<b>bold</b> text', 'bold text'],
    ['<script>alert(1)</script>safe', 'alert(1)safe'],
    ['<img src=x onerror=alert(1)>after', 'after'],
    ['1 < 2 and 3 > 2', '1 < 2 and 3 > 2'],
    [`hid${ZERO_WIDTH_SPACE}den`, 'hidden'],
    ['', ''],
  ])('cleanText(%j) = %j', (value, expected) => {
    expect(cleanText(value)).toBe(expected);
  });

  it('cleanText is idempotent', () => {
    for (const value of [
      '<b> x </b>\n y',
      `a${ZERO_WIDTH_SPACE}${NUL}b`,
      '  ',
      'plain',
    ]) {
      expect(cleanText(cleanText(value))).toBe(cleanText(value));
    }
  });

  it('hashString is deterministic, sensitive to input and seed, and compact', () => {
    expect(hashString('quiz')).toBe(hashString('quiz'));
    expect(hashString('quiz')).not.toBe(hashString('quiz '));
    expect(hashString('quiz', 1)).not.toBe(hashString('quiz', 2));
    expect(hashString('')).toMatch(/^[0-9a-f]{1,14}$/);
    const hashes = new Set(
      Array.from({length: 2000}, (_, i) => hashString(`value-${i}`)),
    );
    expect(hashes.size).toBe(2000);
  });
});
