import {describe, expect, it} from 'vitest';
import type {OptionView, VariantView} from '~/lib/shopify/types';
import {
  dimensionsForValue,
  isOptionValueAvailable,
  parseSelectedOptions,
  selectVariant,
  selectionOf,
  selectionToSearch,
} from '~/lib/shopify/variant-selection';

// REQ-PDP-001: the size comes from the URL, validated against the product's own options.

const OPTIONS: OptionView[] = [
  {name: 'Size', values: ['Twin', 'Queen', 'King']},
  {name: 'Color', values: ['Sand', 'Stone']},
];

function variant(
  size: string,
  color: string,
  available = true,
  dimensions: string | null = null,
): VariantView {
  return {
    id: `v-${size}-${color}`,
    title: `${size} / ${color}`,
    sku: null,
    available,
    price: {amount: '100.0', currencyCode: 'USD'},
    compareAt: null,
    selectedOptions: [
      {name: 'Size', value: size},
      {name: 'Color', value: color},
    ],
    image: null,
    dimensions,
  };
}

const VARIANTS: VariantView[] = [
  variant('Twin', 'Sand', true, '38" x 75"'),
  variant('Twin', 'Stone'),
  variant('Queen', 'Sand', false, '60" x 80"'),
  variant('Queen', 'Stone', true, '60" x 80"'),
  variant('King', 'Sand', false),
  variant('King', 'Stone', false),
];

const params = (query: string) => new URLSearchParams(query);

describe('parseSelectedOptions (validation of URL input)', () => {
  it('matches names and values loosely and returns the canonical spelling', () => {
    expect(
      parseSelectedOptions(params('size=queen&COLOR=stone'), OPTIONS),
    ).toEqual([
      {name: 'Size', value: 'Queen'},
      {name: 'Color', value: 'Stone'},
    ]);
  });

  it('drops unknown names, unknown values and oversized values', () => {
    expect(
      parseSelectedOptions(params('Size=Emperor&Material=Wool'), OPTIONS),
    ).toEqual([]);
    expect(
      parseSelectedOptions(params(`Size=${'a'.repeat(500)}`), OPTIONS),
    ).toEqual([]);
    expect(parseSelectedOptions(params('Size=%3Cscript%3E'), OPTIONS)).toEqual(
      [],
    );
  });

  it('takes one value per option, the first valid one', () => {
    expect(
      parseSelectedOptions(params('Size=bad&Size=King&Size=Twin'), OPTIONS),
    ).toEqual([{name: 'Size', value: 'King'}]);
  });
});

describe('selectVariant', () => {
  it('picks the exact combination', () => {
    expect(
      selectVariant(VARIANTS, [
        {name: 'Size', value: 'Queen'},
        {name: 'Color', value: 'Stone'},
      ])?.id,
    ).toBe('v-Queen-Stone');
  });

  it('prefers an available variant when only the size is chosen', () => {
    expect(selectVariant(VARIANTS, [{name: 'Size', value: 'Queen'}])?.id).toBe(
      'v-Queen-Stone',
    );
  });

  it('returns a sold-out variant when the whole size is sold out, so the page can say so', () => {
    expect(
      selectVariant(VARIANTS, [{name: 'Size', value: 'King'}])?.available,
    ).toBe(false);
  });

  it('drops later options when the combination does not exist', () => {
    const only = [variant('Twin', 'Sand')];
    expect(
      selectVariant(only, [
        {name: 'Size', value: 'Twin'},
        {name: 'Color', value: 'Stone'},
      ])?.id,
    ).toBe('v-Twin-Sand');
  });

  it('defaults to the first available variant, and to the first variant if none is available', () => {
    expect(selectVariant(VARIANTS, [])?.id).toBe('v-Twin-Sand');
    expect(selectVariant([variant('King', 'Sand', false)], [])?.id).toBe(
      'v-King-Sand',
    );
    expect(selectVariant([], [])).toBeNull();
  });
});

describe('option availability (sold-out sizes are disabled with a reason)', () => {
  it('a size is available when any colour of it can be bought', () => {
    const selected = [{name: 'Size', value: 'Twin'}];
    expect(
      isOptionValueAvailable(VARIANTS, OPTIONS, selected, 'Size', 'Queen'),
    ).toBe(true);
    expect(
      isOptionValueAvailable(VARIANTS, OPTIONS, selected, 'Size', 'King'),
    ).toBe(false);
  });

  it('a later option depends on the earlier choice', () => {
    const queen = [{name: 'Size', value: 'Queen'}];
    expect(
      isOptionValueAvailable(VARIANTS, OPTIONS, queen, 'Color', 'Sand'),
    ).toBe(false);
    expect(
      isOptionValueAvailable(VARIANTS, OPTIONS, queen, 'Color', 'Stone'),
    ).toBe(true);
  });
});

describe('helpers', () => {
  it('builds the URL query for a selection, encoding values', () => {
    expect(
      selectionToSearch([
        {name: 'Size', value: 'Twin XL'},
        {name: 'Color', value: 'Sand & Stone'},
      ]),
    ).toBe('Size=Twin+XL&Color=Sand+%26+Stone');
  });

  it('reads the selection back from a variant in option order', () => {
    expect(selectionOf(VARIANTS[3], OPTIONS)).toEqual([
      {name: 'Size', value: 'Queen'},
      {name: 'Color', value: 'Stone'},
    ]);
  });

  it('finds dimensions for a size from the first variant that states them', () => {
    expect(dimensionsForValue(VARIANTS, 'Size', 'Queen')).toBe('60" x 80"');
    expect(dimensionsForValue(VARIANTS, 'Size', 'King')).toBeNull();
  });
});
