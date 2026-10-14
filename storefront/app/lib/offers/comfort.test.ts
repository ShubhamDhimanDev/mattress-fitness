import {describe, expect, it} from 'vitest';
import {
  comfortProtectorVariantFor,
  evaluateComfortGuarantee,
} from '~/lib/offers/comfort';
import {prepareCart} from '~/lib/offers/lines';
import type {ComfortGuaranteeRules} from '~/lib/offers/types';
import {
  PRODUCT,
  RULES,
  VARIANT,
  makeCart,
  makeLine,
  mattressA,
  protector,
} from '~/lib/offers/test-fixtures';

const COMFORT = RULES.comfortGuarantee;

function run(
  lines: Parameters<typeof makeCart>[0],
  declined = false,
  rules: ComfortGuaranteeRules | null = COMFORT,
) {
  return evaluateComfortGuarantee(
    prepareCart(makeCart(lines), {...RULES, comfortGuarantee: rules}),
    rules,
    declined,
  );
}

// REQ-PRE-002: offered only with a qualifying mattress; protector matches the mattress size; decline recorded.
describe('comfortProtectorVariantFor (REQ-PRE-002)', () => {
  it.each([
    ['Queen', VARIANT.protQueen],
    ['queen', VARIANT.protQueen],
    ['  QUEEN ', VARIANT.protQueen],
    ['Cal King', VARIANT.protCalKing],
    ['Split King', VARIANT.protKing],
    ['Full', null],
    ['', null],
    [null, null],
    ['constructor', null],
    ['__proto__', null],
  ])('size %j -> %j', (size, expected) => {
    expect(comfortProtectorVariantFor(COMFORT, size)).toBe(expected);
  });

  it('is null when the offer is off', () => {
    expect(comfortProtectorVariantFor(null, 'Queen')).toBeNull();
  });
});

describe('evaluateComfortGuarantee: the step (REQ-PRE-002)', () => {
  it('offers the protector in the mattress size', () => {
    const {step, corrections} = run([mattressA('Queen')]);
    expect(step).toEqual({
      id: 'comfort-guarantee',
      applies: true,
      reason: 'qualifying-mattress-in-cart',
      status: 'pending',
      options: [
        {
          protectorVariantId: VARIANT.protQueen,
          size: 'Queen',
          mattressLineIds: ['mattress-queen'],
          quantityMissing: 1,
        },
      ],
    });
    expect(corrections).toEqual([]);
  });

  it('records a decline', () => {
    expect(run([mattressA('Queen')], true).step.status).toBe('declined');
  });

  it('is accepted when the matching protector is in the cart', () => {
    const {step, corrections} = run([
      mattressA('Queen'),
      protector(VARIANT.protQueen, 'p1'),
    ]);
    expect(step).toMatchObject({
      applies: true,
      status: 'accepted',
      options: [],
    });
    expect(corrections).toEqual([]);
  });

  it('keeps asking for the missing protector when there are two mattresses', () => {
    const {step} = run([
      mattressA('Queen', {quantity: 2}),
      protector(VARIANT.protQueen, 'p1'),
    ]);
    expect(step.status).toBe('pending');
    expect(step.options).toMatchObject([{quantityMissing: 1}]);
  });

  it('offers one protector per size for mattresses of different sizes, in cart order', () => {
    const {step} = run([mattressA('King'), mattressA('Twin')]);
    expect(step.options.map((o) => [o.size, o.protectorVariantId])).toEqual([
      ['King', VARIANT.protKing],
      ['Twin', VARIANT.protTwin],
    ]);
  });

  it('merges sizes that share a protector variant', () => {
    const {step} = run([mattressA('King'), mattressA('Split King')]);
    expect(step.options).toEqual([
      {
        protectorVariantId: VARIANT.protKing,
        size: 'King',
        mattressLineIds: ['mattress-king', 'mattress-split-king'],
        quantityMissing: 2,
      },
    ]);
  });

  it('matches sizes ignoring case and spacing', () => {
    const line = mattressA('Queen', {size: '  queen '});
    expect(run([line]).step.options[0]?.protectorVariantId).toBe(
      VARIANT.protQueen,
    );
  });

  it.each([
    ['no mattress at all', [makeLine({id: 'x'})], 'no-qualifying-mattress'],
    [
      'a mattress that does not qualify',
      [makeLine({id: 'b', productId: PRODUCT.mattressB, size: 'Queen'})],
      'no-qualifying-mattress',
    ],
    ['a size with no protector', [mattressA('Full')], 'no-protector-for-size'],
    [
      'a mattress without a size',
      [makeLine({id: 'a', productId: PRODUCT.mattressA, size: null})],
      'no-protector-for-size',
    ],
    [
      'a hostile size',
      [makeLine({id: 'a', productId: PRODUCT.mattressA, size: 'constructor'})],
      'no-protector-for-size',
    ],
  ])('does not apply with %s', (_label, lines, reason) => {
    const {step} = run(lines);
    expect(step).toMatchObject({
      applies: false,
      reason,
      status: 'not-applicable',
      options: [],
    });
  });

  it('does not apply when the offer is switched off', () => {
    expect(run([mattressA('Queen')], false, null).step).toMatchObject({
      applies: false,
      reason: 'not-configured',
      status: 'not-applicable',
    });
  });

  it('ignores a qualifying mattress with a malformed quantity', () => {
    expect(run([mattressA('Queen', {quantity: 0})]).step.applies).toBe(false);
    expect(run([mattressA('Queen', {quantity: -1})]).step.applies).toBe(false);
    expect(run([mattressA('Queen', {quantity: 1.5})]).step.applies).toBe(false);
  });

  it('handles an enormous mattress quantity without overflowing', () => {
    const quantity = Number.MAX_SAFE_INTEGER;
    const {step} = run([mattressA('Queen', {quantity})]);
    expect(step.options[0]?.quantityMissing).toBe(quantity);
  });
});

describe('evaluateComfortGuarantee: tampered carts (REQ-PRE-002, REQ-PRE-006)', () => {
  it('removes a protector when no qualifying mattress is in the cart', () => {
    expect(run([protector(VARIANT.protQueen, 'p1')]).corrections).toEqual([
      {type: 'remove-line', lineId: 'p1', reason: 'protector-without-mattress'},
    ]);
  });

  it('removes a protector when only a non-qualifying mattress is in the cart', () => {
    const other = makeLine({
      id: 'b',
      productId: PRODUCT.mattressB,
      size: 'Queen',
    });
    expect(
      run([other, protector(VARIANT.protQueen, 'p1')]).corrections,
    ).toEqual([
      {type: 'remove-line', lineId: 'p1', reason: 'protector-without-mattress'},
    ]);
  });

  it('removes a protector in the wrong size and still offers the right one', () => {
    const {corrections, step} = run([
      mattressA('King'),
      protector(VARIANT.protQueen, 'p1'),
    ]);
    expect(corrections).toEqual([
      {type: 'remove-line', lineId: 'p1', reason: 'wrong-size-protector'},
    ]);
    expect(step.status).toBe('pending');
    expect(step.options[0]?.protectorVariantId).toBe(VARIANT.protKing);
  });

  it('keeps the right-size protector and removes the wrong-size one in the same cart', () => {
    const {corrections} = run([
      mattressA('King'),
      protector(VARIANT.protKing, 'good'),
      protector(VARIANT.protTwin, 'bad'),
    ]);
    expect(corrections).toEqual([
      {type: 'remove-line', lineId: 'bad', reason: 'wrong-size-protector'},
    ]);
  });

  it('removes the protector left behind when its mattress size left the cart', () => {
    // The Twin mattress was removed and a Queen one is still there: the Twin protector is now the wrong size.
    expect(
      run([mattressA('Queen'), protector(VARIANT.protTwin, 'p1')]).corrections,
    ).toEqual([
      {type: 'remove-line', lineId: 'p1', reason: 'wrong-size-protector'},
    ]);
  });

  it.each([2, 3, 100, Number.MAX_SAFE_INTEGER])(
    'clamps %i protectors to the single mattress',
    (quantity) => {
      expect(
        run([
          mattressA('Queen'),
          protector(VARIANT.protQueen, 'p1', {quantity}),
        ]).corrections,
      ).toEqual([
        {
          type: 'set-quantity',
          lineId: 'p1',
          quantity: 1,
          previousQuantity: quantity,
          reason: 'protector-exceeds-mattresses',
        },
      ]);
    },
  );

  it('removes a second line of the same protector when the first already covers the mattress', () => {
    const {corrections} = run([
      mattressA('Queen'),
      protector(VARIANT.protQueen, 'p1'),
      protector(VARIANT.protQueen, 'p2', {attributes: {note: 'again'}}),
    ]);
    expect(corrections).toEqual([
      {
        type: 'remove-line',
        lineId: 'p2',
        reason: 'protector-exceeds-mattresses',
      },
    ]);
  });

  it('does not touch a protector that is not an offer variant (an ordinary catalog protector)', () => {
    const ordinary = makeLine({
      id: 'p-ord',
      variantId: 'v-ordinary-protector',
      productId: PRODUCT.protector,
      role: 'protector',
    });
    expect(run([ordinary]).corrections).toEqual([]);
  });

  it('removes a protector whose only mattress has a malformed quantity', () => {
    expect(
      run([
        mattressA('Queen', {quantity: 0}),
        protector(VARIANT.protQueen, 'p1'),
      ]).corrections,
    ).toEqual([
      {type: 'remove-line', lineId: 'p1', reason: 'protector-without-mattress'},
    ]);
  });
});
