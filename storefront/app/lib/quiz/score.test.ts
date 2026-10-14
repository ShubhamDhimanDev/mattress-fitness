import {describe, expect, it} from 'vitest';
import type {Size} from '~/lib/catalog/attributes';
import {SIZES} from '~/lib/catalog/attributes';
import {FIXTURE_PRODUCTS, getFixtureProduct} from '~/lib/catalog/fixtures';
import {mulberry32, shuffled} from '~/lib/catalog/test-helpers';
import type {CatalogProduct, SizeVariant} from '~/lib/catalog/types';
import {serializeFilterParams} from '~/lib/filters';
import {parseQuizConfig} from '~/lib/quiz/config';
import {DEFAULT_QUIZ_CONFIG} from '~/lib/quiz/default-config';
import {
  MATCH_FILTER_RELAXATION_ORDER,
  QUIZ_DEFAULT_SIZE,
  matchesToFilters,
  resolveAnswers,
  scoreProducts,
} from '~/lib/quiz/score';
import type {QuizAnswers, QuizOutcome} from '~/lib/quiz/types';

// --- A small hand-checkable world: bespoke config and eight products ---

const CONFIG = parseQuizConfig([
  {
    id: 'feel',
    order: 1,
    text: 'Feel?',
    options: [
      {
        id: 'soft',
        label: 'Soft',
        rules: [
          {attribute: 'comfort_level', value: 'Plush', weight: 3},
          {attribute: 'comfort_level', value: 'Ultra Plush', weight: 2},
        ],
      },
      {
        id: 'medium',
        label: 'Medium',
        rules: [{attribute: 'comfort_level', value: 'Medium', weight: 3}],
      },
    ],
  },
  {
    id: 'hot',
    order: 2,
    text: 'Hot?',
    options: [
      {
        id: 'yes',
        label: 'Yes',
        rules: [{attribute: 'benefits', value: 'Cooling', weight: 2}],
      },
      {id: 'no', label: 'No'},
    ],
  },
  {
    id: 'type',
    order: 3,
    text: 'Type?',
    options: [
      {
        id: 'hybrid',
        label: 'Hybrid',
        rules: [{attribute: 'mattress_type', value: 'Hybrid', weight: 4}],
      },
      {
        id: 'no-latex',
        label: 'Anything but latex',
        rules: [{attribute: 'mattress_type', value: 'Latex', exclude: true}],
      },
      {
        id: 'less-foam',
        label: 'Less foam',
        rules: [{attribute: 'mattress_type', value: 'Foam', weight: -3}],
      },
    ],
  },
  {
    id: 'size',
    order: 4,
    text: 'Size?',
    options: [
      {
        id: 'queen',
        label: 'Queen',
        rules: [{attribute: 'size', value: 'Queen'}],
      },
      {id: 'king', label: 'King', rules: [{attribute: 'size', value: 'King'}]},
    ],
  },
  {
    id: 'budget',
    order: 5,
    text: 'Budget?',
    options: [
      {
        id: 'cap',
        label: 'Up to $1,500',
        rules: [{attribute: 'budget', max: 1500}],
      },
      {id: 'any', label: 'Any'},
    ],
  },
  {
    id: 'position',
    order: 6,
    text: 'Position?',
    multi: true,
    options: [
      {
        id: 'side',
        label: 'Side',
        rules: [{attribute: 'sleep_positions', value: 'Side', weight: 2}],
      },
      {
        id: 'back',
        label: 'Back',
        rules: [{attribute: 'sleep_positions', value: 'Back', weight: 2}],
      },
    ],
  },
]).config;

type World = {
  handle: string;
  comfort: CatalogProduct['comfortLevel'];
  type: CatalogProduct['mattressType'];
  positions: CatalogProduct['sleepPositions'];
  benefits: CatalogProduct['benefits'];
  sizes: Partial<Record<Size, number | {price: number; available: boolean}>>;
};

function variantsFor(world: World): SizeVariant[] {
  return SIZES.flatMap((size) => {
    const entry = world.sizes[size];
    if (entry === undefined) return [];
    const spec =
      typeof entry === 'number' ? {price: entry, available: true} : entry;
    return [
      {
        id: `${world.handle}:${size}`,
        size,
        sku: null,
        dimensions: null,
        priceCents: spec.price,
        compareAtCents: null,
        available: spec.available,
      },
    ];
  });
}

function product(world: World): CatalogProduct {
  return {
    id: `id:${world.handle}`,
    handle: world.handle,
    title: world.handle,
    brand: 'Test Brand',
    productType: 'Mattress',
    productLine: null,
    comfortLevel: world.comfort,
    mattressType: world.type,
    sleepPositions: world.positions,
    benefits: world.benefits,
    heightInches: 10,
    compareGroup: null,
    rating: null,
    images: [],
    variants: variantsFor(world),
  };
}

const A = product({
  handle: 'a-plush-hybrid',
  comfort: 'Plush',
  type: 'Hybrid',
  positions: ['Side'],
  benefits: ['Cooling'],
  sizes: {Queen: 129900, King: 159900},
});
const B = product({
  handle: 'b-medium-hybrid',
  comfort: 'Medium',
  type: 'Hybrid',
  positions: ['Back'],
  benefits: ['Cooling', 'Back Support'],
  sizes: {Queen: 119900, King: {price: 149900, available: false}},
});
const C = product({
  handle: 'c-plush-foam',
  comfort: 'Plush',
  type: 'Foam',
  positions: ['Side', 'Back'],
  benefits: [],
  sizes: {Queen: 89900},
});
const D = product({
  handle: 'd-medium-latex',
  comfort: 'Medium',
  type: 'Latex',
  positions: ['Back'],
  benefits: ['Cooling'],
  sizes: {Queen: 99900},
});
const E = product({
  handle: 'e-ultra-hybrid',
  comfort: 'Ultra Plush',
  type: 'Hybrid',
  positions: ['Side'],
  benefits: ['Cooling'],
  sizes: {Queen: 179900, King: 209900},
});
const F = product({
  handle: 'f-sold-out',
  comfort: 'Plush',
  type: 'Hybrid',
  positions: ['Side'],
  benefits: ['Cooling'],
  sizes: {Queen: {price: 109900, available: false}},
});
const G = product({
  handle: 'g-twin-only',
  comfort: 'Plush',
  type: 'Hybrid',
  positions: ['Side'],
  benefits: ['Cooling'],
  sizes: {Twin: 59900},
});
const H = product({
  handle: 'h-firm-innerspring',
  comfort: 'Firm',
  type: 'Innerspring',
  positions: ['Back'],
  benefits: [],
  sizes: {Queen: 79900},
});
const WORLD = [A, B, C, D, E, F, G, H];

function handles(outcome: QuizOutcome): string[] {
  return outcome.status === 'ok' ? outcome.matches.map((m) => m.handle) : [];
}

describe('quiz scoring: golden cases (REQ-QZ-003, REQ-QZ-002)', () => {
  it('scores by hand: Plush + Cooling + Hybrid + Side, Queen, up to $1,500', () => {
    // Weights: Plush 3, Ultra Plush 2, Cooling 2, Hybrid 4, Side 2.
    // Eligible in Queen within $1,500: A, B, C, D, H (E is $1,799, F sold out, G has no Queen).
    //   A = Plush 3 + Hybrid 4 + Cooling 2 + Side 2 = 11
    //   B = Hybrid 4 + Cooling 2                    =  6
    //   C = Plush 3 + Side 2                        =  5
    //   D = Cooling 2                               =  2
    //   H =                                          0
    const outcome = scoreProducts(
      {
        feel: ['soft'],
        hot: ['yes'],
        type: ['hybrid'],
        size: ['queen'],
        budget: ['cap'],
        position: ['side'],
      },
      WORLD,
      CONFIG,
    );
    expect(outcome.status).toBe('ok');
    expect(outcome.status === 'ok' && outcome.matches).toEqual([
      {
        rank: 1,
        productId: 'id:a-plush-hybrid',
        handle: 'a-plush-hybrid',
        title: 'a-plush-hybrid',
        brand: 'Test Brand',
        score: 11,
        reasons: ['Plush', 'Hybrid', 'Cooling', 'Side sleepers'],
        reasonLine: 'Plush · Hybrid · Cooling · Side sleepers',
        size: 'Queen',
        variantId: 'a-plush-hybrid:Queen',
        priceCents: 129900,
        compareAtCents: null,
      },
      expect.objectContaining({
        rank: 2,
        handle: 'b-medium-hybrid',
        score: 6,
        reasonLine: 'Hybrid · Cooling',
        priceCents: 119900,
      }),
      expect.objectContaining({
        rank: 3,
        handle: 'c-plush-foam',
        score: 5,
        reasonLine: 'Plush · Side sleepers',
        priceCents: 89900,
      }),
    ]);
  });

  it('breaks equal scores by lower price in the chosen size (hand-checked)', () => {
    // Anything but latex removes D. Medium feel 3, Cooling 2:
    //   A = Cooling 2 = 2 ($1,299)   B = Medium 3 + Cooling 2 = 5   C = 0
    //   E = Cooling 2 = 2 ($1,799)   H = 0
    // Order: B (5), then A and E tie on 2 and A is cheaper, then E.
    const outcome = scoreProducts(
      {feel: ['medium'], hot: ['yes'], type: ['no-latex'], size: ['queen']},
      WORLD,
      CONFIG,
    );
    expect(handles(outcome)).toEqual([
      'b-medium-hybrid',
      'a-plush-hybrid',
      'e-ultra-hybrid',
    ]);
  });

  it('breaks equal score and price by handle, whatever the input order', () => {
    const twin = product({
      handle: 'z-twin',
      comfort: 'Plush',
      type: 'Hybrid',
      positions: [],
      benefits: [],
      sizes: {Queen: 100000},
    });
    const other = product({
      handle: 'b-other',
      comfort: 'Plush',
      type: 'Hybrid',
      positions: [],
      benefits: [],
      sizes: {Queen: 100000},
    });
    for (const order of [
      [twin, other],
      [other, twin],
    ]) {
      expect(handles(scoreProducts({}, order, CONFIG))).toEqual([
        'b-other',
        'z-twin',
      ]);
    }
  });

  it('with no answers uses Queen, scores everything 0 and orders by price then handle', () => {
    const outcome = scoreProducts({}, WORLD, CONFIG);
    // Queen candidates by price: H 79900, C 89900, D 99900, B 119900, A 129900, E 179900.
    expect(handles(outcome)).toEqual([
      'h-firm-innerspring',
      'c-plush-foam',
      'd-medium-latex',
    ]);
    expect(
      outcome.status === 'ok' && outcome.matches.map((m) => m.score),
    ).toEqual([0, 0, 0]);
    expect(outcome.status === 'ok' && outcome.matches[0]?.reasons).toEqual([
      'Available in your size and budget',
    ]);
    expect(outcome.size).toBe(QUIZ_DEFAULT_SIZE);
  });

  it('uses the price and variant of the chosen size and omits products sold out in it', () => {
    // King: A $1,599, B sold out, E $2,099. C, D, H, F, G have no King.
    const outcome = scoreProducts({size: ['king']}, WORLD, CONFIG);
    expect(outcome.status).toBe('ok');
    expect(outcome.status === 'ok' && outcome.matches).toEqual([
      expect.objectContaining({
        handle: 'a-plush-hybrid',
        size: 'King',
        priceCents: 159900,
        variantId: 'a-plush-hybrid:King',
      }),
      expect.objectContaining({
        handle: 'e-ultra-hybrid',
        size: 'King',
        priceCents: 209900,
        variantId: 'e-ultra-hybrid:King',
      }),
    ]);
  });

  it('returns fewer than three only when fewer qualify', () => {
    expect(
      handles(scoreProducts({size: ['king']}, WORLD, CONFIG)),
    ).toHaveLength(2);
    expect(handles(scoreProducts({}, WORLD, CONFIG))).toHaveLength(3);
  });

  it('removes products that match an exclusion rule', () => {
    // "Anything but latex" removes D; H (innerspring) stays.
    const outcome = scoreProducts(
      {type: ['no-latex'], size: ['queen']},
      [D, H],
      CONFIG,
    );
    expect(handles(outcome)).toEqual(['h-firm-innerspring']);
  });

  it('applies a negative weight as a penalty', () => {
    // Soft (Plush 3) with "less foam" (Foam -3): C = 3 - 3 = 0, A = 3.
    const outcome = scoreProducts(
      {feel: ['soft'], type: ['less-foam']},
      [A, C],
      CONFIG,
    );
    expect(
      outcome.status === 'ok' &&
        outcome.matches.map((m) => [m.handle, m.score]),
    ).toEqual([
      ['a-plush-hybrid', 3],
      ['c-plush-foam', 0],
    ]);
  });

  it('adds up the weights of a multi-select answer', () => {
    // Side 2 and Back 2: C has both = 4. A, B, D, H have one = 2.
    // Ties at 2 by price: H 79900, D 99900.
    const outcome = scoreProducts({position: ['side', 'back']}, WORLD, CONFIG);
    expect(handles(outcome)).toEqual([
      'c-plush-foam',
      'h-firm-innerspring',
      'd-medium-latex',
    ]);
    expect(outcome.status === 'ok' && outcome.matches[0]?.reasons).toEqual([
      'Back sleepers',
      'Side sleepers',
    ]);
  });

  it('honours only the first answer of a single-select question', () => {
    const resolved = resolveAnswers({feel: ['soft', 'medium']}, CONFIG);
    expect(resolved.weights).toEqual([
      {attribute: 'comfortLevel', value: 'Plush', weight: 3},
      {attribute: 'comfortLevel', value: 'Ultra Plush', weight: 2},
    ]);
  });

  it('ignores unknown questions, unknown options and prototype-style keys', () => {
    // fromEntries creates real own properties, including "__proto__".
    const hostile: QuizAnswers = Object.fromEntries([
      ['nope', ['x']],
      ['feel', ['bogus']],
      ['constructor', ['y']],
      ['__proto__', ['z']],
    ]);
    expect(scoreProducts(hostile, WORLD, CONFIG)).toEqual(
      scoreProducts({}, WORLD, CONFIG),
    );
  });

  it('combines several budget caps into the tightest', () => {
    const config = parseQuizConfig([
      {
        id: 'a',
        text: 'A',
        options: [
          {id: 'x', label: 'X', rules: [{attribute: 'budget', max: 1500}]},
          {id: 'y', label: 'Y'},
        ],
      },
      {
        id: 'b',
        text: 'B',
        options: [
          {
            id: 'x',
            label: 'X',
            rules: [{attribute: 'budget', min: 900, max: 1200}],
          },
          {id: 'y', label: 'Y'},
        ],
      },
    ]).config;
    const resolved = resolveAnswers({a: ['x'], b: ['x']}, config);
    expect(resolved.minCents).toBe(90000);
    expect(resolved.maxCents).toBe(120000);
    // Queen prices: H 799, C 899, D 999 (in), B 1,199 (in), A 1,299 (out).
    expect(handles(scoreProducts({a: ['x'], b: ['x']}, WORLD, config))).toEqual(
      ['d-medium-latex', 'b-medium-hybrid'],
    );
  });

  describe('empty results say why', () => {
    it.each<[string, readonly CatalogProduct[], QuizAnswers, string]>([
      ['no products at all', [], {}, 'catalog_empty'],
      [
        'nothing offered in the size',
        [G],
        {size: ['queen']},
        'nothing_in_size',
      ],
      [
        'nothing available in the size',
        [F],
        {size: ['queen']},
        'nothing_in_size',
      ],
      [
        'nothing within the budget',
        [E],
        {size: ['queen'], budget: ['cap']},
        'nothing_in_budget',
      ],
      ['everything excluded', [D], {type: ['no-latex']}, 'excluded_by_answers'],
    ])('%s', (_name, products, answers, reason) => {
      expect(scoreProducts(answers, products, CONFIG)).toEqual({
        status: 'empty',
        size: expect.any(String),
        reason,
      });
    });
  });
});

describe('quiz scoring with the default quiz and the fixture catalog (REQ-QZ-001, REQ-QZ-003)', () => {
  const answers = (picks: Record<string, string>): QuizAnswers =>
    Object.fromEntries(Object.entries(picks).map(([q, o]) => [q, [o]]));

  it('hot side sleeper who likes soft: the three 15-point mattresses, cheapest first', () => {
    // Weights: Side 3; comfort Ultra Plush 4, Plush 4 (1 + 3), Medium 2;
    // Cooling 4; Pressure Relief 4. Queen, up to $2,500.
    // Cedar Plush Hybrid (sale $1,599)  = Plush 4 + Cooling 4 + Pressure Relief 4 + Side 3 = 15
    // Cove Ultra Plush Memory Foam $1,899 = 4 + 4 + 4 + 3                                   = 15
    // Cedar Ultra Plush Hybrid $2,499   = 4 + 4 + 4 + 3                                    = 15
    // The next best is Wrenfield Solace Plush at 11.
    const outcome = scoreProducts(
      answers({
        'sleep-position': 'side',
        feel: 'soft',
        'sleep-hot': 'yes',
        sharing: 'alone',
        discomfort: 'hips-shoulders',
        'mattress-type': 'no-preference',
        size: 'queen',
        budget: 'up-to-2500',
      }),
      FIXTURE_PRODUCTS,
      DEFAULT_QUIZ_CONFIG,
    );
    expect(outcome.status).toBe('ok');
    expect(outcome.status === 'ok' && outcome.matches).toEqual([
      expect.objectContaining({
        rank: 1,
        handle: 'larkmoor-cedar-plush-hybrid',
        score: 15,
        priceCents: 159900,
        compareAtCents: 199900,
        reasons: ['Plush', 'Cooling', 'Pressure Relief', 'Side sleepers'],
      }),
      expect.objectContaining({
        rank: 2,
        handle: 'tidewell-cove-ultra-plush-memory-foam',
        score: 15,
        priceCents: 189900,
        reasons: ['Ultra Plush', 'Cooling', 'Pressure Relief', 'Side sleepers'],
      }),
      expect.objectContaining({
        rank: 3,
        handle: 'larkmoor-cedar-ultra-plush-hybrid',
        score: 15,
        priceCents: 249900,
      }),
    ]);
  });

  it('firm back sleeper with lower back pain wanting innerspring under $1,000', () => {
    // Weights: Back 3; Firm 5 (4 + 1), Extra Firm 3, Medium 2 (1 + 1);
    // Back Support 4; Innerspring 5. Queen, up to $1,000.
    // Fieldstone Firm Innerspring $749 = 5 + 5 + 4 + 3 = 17
    // Harbor Extra Firm Foam $499      = 3 + 4 + 3     = 10
    // Fieldstone Medium Innerspring $649 = 2 + 5 + 3   = 10   (dearer than Harbor, so third)
    const outcome = scoreProducts(
      answers({
        'sleep-position': 'back',
        feel: 'firm',
        discomfort: 'lower-back',
        'mattress-type': 'innerspring',
        size: 'queen',
        budget: 'up-to-1000',
      }),
      FIXTURE_PRODUCTS,
      DEFAULT_QUIZ_CONFIG,
    );
    expect(
      outcome.status === 'ok' &&
        outcome.matches.map((m) => [m.handle, m.score]),
    ).toEqual([
      ['ashvale-fieldstone-firm-innerspring', 17],
      ['tidewell-harbor-extra-firm-foam', 10],
      ['ashvale-fieldstone-medium-innerspring', 10],
    ]);
    expect(outcome.status === 'ok' && outcome.matches[0]?.reasonLine).toBe(
      'Firm · Innerspring · Back Support · Back sleepers',
    );
  });

  it('never offers a size that is sold out: the King-sold-out Solace Firm is skipped', () => {
    // Firm feel in King. Firm 4, Extra Firm 3, Medium 1. Solace Firm would score 4 but its
    // King is sold out. King prices: Fieldstone Firm $929, Cedar Firm $1,979, Heartwood Firm $2,599.
    const outcome = scoreProducts(
      answers({feel: 'firm', size: 'king'}),
      FIXTURE_PRODUCTS,
      DEFAULT_QUIZ_CONFIG,
    );
    expect(handles(outcome)).toEqual([
      'ashvale-fieldstone-firm-innerspring',
      'larkmoor-cedar-firm-hybrid',
      'ashvale-heartwood-firm-latex',
    ]);
    expect(handles(outcome)).not.toContain('wrenfield-solace-firm-memory-foam');
  });

  it('never offers the fully sold-out product, in any size', () => {
    for (const size of SIZES) {
      const outcome = scoreProducts(
        answers({size: size.toLowerCase().replace(/ /g, '-'), feel: 'firm'}),
        FIXTURE_PRODUCTS,
        DEFAULT_QUIZ_CONFIG,
      );
      expect(handles(outcome)).not.toContain(
        'wrenfield-kestrel-extra-firm-hybrid',
      );
    }
  });

  it('a new product with the attributes is included with no code change', () => {
    const base = getFixtureProduct('tidewell-harbor-medium-foam');
    const newcomer: CatalogProduct = {
      ...base,
      id: 'new',
      handle: 'zz-new-arrival',
      comfortLevel: 'Firm',
      mattressType: 'Latex',
      benefits: ['Back Support', 'Eco-Friendly'],
      sleepPositions: ['Stomach'],
    };
    const picks = answers({
      'sleep-position': 'stomach',
      feel: 'firm',
      discomfort: 'lower-back',
      'mattress-type': 'latex',
      size: 'queen',
    });
    const without = scoreProducts(picks, FIXTURE_PRODUCTS, DEFAULT_QUIZ_CONFIG);
    const withNew = scoreProducts(
      picks,
      [...FIXTURE_PRODUCTS, newcomer],
      DEFAULT_QUIZ_CONFIG,
    );
    expect(handles(without)).not.toContain('zz-new-arrival');
    expect(handles(withNew)[0]).toBe('zz-new-arrival');
  });

  it('property: shuffling the product order never changes the ranking (200 runs)', () => {
    const random = mulberry32(2026);
    for (let run = 0; run < 200; run += 1) {
      const picks: Record<string, string[]> = {};
      for (const question of DEFAULT_QUIZ_CONFIG.questions) {
        if (random() < 0.15) continue; // sometimes left unanswered
        const option =
          question.options[Math.floor(random() * question.options.length)];
        if (option) picks[question.id] = [option.id];
      }
      const expected = scoreProducts(
        picks,
        FIXTURE_PRODUCTS,
        DEFAULT_QUIZ_CONFIG,
      );
      for (let k = 0; k < 4; k += 1) {
        const outcome = scoreProducts(
          picks,
          shuffled(FIXTURE_PRODUCTS, random),
          DEFAULT_QUIZ_CONFIG,
        );
        expect(outcome).toEqual(expected);
      }
    }
  });

  it('property: every outcome respects size, stock, budget, order and count (200 runs)', () => {
    const random = mulberry32(99);
    for (let run = 0; run < 200; run += 1) {
      const picks: Record<string, string[]> = {};
      for (const question of DEFAULT_QUIZ_CONFIG.questions) {
        const option =
          question.options[Math.floor(random() * question.options.length)];
        if (option) picks[question.id] = [option.id];
      }
      const resolved = resolveAnswers(picks, DEFAULT_QUIZ_CONFIG);
      const outcome = scoreProducts(
        picks,
        FIXTURE_PRODUCTS,
        DEFAULT_QUIZ_CONFIG,
      );
      expect(outcome.size).toBe(resolved.size);
      const matches = outcome.status === 'ok' ? outcome.matches : [];
      expect(matches.length).toBeLessThanOrEqual(3);
      matches.forEach((match, index) => {
        const source = getFixtureProduct(match.handle);
        const variant = source.variants.find((v) => v.id === match.variantId);
        expect(match.rank).toBe(index + 1);
        expect(variant?.size).toBe(resolved.size);
        expect(variant?.available).toBe(true);
        expect(variant?.priceCents).toBe(match.priceCents);
        expect(match.reasonLine).toBe(match.reasons.join(' · '));
        expect(match.reasons.length).toBeGreaterThan(0);
        expect(match.reasons.length).toBeLessThanOrEqual(4);
        expect(
          resolved.maxCents === null || match.priceCents <= resolved.maxCents,
        ).toBe(true);
      });
      const scores = matches.map((m) => m.score);
      expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    }
  });
});

describe('matchesToFilters: "See all matches" (REQ-QZ-002)', () => {
  const answers = (picks: Record<string, string>): QuizAnswers =>
    Object.fromEntries(Object.entries(picks).map(([q, o]) => [q, [o]]));

  const FULL = answers({
    'sleep-position': 'side',
    feel: 'soft',
    'sleep-hot': 'yes',
    sharing: 'restless',
    discomfort: 'hips-shoulders',
    'mattress-type': 'hybrid',
    size: 'queen',
    budget: 'up-to-1500',
  });

  it('turns the answers into the favoured values, the size and the budget cap', () => {
    // Comfort: Ultra Plush 4, Plush 1 + 3 = 4, Medium 1 + 1 = 2 -> the two at 4.
    // Benefits: Cooling 4, Motion Separation 4, Pressure Relief 4 -> all three.
    const state = matchesToFilters(FULL, DEFAULT_QUIZ_CONFIG);
    expect(state.selected).toEqual({
      size: ['Queen'],
      brand: [],
      productType: [],
      comfortLevel: ['Ultra Plush', 'Plush'],
      mattressType: ['Hybrid'],
      benefit: ['Cooling', 'Pressure Relief', 'Motion Separation'],
      sleepPosition: ['Side'],
      productLine: [],
    });
    expect(state.priceMaxCents).toBe(150000);
    expect(state.priceMinCents).toBeNull();
  });

  it('produces a URL the collection page understands', () => {
    expect(
      serializeFilterParams(
        matchesToFilters(FULL, DEFAULT_QUIZ_CONFIG),
      ).toString(),
    ).toBe(
      'size=queen&comfort=ultra-plush&comfort=plush&mattress_type=hybrid' +
        '&benefit=cooling&benefit=pressure-relief&benefit=motion-separation' +
        '&position=side&price_max=1500',
    );
  });

  it('adds nothing for answers that carry no preference', () => {
    const state = matchesToFilters(
      answers({
        feel: 'unsure',
        'sleep-hot': 'no',
        sharing: 'alone',
        discomfort: 'none',
        'mattress-type': 'no-preference',
        budget: 'any',
      }),
      DEFAULT_QUIZ_CONFIG,
    );
    expect(serializeFilterParams(state).toString()).toBe('');
  });

  it('does not force a size the shopper never chose', () => {
    expect(matchesToFilters({}, DEFAULT_QUIZ_CONFIG).selected.size).toEqual([]);
  });

  it('keeps only the favoured benefit when one clearly leads', () => {
    const state = matchesToFilters(
      answers({'mattress-type': 'latex', discomfort: 'lower-back'}),
      DEFAULT_QUIZ_CONFIG,
    );
    // Back Support 4 beats Eco-Friendly 1.
    expect(state.selected.benefit).toEqual(['Back Support']);
    expect(state.selected.mattressType).toEqual(['Latex']);
  });

  it('can be relaxed one attribute at a time when the strict set finds nothing', () => {
    expect(MATCH_FILTER_RELAXATION_ORDER).toEqual([
      'benefit',
      'sleepPosition',
      'mattressType',
      'comfortLevel',
    ]);
    const relaxed = matchesToFilters(FULL, DEFAULT_QUIZ_CONFIG, {
      dimensions: ['comfortLevel'],
    });
    expect(relaxed.selected.comfortLevel).toEqual(['Ultra Plush', 'Plush']);
    expect(relaxed.selected.benefit).toEqual([]);
    expect(relaxed.selected.mattressType).toEqual([]);
    expect(relaxed.selected.size).toEqual(['Queen']);
    expect(relaxed.priceMaxCents).toBe(150000);
  });

  it('every product in the top results satisfies the strict budget and size filters', () => {
    const state = matchesToFilters(FULL, DEFAULT_QUIZ_CONFIG);
    const outcome = scoreProducts(FULL, FIXTURE_PRODUCTS, DEFAULT_QUIZ_CONFIG);
    for (const match of outcome.status === 'ok' ? outcome.matches : []) {
      expect(state.selected.size).toContain(match.size);
      expect(match.priceCents).toBeLessThanOrEqual(
        state.priceMaxCents ?? Infinity,
      );
    }
  });
});
