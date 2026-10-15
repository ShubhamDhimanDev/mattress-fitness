import {describe, expect, it} from 'vitest';
import {comfortProtectorVariantFor} from '~/lib/offers/comfort';
import {applyCorrections} from '~/lib/offers/corrections';
import {evaluateOffers, revalidationOutcome} from '~/lib/offers/evaluate';
import type {
  CartLike,
  CartLineLike,
  OfferContext,
  OfferRules,
} from '~/lib/offers/types';
import {EMPTY_OFFER_RULES} from '~/lib/offers/types';
import {
  IN_ZONE_ZIP,
  OUT_OF_ZONE_ZIP,
  PRODUCT,
  RULES,
  VARIANT,
  ZONE,
  deepFreeze,
  makeLine,
} from '~/lib/offers/test-fixtures';

// Property-style loop for REQ-PRE-006 and REQ-PROMO-003: many generated (and hostile) carts, all seeded so a
// failure can be replayed from the case number printed in the assertion message.

type Random = () => number;

function mulberry32(seed: number): Random {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: Random, values: readonly T[]): T {
  const value = values[Math.floor(random() * values.length)];
  if (value === undefined) throw new Error('pick() needs a non-empty list');
  return value;
}

const SIZES = [
  'Twin',
  'Queen',
  'King',
  'Split King',
  'Cal King',
  'Full',
  ' queen ',
  'constructor',
  null,
];
const VALID_QUANTITIES = [
  1,
  1,
  1,
  1,
  1,
  2,
  2,
  3,
  4,
  5,
  10,
  100,
  Number.MAX_SAFE_INTEGER,
];
const HOSTILE_QUANTITIES = [
  ...VALID_QUANTITIES,
  0,
  -1,
  1.5,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  2 ** 60,
];

type Kind =
  | 'mattressA'
  | 'mattressB'
  | 'premium'
  | 'other'
  | 'foundation'
  | 'pillow'
  | 'protector'
  | 'gift'
  | 'haul'
  | 'coverage';
const KINDS: readonly Kind[] = [
  'mattressA',
  'mattressA',
  'mattressB',
  'premium',
  'other',
  'foundation',
  'pillow',
  'protector',
  'protector',
  'gift',
  'gift',
  'haul',
  'haul',
  'coverage',
  'coverage',
];

function lineFor(
  kind: Kind,
  id: string,
  random: Random,
): Partial<CartLineLike> {
  switch (kind) {
    case 'mattressA':
      return {
        id,
        productId: PRODUCT.mattressA,
        variantId: `v-a-${id}`,
        size: pick(random, SIZES),
      };
    case 'mattressB':
      return {
        id,
        productId: PRODUCT.mattressB,
        variantId: VARIANT.bQueen,
        size: 'Queen',
      };
    case 'premium':
      return {
        id,
        productId: 'p-premium',
        variantId: 'v-premium',
        collectionIds: ['c-premium'],
        size: 'Queen',
      };
    case 'other':
      return {id, variantId: VARIANT.other};
    case 'foundation':
      return {
        id,
        productId: PRODUCT.foundation,
        variantId: pick(random, [VARIANT.foundQueen, VARIANT.foundKing]),
      };
    case 'pillow':
      return {id, productId: PRODUCT.pillow, variantId: VARIANT.pillow};
    case 'protector':
      return {
        id,
        productId: PRODUCT.protector,
        role: 'protector',
        variantId: pick(random, [
          VARIANT.protTwin,
          VARIANT.protQueen,
          VARIANT.protKing,
          VARIANT.protCalKing,
        ]),
      };
    case 'gift':
      return {
        id,
        productId: PRODUCT.giftPillow,
        role: 'gift',
        variantId: pick(random, [
          VARIANT.giftStandard,
          VARIANT.giftKing,
          VARIANT.giftSheetsQueen,
          'v-gift-expired',
        ]),
      };
    case 'haul':
      return {
        id,
        productId: PRODUCT.haul,
        role: 'haul-away',
        variantId: VARIANT.haul,
      };
    case 'coverage':
      return {
        id,
        productId: PRODUCT.coverage,
        role: 'coverage',
        variantId: pick(random, [VARIANT.cov199, VARIANT.cov299]),
      };
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

function generateCart(random: Random): CartLike {
  const hostile = random() < 0.3;
  const quantities = hostile ? HOSTILE_QUANTITIES : VALID_QUANTITIES;
  const count = Math.floor(random() * 11);
  const ids: string[] = [];
  const specs: Partial<CartLineLike>[] = [];

  for (let index = 0; index < count; index++) {
    // Occasionally reuse an id to model a malformed cart with two lines claiming one id.
    const id =
      hostile && ids.length > 0 && random() < 0.05
        ? pick(random, ids)
        : `l${index}`;
    ids.push(id);
    specs.push({
      ...lineFor(pick(random, KINDS), id, random),
      quantity: pick(random, quantities),
    });
  }

  const lines = specs.map((spec) => {
    const wantsParent = spec.role === 'coverage' || random() < 0.1;
    const parentLineId = wantsParent
      ? pick(random, [...ids, ...ids, null, 'ghost', spec.id ?? null])
      : null;
    return makeLine({id: 'unused', ...spec, parentLineId});
  });

  const attributes: Record<string, string> = {};
  for (const key of [
    'delivery_choice',
    'offer_declined_comfort_guarantee',
    'offer_declined_haul_away',
    'offer_declined_protection',
    'noise',
  ]) {
    if (random() < 0.4)
      attributes[key] = pick(random, [
        'yes',
        'no',
        'maybe',
        '',
        'YES',
        'pickup',
        'in-home',
      ]);
  }

  return {
    lines,
    attributes,
    subtotalCents: pick(random, [
      0,
      1,
      50_000,
      99_899,
      99_900,
      1_000_000,
      -5,
      Number.NaN,
      1.5,
    ]),
  };
}

const RULE_SETS: readonly OfferRules[] = [
  RULES,
  RULES,
  RULES,
  {...RULES, haulAway: null},
  {...RULES, comfortGuarantee: null},
  {...RULES, haulAway: {variantId: VARIANT.haul, maxPieces: 1}},
  {...RULES, gifts: RULES.gifts.map((rule) => ({...rule, maxQuantity: 2}))},
  {...RULES, gifts: RULES.gifts.map((rule) => ({...rule, maxQuantity: 0}))},
  EMPTY_OFFER_RULES,
];

function generateContext(random: Random, cart: CartLike): OfferContext {
  return {
    zip: pick(random, [
      IN_ZONE_ZIP,
      IN_ZONE_ZIP,
      '60645-1234',
      OUT_OF_ZONE_ZIP,
      null,
      'bad',
      '',
    ]),
    deliveryChoice: pick(random, [
      'in-home',
      'in-home',
      'pickup',
      null,
    ] as const),
    zone: pick(random, [ZONE, ZONE, ZONE, null]),
    protectionEligibleLineIds: cart.lines
      .map((line) => line.id)
      .filter(() => random() < 0.6)
      .concat(random() < 0.2 ? ['ghost'] : []),
  };
}

const isValid = (quantity: unknown): quantity is number =>
  typeof quantity === 'number' &&
  Number.isSafeInteger(quantity) &&
  quantity >= 1;

// 4000 generated carts, each evaluated several times: it can pass 5 s on a quiet machine and not under load, so it has a real budget.
const CASES = 4000;

describe('evaluateOffers properties over generated carts (REQ-PRE-006, REQ-PROMO-003, REQ-PRE-003)', () => {
  it(`holds for ${CASES} seeded carts: deterministic, idempotent, monotone, invariant-preserving`, () => {
    const random = mulberry32(20261012);
    let corrected = 0;
    let rejected = 0;
    let clean = 0;

    for (let index = 0; index < CASES; index++) {
      const cart = deepFreeze(generateCart(random));
      const rules = pick(random, RULE_SETS);
      const context = deepFreeze(generateContext(random, cart));
      const note = `case ${index}`;

      const result = evaluateOffers(cart, rules, context);

      // Deterministic, and the frozen input was not mutated (a mutation would have thrown).
      expect(evaluateOffers(cart, rules, context), note).toEqual(result);
      expect(
        result.steps.map((step) => step.id),
        note,
      ).toEqual(['comfort-guarantee', 'haul-away', 'accident-protection']);
      for (const step of result.steps) {
        expect(step.applies === (step.status !== 'not-applicable'), note).toBe(
          true,
        );
      }

      // Corrections are monotone: they name real, well-formed lines once, and only ever lower a quantity.
      const named = new Set<string>();
      for (const correction of result.corrections) {
        const original = cart.lines.find(
          (line) => line.id === correction.lineId,
        );
        expect(original, note).toBeDefined();
        expect(isValid(original?.quantity), note).toBe(true);
        expect(
          named.has(correction.lineId),
          `${note}: ${correction.lineId} corrected twice`,
        ).toBe(false);
        named.add(correction.lineId);
        const lowered =
          correction.type === 'remove-line' ||
          (correction.previousQuantity === original?.quantity &&
            correction.quantity >= 1 &&
            correction.quantity < correction.previousQuantity);
        expect(lowered, `${note}: ${JSON.stringify(correction)}`).toBe(true);
      }

      // Applying them never adds a line and never raises a quantity: survivors line up with the originals.
      const applied = applyCorrections(cart, result.corrections);
      const removedIds = new Set(
        result.corrections
          .filter((c) => c.type === 'remove-line')
          .map((c) => c.lineId),
      );
      const survivors = cart.lines.filter((line) => !removedIds.has(line.id));
      expect(applied.lines.length, note).toBe(survivors.length);
      applied.lines.forEach((line, position) => {
        expect(line.id, note).toBe(survivors[position]?.id);
        expect(
          Object.is(line.quantity, survivors[position]?.quantity) ||
            line.quantity < (survivors[position]?.quantity ?? 0),
          note,
        ).toBe(true);
      });

      // Idempotent: nothing left to correct, and violations are not silently repaired.
      const second = evaluateOffers(applied, rules, context);
      expect(
        second.corrections,
        `${note}: ${JSON.stringify(cart)} ${JSON.stringify(result.corrections)}`,
      ).toEqual([]);
      expect(
        second.violations.map((v) => v.code),
        note,
      ).toEqual(result.violations.map((v) => v.code));
      expect(revalidationOutcome(second) === 'corrected', note).toBe(false);

      // Semantic invariants on the repaired cart, checked when every line was well formed.
      const wellFormed = result.violations.every(
        (v) => v.code === 'haul-away-not-eligible',
      );
      const haulRefused = result.violations.some(
        (v) => v.code === 'haul-away-not-eligible',
      );
      const sum = (lines: readonly CartLineLike[]) =>
        lines.reduce((total, line) => total + line.quantity, 0);

      const haulLines = applied.lines.filter(
        (line) => line.role === 'haul-away' || line.variantId === VARIANT.haul,
      );
      const haulMax = rules.haulAway?.maxPieces ?? 0;
      expect(
        !wellFormed || haulRefused || sum(haulLines) <= haulMax,
        `${note}: haul-away over its maximum`,
      ).toBe(true);

      for (const rule of rules.gifts) {
        const variants = new Set(Object.values(rule.giftVariantIdsBySize));
        const giftLines = applied.lines.filter((line) =>
          variants.has(line.variantId),
        );
        const hasQualifier = applied.lines.some(
          (line) =>
            line.role !== 'gift' &&
            (rule.qualifyingProductIds.includes(line.productId) ||
              (line.collectionIds ?? []).some((id) =>
                rule.qualifyingCollectionIds.includes(id),
              )),
        );
        expect(
          !wellFormed || sum(giftLines) <= rule.maxQuantity,
          `${note}: gift over its allowance`,
        ).toBe(true);
        expect(
          !wellFormed || giftLines.length === 0 || hasQualifier,
          `${note}: orphan gift left`,
        ).toBe(true);
      }

      const protectorNeed = new Map<string, number>();
      for (const line of applied.lines) {
        const variant = rules.comfortGuarantee?.qualifyingProductIds.includes(
          line.productId,
        )
          ? comfortProtectorVariantFor(rules.comfortGuarantee, line.size)
          : null;
        if (variant !== null)
          protectorNeed.set(
            variant,
            (protectorNeed.get(variant) ?? 0) + line.quantity,
          );
      }
      const protectorHave = new Map<string, number>();
      for (const line of applied.lines) {
        const isComfortVariant = Object.values(
          rules.comfortGuarantee?.protectorVariantIdBySize ?? {},
        ).includes(line.variantId);
        if (isComfortVariant && line.role === 'protector') {
          protectorHave.set(
            line.variantId,
            (protectorHave.get(line.variantId) ?? 0) + line.quantity,
          );
        }
      }
      for (const [variant, have] of protectorHave) {
        expect(
          !wellFormed || have <= (protectorNeed.get(variant) ?? 0),
          `${note}: protector without a mattress`,
        ).toBe(true);
      }

      const coveredBy = new Map<string, number>();
      for (const line of applied.lines.filter(
        (candidate) => candidate.role === 'coverage',
      )) {
        const parent = applied.lines.find(
          (candidate) => candidate.id === line.parentLineId,
        );
        expect(
          !wellFormed ||
            (parent !== undefined &&
              parent.role !== 'coverage' &&
              parent.id !== line.id),
          `${note}: coverage alone`,
        ).toBe(true);
        if (parent !== undefined)
          coveredBy.set(
            parent.id,
            (coveredBy.get(parent.id) ?? 0) + line.quantity,
          );
      }
      for (const [parentId, covered] of coveredBy) {
        const parent = applied.lines.find(
          (candidate) => candidate.id === parentId,
        );
        expect(
          !wellFormed || covered <= (parent?.quantity ?? 0),
          `${note}: coverage above the item quantity`,
        ).toBe(true);
      }

      const outcome = revalidationOutcome(result);
      corrected += outcome === 'corrected' ? 1 : 0;
      rejected += outcome === 'rejected' ? 1 : 0;
      clean += outcome === 'ok' ? 1 : 0;
    }

    // The generator must actually exercise every path, or the properties above prove nothing.
    expect(corrected).toBeGreaterThan(CASES / 20);
    expect(rejected).toBeGreaterThan(CASES / 20);
    expect(clean).toBeGreaterThan(CASES / 20);
  }, 60_000);
});
