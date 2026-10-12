import {describe, expect, it} from 'vitest';
import {
  EXTEND_LINE_ATTRIBUTES,
  computeLinkOperations,
  isCartLinkingClean,
  validateCoverageLine,
  type CartLineLike,
  type LinkOperation,
} from '~/lib/extend/linking';
import type {PlanQuote} from '~/lib/extend/types';

const COVERAGE_VARIANTS = new Set(['v-cov-79', 'v-cov-99']);

function mattress(overrides: Partial<CartLineLike> = {}): CartLineLike {
  return {
    id: 'L1',
    variantId: 'v-mattress-queen',
    productId: 'gid://shopify/Product/501',
    quantity: 1,
    parentLineId: null,
    attributes: {},
    ...overrides,
  };
}

function coverage(overrides: Partial<CartLineLike> = {}): CartLineLike {
  return {
    id: 'C1',
    variantId: 'v-cov-79',
    productId: 'gid://shopify/Product/9001',
    quantity: 1,
    parentLineId: 'L1',
    attributes: {
      [EXTEND_LINE_ATTRIBUTES.planId]: 'MOCK-MATT-ADH-3Y-C',
      [EXTEND_LINE_ATTRIBUTES.coveredProductId]: '501',
      [EXTEND_LINE_ATTRIBUTES.term]: '36',
    },
    unitPriceCents: 7999,
    ...overrides,
  };
}

function run(lines: CartLineLike[], quotes?: ReadonlyMap<string, PlanQuote>) {
  return computeLinkOperations({
    lines,
    coverageVariantIds: COVERAGE_VARIANTS,
    ...(quotes === undefined ? {} : {quotes}),
  });
}

function apply(
  lines: CartLineLike[],
  operations: LinkOperation[],
): CartLineLike[] {
  const removed = new Set(
    operations.filter((op) => op.type === 'remove').map((op) => op.lineId),
  );
  const quantities = new Map(
    operations.flatMap((op) =>
      op.type === 'setQuantity' ? [[op.lineId, op.quantity] as const] : [],
    ),
  );
  return lines
    .filter((line) => !removed.has(line.id))
    .map((line) => ({
      ...line,
      quantity: quantities.get(line.id) ?? line.quantity,
    }));
}

describe('coverage linking (REQ-EXT-002, T-06)', () => {
  it('leaves a valid cart alone', () => {
    const result = run([mattress(), coverage()]);
    expect(result).toEqual({operations: [], flags: []});
    expect(isCartLinkingClean(result)).toBe(true);
  });

  it('ignores a cart with no coverage', () => {
    expect(run([mattress(), mattress({id: 'L2', productId: '502'})])).toEqual({
      operations: [],
      flags: [],
    });
  });

  describe('quantity follows the covered item', () => {
    it.each([
      [3, 1, 3],
      [1, 5, 1],
      [2, 0, 2],
      [4, -1, 4],
      [2, 1.5, 2],
      [2, Number.NaN, 2],
    ])(
      'parent %i, child %s -> child set to %i',
      (parentQty, childQty, expected) => {
        const result = run([
          mattress({quantity: parentQty}),
          coverage({quantity: childQty}),
        ]);
        expect(result.operations).toEqual([
          {type: 'setQuantity', lineId: 'C1', quantity: expected},
        ]);
      },
    );

    it('does nothing when quantities already match', () => {
      expect(
        run([mattress({quantity: 4}), coverage({quantity: 4})]).operations,
      ).toEqual([]);
    });
  });

  describe('hostile carts', () => {
    it('removes coverage added alone (no parent)', () => {
      const result = run([coverage({parentLineId: null})]);
      expect(result.operations).toEqual([
        {type: 'remove', lineId: 'C1', reason: 'no_parent'},
      ]);
    });

    it('removes coverage whose parent was removed from the cart', () => {
      const result = run([coverage({parentLineId: 'L1'})]);
      expect(result.operations).toEqual([
        {type: 'remove', lineId: 'C1', reason: 'parent_missing'},
      ]);
    });

    it('removes coverage that points at an unknown parent id', () => {
      const result = run([
        mattress(),
        coverage({parentLineId: 'does-not-exist'}),
      ]);
      expect(result.operations).toEqual([
        {type: 'remove', lineId: 'C1', reason: 'parent_missing'},
      ]);
    });

    it.each([
      ['a different product', '502'],
      ['a product id with extra characters', '501abc'],
      ['an empty value', ''],
      ['markup', '<script>alert(1)</script>'],
      ['a negative number', '-501'],
    ])('removes coverage whose covered product id is %s', (_label, value) => {
      const result = run([
        mattress(),
        coverage({
          attributes: {
            ...coverage().attributes,
            [EXTEND_LINE_ATTRIBUTES.coveredProductId]: value,
          },
        }),
      ]);
      expect(result.operations).toEqual([
        {type: 'remove', lineId: 'C1', reason: 'covered_product_mismatch'},
      ]);
    });

    it('removes coverage with no covered product attribute at all', () => {
      const result = run([
        mattress(),
        coverage({attributes: {[EXTEND_LINE_ATTRIBUTES.planId]: 'P1'}}),
      ]);
      expect(result.operations).toEqual([
        {type: 'remove', lineId: 'C1', reason: 'covered_product_mismatch'},
      ]);
    });

    it('treats a GID and a bare number for the same product as equal', () => {
      const result = run([
        mattress({productId: '501'}),
        coverage({
          attributes: {
            ...coverage().attributes,
            [EXTEND_LINE_ATTRIBUTES.coveredProductId]:
              'gid://shopify/Product/501',
          },
        }),
      ]);
      expect(result.operations).toEqual([]);
    });

    it.each([
      ['missing', undefined],
      ['empty', ''],
      ['with spaces', 'PLAN 1'],
      ['markup', '<img src=x onerror=alert(1)>'],
      ['too long', 'P'.repeat(101)],
    ])('removes coverage with a plan id that is %s', (_label, planId) => {
      const attributes: Record<string, string> = {
        [EXTEND_LINE_ATTRIBUTES.coveredProductId]: '501',
      };
      if (planId !== undefined)
        attributes[EXTEND_LINE_ATTRIBUTES.planId] = planId;
      const result = run([mattress(), coverage({attributes})]);
      expect(result.operations).toEqual([
        {type: 'remove', lineId: 'C1', reason: 'invalid_plan_id'},
      ]);
    });

    it('keeps the first of two coverage lines on one parent and removes the duplicate', () => {
      const result = run([
        mattress({quantity: 2}),
        coverage({id: 'C1', quantity: 2}),
        coverage({id: 'C2', variantId: 'v-cov-99', quantity: 2}),
      ]);
      expect(result.operations).toEqual([
        {type: 'remove', lineId: 'C2', reason: 'duplicate_coverage'},
      ]);
    });

    it('still fixes the quantity of the kept line when duplicates are removed', () => {
      const result = run([
        mattress({quantity: 2}),
        coverage({id: 'C1', quantity: 5}),
        coverage({id: 'C2', variantId: 'v-cov-99', quantity: 1}),
      ]);
      expect(result.operations).toEqual([
        {type: 'setQuantity', lineId: 'C1', quantity: 2},
        {type: 'remove', lineId: 'C2', reason: 'duplicate_coverage'},
      ]);
    });

    it('removes coverage nested under another coverage line', () => {
      const result = run([
        mattress(),
        coverage({id: 'C1'}),
        coverage({id: 'C2', variantId: 'v-cov-99', parentLineId: 'C1'}),
      ]);
      expect(result.operations).toEqual([
        {type: 'remove', lineId: 'C2', reason: 'parent_is_coverage'},
      ]);
    });

    it.each([[0], [-1], [1.5], [Number.NaN], [Number.POSITIVE_INFINITY]])(
      'removes coverage when the parent quantity is %s (cannot follow it)',
      (qty) => {
        const result = run([mattress({quantity: qty}), coverage()]);
        expect(result.operations).toEqual([
          {type: 'remove', lineId: 'C1', reason: 'invalid_parent_quantity'},
        ]);
      },
    );

    it('only ever removes coverage lines, never the covered item', () => {
      const result = run([
        mattress({attributes: {[EXTEND_LINE_ATTRIBUTES.planId]: 'P1'}}),
        coverage({parentLineId: null}),
      ]);
      expect(result.operations.every((op) => op.lineId === 'C1')).toBe(true);
      expect(result.flags).toEqual([
        {lineId: 'L1', reason: 'unexpected_extend_attributes'},
      ]);
    });

    it('does not treat a normal line as coverage just because of its variant name', () => {
      // Only variants in the catalog set are coverage; a random variant id is a normal line.
      const result = run([
        mattress(),
        mattress({id: 'L2', variantId: 'v-cov-unlisted', parentLineId: null}),
      ]);
      expect(result.operations).toEqual([]);
    });
  });

  describe('price flags (a coverage line whose price differs from the plan price)', () => {
    const quotes = new Map<string, PlanQuote>([
      ['MOCK-MATT-ADH-3Y-C', {planId: 'MOCK-MATT-ADH-3Y-C', priceCents: 7999}],
    ]);

    it('is clean when the Shopify price equals the quote', () => {
      expect(run([mattress(), coverage()], quotes).flags).toEqual([]);
    });

    it.each([[7998], [8000], [4999], [1]])(
      'flags a line priced %i against a 7999 quote',
      (price) => {
        const result = run(
          [mattress(), coverage({unitPriceCents: price})],
          quotes,
        );
        expect(result.flags).toEqual([
          {lineId: 'C1', reason: 'price_mismatch'},
        ]);
        expect(isCartLinkingClean(result)).toBe(false);
      },
    );

    it('flags a plan id that has no fresh quote', () => {
      const result = run([mattress(), coverage()], new Map());
      expect(result.flags).toEqual([{lineId: 'C1', reason: 'plan_unverified'}]);
    });

    it('does not flag when quotes are unavailable (Extend down) or the price is unknown', () => {
      expect(run([mattress(), coverage()]).flags).toEqual([]);
      const {unitPriceCents: _unused, ...withoutPrice} = coverage();
      expect(run([mattress(), withoutPrice], quotes).flags).toEqual([]);
    });
  });

  describe('properties', () => {
    const carts: Array<[string, CartLineLike[]]> = [
      ['valid', [mattress(), coverage()]],
      ['alone', [coverage({parentLineId: null})]],
      ['qty tamper', [mattress({quantity: 2}), coverage({quantity: 9})]],
      [
        'duplicates',
        [mattress(), coverage(), coverage({id: 'C2', variantId: 'v-cov-99'})],
      ],
      ['wrong product', [mattress({productId: '502'}), coverage()]],
      [
        'two parents',
        [
          mattress({id: 'L1'}),
          mattress({id: 'L2', productId: '502', quantity: 3}),
          coverage({id: 'C1', parentLineId: 'L1'}),
          coverage({
            id: 'C2',
            parentLineId: 'L2',
            quantity: 1,
            attributes: {
              ...coverage().attributes,
              [EXTEND_LINE_ATTRIBUTES.coveredProductId]: '502',
            },
          }),
        ],
      ],
    ];

    it.each(carts)('%s: at most one operation per line', (_label, lines) => {
      const ids = run(lines).operations.map((op) => op.lineId);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it.each(carts)(
      '%s: applying the operations yields a cart that needs no more operations',
      (_label, lines) => {
        const fixed = apply(lines, run(lines).operations);
        expect(run(fixed).operations).toEqual([]);
      },
    );

    it('is deterministic and does not mutate its input', () => {
      const lines = [mattress({quantity: 2}), coverage({quantity: 9})];
      const snapshot = JSON.stringify(lines);
      expect(run(lines)).toEqual(run(lines));
      expect(JSON.stringify(lines)).toBe(snapshot);
    });
  });
});

describe('validateCoverageLine (REQ-EXT-002)', () => {
  const lines = [mattress(), coverage()];
  const context = {
    byId: new Map(lines.map((line) => [line.id, line])),
    coverageVariantIds: COVERAGE_VARIANTS,
  };

  it('accepts a coverage line linked to the matching parent', () => {
    expect(validateCoverageLine(coverage(), context)).toEqual({valid: true});
  });

  it('rejects a line with no parent', () => {
    expect(
      validateCoverageLine(coverage({parentLineId: null}), context),
    ).toEqual({
      valid: false,
      reason: 'no_parent',
    });
  });
});
