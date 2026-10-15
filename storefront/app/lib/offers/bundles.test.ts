import {describe, expect, it} from 'vitest';
import {
  addAllPayload,
  bundleCartStatus,
  bundleCompletions,
  bundleMemberVariantIds,
  bundleMembership,
  reconcileAddAll,
  type BundleLine,
} from '~/lib/offers/bundles';
import type {BundleRule} from '~/lib/offers/types';
import {
  BUNDLE,
  PRODUCT,
  RULES,
  VARIANT,
  makeCart,
  makeLine,
  mattressA,
} from '~/lib/offers/test-fixtures';

const QUEEN_LINES: BundleLine[] = [
  {
    variantId: VARIANT.aQueen,
    productId: PRODUCT.mattressA,
    quantity: 1,
    isAnchor: true,
  },
  {
    variantId: VARIANT.foundQueen,
    productId: PRODUCT.foundation,
    quantity: 1,
    isAnchor: false,
  },
  {
    variantId: VARIANT.pillow,
    productId: PRODUCT.pillow,
    quantity: 2,
    isAnchor: false,
  },
];

// REQ-ADD-002 (Add all in one operation, partial failure reported), REQ-PROMO-002, REQ-CAT-008.
describe('bundleMembership (REQ-ADD-002)', () => {
  it.each([
    [PRODUCT.mattressA, 'anchor'],
    [PRODUCT.foundation, 'member'],
    [PRODUCT.pillow, 'member'],
  ])('%s is the %s of the bundle', (productId, role) => {
    expect(bundleMembership([BUNDLE], productId)).toEqual([
      {bundle: BUNDLE, role},
    ]);
  });

  it('is empty for an unrelated product and for no bundles', () => {
    expect(bundleMembership([BUNDLE], PRODUCT.other)).toEqual([]);
    expect(bundleMembership([], PRODUCT.mattressA)).toEqual([]);
  });

  it('lists every variant a companion can resolve to', () => {
    expect([...bundleMemberVariantIds(BUNDLE)].sort()).toEqual(
      [VARIANT.foundQueen, VARIANT.foundKing, VARIANT.pillow].sort(),
    );
  });
});

describe('addAllPayload: matching sizes in one call (REQ-ADD-002)', () => {
  it('lists the anchor and every companion in the selected size', () => {
    expect(
      addAllPayload(BUNDLE, {anchorVariantId: VARIANT.aQueen, size: 'Queen'}),
    ).toEqual({
      status: 'ok',
      bundleId: 'bundle-sleep',
      lines: QUEEN_LINES,
    });
  });

  it('switches the companion variant when the size changes', () => {
    const payload = addAllPayload(BUNDLE, {
      anchorVariantId: VARIANT.aKing,
      size: 'king',
    });
    expect(payload).toMatchObject({status: 'ok'});
    const variants =
      payload.status === 'ok' ? payload.lines.map((l) => l.variantId) : [];
    expect(variants).toEqual([
      VARIANT.aKing,
      VARIANT.foundKing,
      VARIANT.pillow,
    ]);
  });

  it('is all-or-nothing when a companion has no variant for the size', () => {
    expect(
      addAllPayload(BUNDLE, {anchorVariantId: VARIANT.aTwin, size: 'Twin'}),
    ).toEqual({
      status: 'unavailable',
      bundleId: 'bundle-sleep',
      reason: 'size-not-offered',
      productIds: [PRODUCT.foundation],
    });
  });

  it.each([null, '', 'constructor', '__proto__'])(
    'is unavailable for the size %j',
    (size) => {
      expect(
        addAllPayload(BUNDLE, {anchorVariantId: VARIANT.aQueen, size}),
      ).toMatchObject({
        status: 'unavailable',
        reason: 'size-not-offered',
      });
    },
  );

  it('is unavailable when any line is not in the available set', () => {
    const available = new Set([VARIANT.aQueen, VARIANT.pillow]);
    expect(
      addAllPayload(BUNDLE, {
        anchorVariantId: VARIANT.aQueen,
        size: 'Queen',
        availableVariantIds: available,
      }),
    ).toEqual({
      status: 'unavailable',
      bundleId: 'bundle-sleep',
      reason: 'variant-unavailable',
      productIds: [PRODUCT.foundation],
    });
  });

  it('is ok when every line is available', () => {
    const available = new Set(QUEEN_LINES.map((l) => l.variantId));
    expect(
      addAllPayload(BUNDLE, {
        anchorVariantId: VARIANT.aQueen,
        size: 'Queen',
        availableVariantIds: available,
      }).status,
    ).toBe('ok');
  });

  it('rejects an empty anchor variant', () => {
    expect(
      addAllPayload(BUNDLE, {anchorVariantId: '', size: 'Queen'}),
    ).toMatchObject({
      status: 'unavailable',
      reason: 'invalid-selection',
    });
  });

  it.each([0, -1, 1.5, Number.NaN, 11, 1000])(
    'rejects a bundle member quantity of %s as a rule mistake',
    (quantity) => {
      const rule: BundleRule = {
        ...BUNDLE,
        members: [
          {
            productId: PRODUCT.pillow,
            quantity,
            variants: {type: 'single', variantId: VARIANT.pillow},
          },
        ],
      };
      expect(
        addAllPayload(rule, {anchorVariantId: VARIANT.aQueen, size: 'Queen'}),
      ).toMatchObject({
        status: 'unavailable',
        reason: 'invalid-rule',
      });
    },
  );

  it('rejects a bundle without companions', () => {
    expect(
      addAllPayload(
        {...BUNDLE, members: []},
        {anchorVariantId: VARIANT.aQueen, size: 'Queen'},
      ),
    ).toMatchObject({status: 'unavailable', reason: 'invalid-rule'});
  });

  it('merges companions that resolve to the same variant into one line', () => {
    const rule: BundleRule = {
      ...BUNDLE,
      members: [
        {
          productId: PRODUCT.pillow,
          quantity: 1,
          variants: {type: 'single', variantId: VARIANT.pillow},
        },
        {
          productId: PRODUCT.pillow,
          quantity: 2,
          variants: {type: 'single', variantId: VARIANT.pillow},
        },
      ],
    };
    const payload = addAllPayload(rule, {
      anchorVariantId: VARIANT.aQueen,
      size: 'Queen',
    });
    const lines = payload.status === 'ok' ? payload.lines : [];
    expect(lines).toHaveLength(2);
    expect(lines.find((l) => l.variantId === VARIANT.pillow)?.quantity).toBe(3);
  });

  it('never carries a price', () => {
    const payload = addAllPayload(BUNDLE, {
      anchorVariantId: VARIANT.aQueen,
      size: 'Queen',
    });
    const keys =
      payload.status === 'ok'
        ? payload.lines.flatMap((l) => Object.keys(l))
        : [];
    expect(new Set(keys)).toEqual(
      new Set(['variantId', 'productId', 'quantity', 'isAnchor']),
    );
  });
});

describe('reconcileAddAll: partial failure (REQ-ADD-002)', () => {
  it('is complete when everything was added', () => {
    const added = QUEEN_LINES.map(({variantId, quantity}) => ({
      variantId,
      quantity,
    }));
    expect(reconcileAddAll(QUEEN_LINES, added)).toEqual({status: 'complete'});
  });

  it('reports a partial add with what to retry', () => {
    const result = reconcileAddAll(QUEEN_LINES, [
      {variantId: VARIANT.aQueen, quantity: 1},
      {variantId: VARIANT.pillow, quantity: 1},
    ]);
    expect(result).toEqual({
      status: 'partial',
      added: [
        {variantId: VARIANT.aQueen, quantity: 1},
        {variantId: VARIANT.pillow, quantity: 1},
      ],
      shortfalls: [
        {
          variantId: VARIANT.foundQueen,
          productId: PRODUCT.foundation,
          requested: 1,
          added: 0,
          missing: 1,
        },
        {
          variantId: VARIANT.pillow,
          productId: PRODUCT.pillow,
          requested: 2,
          added: 1,
          missing: 1,
        },
      ],
      retryLines: [
        {
          variantId: VARIANT.foundQueen,
          productId: PRODUCT.foundation,
          quantity: 1,
          isAnchor: false,
        },
        {
          variantId: VARIANT.pillow,
          productId: PRODUCT.pillow,
          quantity: 1,
          isAnchor: false,
        },
      ],
    });
  });

  it('reports a total failure', () => {
    const result = reconcileAddAll(QUEEN_LINES, []);
    expect(result).toMatchObject({status: 'failed'});
    expect(result.status === 'failed' ? result.retryLines : []).toEqual(
      QUEEN_LINES,
    );
  });

  it('cannot be fooled by extra, negative, fractional or unknown additions', () => {
    const result = reconcileAddAll(QUEEN_LINES, [
      {variantId: VARIANT.aQueen, quantity: 5},
      {variantId: VARIANT.foundQueen, quantity: -1},
      {variantId: VARIANT.pillow, quantity: 0.5},
      {variantId: 'v-not-requested', quantity: 99},
      {variantId: VARIANT.pillow, quantity: Number.NaN},
    ]);
    expect(result).toMatchObject({
      status: 'partial',
      added: [{variantId: VARIANT.aQueen, quantity: 1}],
    });
    expect(
      result.status === 'partial'
        ? result.shortfalls.map((s) => s.missing)
        : [],
    ).toEqual([1, 2]);
  });

  it('sums additions reported on several lines of one variant', () => {
    const result = reconcileAddAll(
      [
        {
          variantId: VARIANT.pillow,
          productId: PRODUCT.pillow,
          quantity: 2,
          isAnchor: false,
        },
      ],
      [
        {variantId: VARIANT.pillow, quantity: 1},
        {variantId: VARIANT.pillow, quantity: 1},
      ],
    );
    expect(result).toEqual({status: 'complete'});
  });

  it('is complete for an empty request', () => {
    expect(reconcileAddAll([], [])).toEqual({status: 'complete'});
  });
});

describe('bundleCartStatus (REQ-PROMO-002)', () => {
  const member = (variantId: string, productId: string, quantity = 1) =>
    makeLine({id: `m-${variantId}`, variantId, productId, quantity});

  it('is complete when every companion is in the cart in the anchor size', () => {
    const cart = makeCart([
      mattressA('Queen'),
      member(VARIANT.foundQueen, PRODUCT.foundation),
      member(VARIANT.pillow, PRODUCT.pillow, 2),
    ]);
    expect(bundleCartStatus(BUNDLE, cart, RULES)).toEqual([
      {anchorLineId: 'mattress-queen', complete: true, missingProductIds: []},
    ]);
  });

  it('reports the missing companion after one is removed', () => {
    const cart = makeCart([
      mattressA('Queen'),
      member(VARIANT.pillow, PRODUCT.pillow, 2),
    ]);
    expect(bundleCartStatus(BUNDLE, cart, RULES)).toEqual([
      {
        anchorLineId: 'mattress-queen',
        complete: false,
        missingProductIds: [PRODUCT.foundation],
      },
    ]);
  });

  it('does not count a companion in the wrong size', () => {
    const cart = makeCart([
      mattressA('Queen'),
      member(VARIANT.foundKing, PRODUCT.foundation),
      member(VARIANT.pillow, PRODUCT.pillow, 2),
    ]);
    expect(bundleCartStatus(BUNDLE, cart, RULES)[0]?.missingProductIds).toEqual(
      [PRODUCT.foundation],
    );
  });

  it('needs enough units for an anchor quantity above one', () => {
    const cart = makeCart([
      mattressA('Queen', {quantity: 2}),
      member(VARIANT.foundQueen, PRODUCT.foundation, 1),
      member(VARIANT.pillow, PRODUCT.pillow, 4),
    ]);
    expect(bundleCartStatus(BUNDLE, cart, RULES)[0]?.missingProductIds).toEqual(
      [PRODUCT.foundation],
    );
  });

  it('is empty without an anchor line and ignores malformed anchors', () => {
    expect(
      bundleCartStatus(
        BUNDLE,
        makeCart([member(VARIANT.pillow, PRODUCT.pillow)]),
        RULES,
      ),
    ).toEqual([]);
    expect(
      bundleCartStatus(
        BUNDLE,
        makeCart([mattressA('Queen', {quantity: -1})]),
        RULES,
      ),
    ).toEqual([]);
  });
});

// REQ-ADD-002 / REQ-PROMO-002: what an anchor line in the cart still needs to complete a bundle.
describe('bundleCompletions', () => {
  const completionsFor = (
    lines: Parameters<typeof makeCart>[0],
    rule: BundleRule = BUNDLE,
  ) => bundleCompletions(rule, makeCart(lines), RULES);

  it('lists every companion in the anchor size when the cart has only the anchor', () => {
    const [completion] = completionsFor([mattressA('Queen')]);
    expect(completion).toMatchObject({
      bundleId: BUNDLE.id,
      anchorLineId: 'mattress-queen',
      state: 'incomplete',
      memberVariantIds: [VARIANT.foundQueen, VARIANT.pillow],
    });
    expect(completion?.missing).toEqual([
      {
        variantId: VARIANT.foundQueen,
        productId: PRODUCT.foundation,
        quantity: 1,
        isAnchor: false,
      },
      {
        variantId: VARIANT.pillow,
        productId: PRODUCT.pillow,
        quantity: 2,
        isAnchor: false,
      },
    ]);
  });

  it('lists only what is still missing', () => {
    const [completion] = completionsFor([
      mattressA('Queen'),
      makeLine({
        id: 'pillows',
        variantId: VARIANT.pillow,
        productId: PRODUCT.pillow,
        quantity: 1,
      }),
    ]);
    expect(completion?.state).toBe('incomplete');
    expect(
      completion?.missing.map((line) => [line.variantId, line.quantity]),
    ).toEqual([
      [VARIANT.foundQueen, 1],
      [VARIANT.pillow, 1],
    ]);
  });

  it('is complete, with nothing to add, when every companion is in the cart', () => {
    const [completion] = completionsFor([
      mattressA('Queen'),
      makeLine({
        id: 'f',
        variantId: VARIANT.foundQueen,
        productId: PRODUCT.foundation,
      }),
      makeLine({
        id: 'p',
        variantId: VARIANT.pillow,
        productId: PRODUCT.pillow,
        quantity: 2,
      }),
    ]);
    expect(completion).toMatchObject({state: 'complete', missing: []});
  });

  it('scales the companions with the anchor quantity', () => {
    const [completion] = completionsFor([mattressA('Queen', {quantity: 2})]);
    expect(completion?.missing.map((line) => line.quantity)).toEqual([2, 4]);
  });

  it('does not let one foundation complete two mattresses of the same size', () => {
    const completions = completionsFor([
      mattressA('Queen', {id: 'q1'}),
      mattressA('Queen', {id: 'q2'}),
      makeLine({
        id: 'f',
        variantId: VARIANT.foundQueen,
        productId: PRODUCT.foundation,
      }),
      makeLine({
        id: 'p',
        variantId: VARIANT.pillow,
        productId: PRODUCT.pillow,
        quantity: 2,
      }),
    ]);
    expect(completions.map((c) => [c.anchorLineId, c.state])).toEqual([
      ['q1', 'complete'],
      ['q2', 'incomplete'],
    ]);
  });

  it('is unavailable (never a partial bundle) when a companion has no variant in the anchor size', () => {
    const [completion] = completionsFor([mattressA('Twin')]);
    expect(completion).toMatchObject({state: 'unavailable', missing: []});
  });

  it('is unavailable for an invalid rule (a member quantity of 0 or 1000)', () => {
    for (const quantity of [0, 1000]) {
      const rule: BundleRule = {
        ...BUNDLE,
        members: [{...BUNDLE.members[1]!, quantity}],
      };
      const [completion] = completionsFor([mattressA('Queen')], rule);
      expect(completion?.state).toBe('unavailable');
    }
  });

  it('is unavailable when it would need more units than one cart line may hold', () => {
    const [completion] = completionsFor([mattressA('Queen', {quantity: 50})]);
    expect(completion?.state).toBe('unavailable');
  });

  it('only an ordinary line anchors a bundle: a gift line of the anchor product does not', () => {
    const completions = completionsFor([
      mattressA('Queen', {role: 'gift', id: 'g'}),
    ]);
    expect(completions).toEqual([]);
  });

  it('says nothing when the anchor product is not in the cart', () => {
    expect(
      completionsFor([makeLine({id: 'x', productId: PRODUCT.other})]),
    ).toEqual([]);
  });
});
