import {describe, expect, it} from 'vitest';
import {keyedText} from '~/lib/shopify/keys';

describe('keyedText', () => {
  it('keeps keys unique when a paragraph repeats', () => {
    const keys = keyedText(['a', 'b', 'a', 'a']).map((item) => item.key);
    expect(new Set(keys).size).toBe(4);
  });

  it('does not change a key when an unrelated paragraph is added before it', () => {
    const before = keyedText(['x', 'y']).map((item) => item.key);
    const after = keyedText(['new', 'x', 'y']).map((item) => item.key);
    expect(after.slice(1)).toEqual(before);
  });
});
