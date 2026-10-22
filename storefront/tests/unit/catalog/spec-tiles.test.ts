import {describe, expect, it} from 'vitest';
import {splitSpecifications} from '~/lib/shopify/spec-tiles';

// REQ-PDP-002: headline specification tiles on the product page. A fact the catalog does not carry is omitted.

type Input = Parameters<typeof splitSpecifications>[0];

const empty: Input = {
  comfortLevel: null,
  mattressType: null,
  sleepPositions: [],
  benefits: [],
  productLine: null,
  heightInches: null,
  specifications: [],
};

describe('splitSpecifications (REQ-PDP-002)', () => {
  it('returns nothing for a product with no facts (no invented tiles)', () => {
    expect(splitSpecifications(empty)).toEqual({tiles: [], rows: []});
  });

  it('puts the four headline facts in tiles, in a fixed order, and the rest in rows', () => {
    const {tiles, rows} = splitSpecifications({
      comfortLevel: 'Medium',
      mattressType: 'Hybrid',
      sleepPositions: ['Side', 'Back'],
      benefits: ['Cooling', 'Motion Separation'],
      productLine: 'Sleep Pro',
      heightInches: 12,
      specifications: [{label: 'Warranty term', value: '10 years'}],
    });
    expect(tiles.map((tile) => [tile.label, tile.value])).toEqual([
      ['Comfort level', 'Medium'],
      ['Sleep positions', 'Side, Back'],
      ['Height', '12 in'],
      ['Mattress type', 'Hybrid'],
    ]);
    expect(rows).toEqual([
      {label: 'Benefits', value: 'Cooling, Motion Separation'},
      {label: 'Product line', value: 'Sleep Pro'},
      {label: 'Warranty term', value: '10 years'},
    ]);
  });

  it('omits a tile whose fact is missing', () => {
    const {tiles} = splitSpecifications({
      ...empty,
      sleepPositions: ['Stomach'],
    });
    expect(tiles).toEqual([{label: 'Sleep positions', value: 'Stomach'}]);
  });
});
