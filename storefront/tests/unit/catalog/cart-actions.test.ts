import {describe, expect, it} from 'vitest';
import {
  validateAddLines,
  validateDiscountCodes,
  validateLineIds,
  validateUpdateLines,
} from '~/lib/cart/actions';

// T-01: the browser sends variant ids and quantities only; everything else is dropped or rejected.
const VARIANT = 'gid://shopify/ProductVariant/12345';
const LINE = 'gid://shopify/CartLine/abc-123?cart=c1-def456';

describe('validateAddLines', () => {
  it('keeps only merchandiseId, quantity and bounded properties', () => {
    const result = validateAddLines([
      {
        merchandiseId: VARIANT,
        quantity: 2,
        attributes: [{key: 'Gift note', value: ' For <b>Sam</b> '}],
        price: '0.01',
        selectedVariant: {price: {amount: '0'}},
        sellingPlanId: 'x',
        parent: {lineId: 'y'},
      },
    ]);
    expect(result).toEqual({
      status: 'ok',
      value: [
        {
          merchandiseId: VARIANT,
          quantity: 2,
          attributes: [{key: 'Gift note', value: 'For Sam'}],
        },
      ],
    });
  });

  it.each([
    ['no lines', []],
    ['not a list', {merchandiseId: VARIANT, quantity: 1}],
    [
      'too many lines',
      Array.from({length: 21}, () => ({merchandiseId: VARIANT, quantity: 1})),
    ],
    ['text id', [{merchandiseId: 'abc', quantity: 1}]],
    [
      'product gid instead of variant',
      [{merchandiseId: 'gid://shopify/Product/1', quantity: 1}],
    ],
    [
      'gid with trailing junk',
      [{merchandiseId: `${VARIANT}/../x`, quantity: 1}],
    ],
    ['zero quantity', [{merchandiseId: VARIANT, quantity: 0}]],
    ['negative quantity', [{merchandiseId: VARIANT, quantity: -1}]],
    ['quantity over 99', [{merchandiseId: VARIANT, quantity: 100}]],
    ['fractional quantity', [{merchandiseId: VARIANT, quantity: 1.5}]],
    ['string quantity', [{merchandiseId: VARIANT, quantity: '2'}]],
    [
      'hidden property key',
      [
        {
          merchandiseId: VARIANT,
          quantity: 1,
          attributes: [{key: '_parent', value: 'x'}],
        },
      ],
    ],
    [
      'too many properties',
      [
        {
          merchandiseId: VARIANT,
          quantity: 1,
          attributes: Array.from({length: 11}, (_, i) => ({
            key: `k${i}`,
            value: 'v',
          })),
        },
      ],
    ],
    [
      'long property value',
      [
        {
          merchandiseId: VARIANT,
          quantity: 1,
          attributes: [{key: 'k', value: 'x'.repeat(300)}],
        },
      ],
    ],
    ['null entry', [null]],
  ])('rejects %s', (_name, input) => {
    expect(validateAddLines(input).status).toBe('invalid');
  });
});

describe('validateUpdateLines and validateLineIds', () => {
  it('accepts a line id with a quantity from 1 to 99', () => {
    expect(
      validateUpdateLines([{id: LINE, quantity: 3, merchandiseId: 'ignored'}]),
    ).toEqual({
      status: 'ok',
      value: [{id: LINE, quantity: 3}],
    });
    expect(
      validateUpdateLines([{id: 'gid://shopify/CartLine/60639', quantity: 1}])
        .status,
    ).toBe('ok');
  });

  it.each([
    [{id: 'x', quantity: 1}],
    [{id: LINE, quantity: 0}],
    [{id: LINE, quantity: 100}],
    [{id: VARIANT, quantity: 1}],
  ])('rejects update %j', (line) => {
    expect(validateUpdateLines([line]).status).toBe('invalid');
  });

  it('validates line ids for removal', () => {
    expect(validateLineIds([LINE])).toEqual({status: 'ok', value: [LINE]});
    expect(validateLineIds([LINE, 'nope']).status).toBe('invalid');
    expect(validateLineIds([]).status).toBe('invalid');
    expect(validateLineIds('x').status).toBe('invalid');
  });
});

describe('validateDiscountCodes', () => {
  it('puts the typed code first and keeps valid existing codes', () => {
    expect(
      validateDiscountCodes('NEW10', ['OLD5', 'bad code', 'OLD5', 7]),
    ).toEqual({
      status: 'ok',
      value: ['NEW10', 'OLD5'],
    });
  });

  it('removes all codes when nothing is typed and nothing exists', () => {
    expect(validateDiscountCodes('', [])).toEqual({status: 'ok', value: []});
    expect(validateDiscountCodes(undefined, undefined)).toEqual({
      status: 'ok',
      value: [],
    });
  });

  it('rejects a typed code with unexpected characters', () => {
    expect(validateDiscountCodes('<script>', []).status).toBe('invalid');
    expect(validateDiscountCodes('a b', []).status).toBe('invalid');
  });

  it('caps the list', () => {
    const existing = Array.from({length: 12}, (_, i) => `C${i}`);
    const result = validateDiscountCodes('NEW', existing);
    expect(result.status === 'ok' && result.value).toHaveLength(5);
  });
});
