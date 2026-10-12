// Quiz scoring (REQ-QZ-003, REQ-QZ-002).
//
// A pure function: (answers, products, config) -> the best matches. Nothing is
// hard-coded per product, so a new product with the stored attributes is
// eligible with no code change. The rules come from the admin-managed config.
//
// How a result is decided, in plain language (for the client's approval, CLR-012):
//   1. The size answer picks the size (Queen if none was given).
//   2. A product is considered only if it is for sale in that size, within the
//      budget answer for that size, and not removed by an "exclude" rule.
//   3. Each score rule whose attribute value the product has adds its weight.
//   4. Highest score wins; ties go to the lower price in that size, then to the
//      handle in alphabetical order, so the order is always the same.
//
// Prices here come from the catalog data passed in (Shopify), in integer cents.

import type {Size} from '~/lib/catalog/attributes';
import {BENEFITS, SLEEP_POSITIONS, indexIn} from '~/lib/catalog/attributes';
import {variantForSize} from '~/lib/catalog/pricing';
import type {CatalogProduct, SizeVariant} from '~/lib/catalog/types';
import type {FilterDimension, FilterState} from '~/lib/filters';
import {normalizeFilterState} from '~/lib/filters';
import type {
  QuizAnswers,
  QuizConfig,
  QuizEmptyReason,
  QuizMatch,
  QuizOutcome,
  QuizQuestion,
  QuizScoredAttribute,
} from '~/lib/quiz/types';

export const QUIZ_RESULT_COUNT = 3;
/** Used when the shopper skipped the size question. */
export const QUIZ_DEFAULT_SIZE: Size = 'Queen';
export const REASON_SEPARATOR = ' · ';
const MAX_REASONS = 4;
const FALLBACK_REASON = 'Available in your size and budget';

type AttributeValue = {
  readonly attribute: QuizScoredAttribute;
  readonly value: string;
};
type AttributeWeight = AttributeValue & {readonly weight: number};

export type ResolvedAnswers = {
  readonly size: Size;
  /** False when the size came from the default rather than an answer. */
  readonly sizeAnswered: boolean;
  readonly minCents: number | null;
  readonly maxCents: number | null;
  /** Weights summed per attribute value across all answers. */
  readonly weights: readonly AttributeWeight[];
  readonly exclusions: readonly AttributeValue[];
};

function chosenOptionIds(
  question: QuizQuestion,
  answers: QuizAnswers,
): readonly string[] {
  // Own-property check: an answer key such as "constructor" must not read the prototype.
  if (!Object.hasOwn(answers, question.id)) return [];
  const given = answers[question.id];
  if (!Array.isArray(given)) return [];
  const valid = new Set<string>();
  for (const id of given) {
    if (typeof id === 'string' && question.options.some((o) => o.id === id)) {
      valid.add(id);
    }
  }
  // A single-select question honours one answer; extras are ignored, not trusted.
  return question.multi ? [...valid] : [...valid].slice(0, 1);
}

/**
 * Turns the shopper's answers into one summary of what to score and filter on.
 * Unknown questions and options are ignored (the config may have changed since
 * the answers were saved).
 */
export function resolveAnswers(
  answers: QuizAnswers,
  config: QuizConfig,
): ResolvedAnswers {
  let size: Size | null = null;
  let minCents: number | null = null;
  let maxCents: number | null = null;
  const weights = new Map<string, AttributeWeight>();
  const exclusions = new Map<string, AttributeValue>();

  for (const question of config.questions) {
    for (const optionId of chosenOptionIds(question, answers)) {
      const option = question.options.find((o) => o.id === optionId);
      for (const rule of option?.rules ?? []) {
        switch (rule.kind) {
          case 'size':
            // The first size answer (in question order) wins.
            size ??= rule.size;
            break;
          case 'budget':
            // Several budget answers combine into the tightest range.
            if (rule.minCents !== null) {
              minCents = Math.max(minCents ?? 0, rule.minCents);
            }
            if (rule.maxCents !== null) {
              maxCents = Math.min(maxCents ?? rule.maxCents, rule.maxCents);
            }
            break;
          case 'score': {
            const key = `${rule.attribute}:${rule.value}`;
            const current = weights.get(key)?.weight ?? 0;
            weights.set(key, {
              attribute: rule.attribute,
              value: rule.value,
              weight: current + rule.weight,
            });
            break;
          }
          case 'exclude':
            exclusions.set(`${rule.attribute}:${rule.value}`, {
              attribute: rule.attribute,
              value: rule.value,
            });
            break;
          default: {
            const unreachable: never = rule;
            return unreachable;
          }
        }
      }
    }
  }

  return {
    size: size ?? QUIZ_DEFAULT_SIZE,
    sizeAnswered: size !== null,
    minCents,
    maxCents,
    weights: [...weights.values()],
    exclusions: [...exclusions.values()],
  };
}

function hasAttribute(
  product: CatalogProduct,
  attribute: QuizScoredAttribute,
  value: string,
): boolean {
  switch (attribute) {
    case 'comfortLevel':
      return product.comfortLevel === value;
    case 'mattressType':
      return product.mattressType === value;
    case 'sleepPosition':
      return product.sleepPositions.some((position) => position === value);
    case 'benefit':
      return product.benefits.some((benefit) => benefit === value);
    default: {
      const unreachable: never = attribute;
      return unreachable;
    }
  }
}

function scoreOf(
  product: CatalogProduct,
  weights: readonly AttributeWeight[],
): number {
  return weights.reduce(
    (total, entry) =>
      hasAttribute(product, entry.attribute, entry.value)
        ? total + entry.weight
        : total,
    0,
  );
}

/** Reasons in a fixed order: feel, type, benefits, then sleep positions. */
function reasonsFor(
  product: CatalogProduct,
  weights: readonly AttributeWeight[],
): string[] {
  const matched = weights.filter(
    (entry) =>
      entry.weight > 0 && hasAttribute(product, entry.attribute, entry.value),
  );
  const valuesOf = (attribute: QuizScoredAttribute) =>
    matched.filter((e) => e.attribute === attribute).map((e) => e.value);

  const reasons = [
    ...valuesOf('comfortLevel'),
    ...valuesOf('mattressType'),
    ...valuesOf('benefit').sort(
      (a, b) => indexIn(BENEFITS, a) - indexIn(BENEFITS, b),
    ),
    ...valuesOf('sleepPosition')
      .sort((a, b) => indexIn(SLEEP_POSITIONS, a) - indexIn(SLEEP_POSITIONS, b))
      .map((position) => `${position} sleepers`),
  ].slice(0, MAX_REASONS);
  return reasons.length > 0 ? reasons : [FALLBACK_REASON];
}

type Candidate = {
  readonly product: CatalogProduct;
  readonly variant: SizeVariant;
  readonly score: number;
};

function compareCandidates(a: Candidate, b: Candidate): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.variant.priceCents !== b.variant.priceCents) {
    return a.variant.priceCents - b.variant.priceCents;
  }
  // Plain code-unit order: independent of locale and runtime.
  if (a.product.handle === b.product.handle) return 0;
  return a.product.handle < b.product.handle ? -1 : 1;
}

function toMatch(
  candidate: Candidate,
  rank: number,
  weights: readonly AttributeWeight[],
): QuizMatch {
  const reasons = reasonsFor(candidate.product, weights);
  return {
    rank,
    productId: candidate.product.id,
    handle: candidate.product.handle,
    title: candidate.product.title,
    brand: candidate.product.brand,
    score: candidate.score,
    reasons,
    reasonLine: reasons.join(REASON_SEPARATOR),
    size: candidate.variant.size,
    variantId: candidate.variant.id,
    priceCents: candidate.variant.priceCents,
    compareAtCents: candidate.variant.compareAtCents,
  };
}

function emptyReason(
  total: number,
  inSize: number,
  inBudget: number,
): QuizEmptyReason {
  if (total === 0) return 'catalog_empty';
  if (inSize === 0) return 'nothing_in_size';
  if (inBudget === 0) return 'nothing_in_budget';
  return 'excluded_by_answers';
}

/**
 * Returns up to three best matches for the answers, or an explained empty
 * result. The same inputs always give the same output, whatever the order of
 * `products`.
 */
export function scoreProducts(
  answers: QuizAnswers,
  products: readonly CatalogProduct[],
  config: QuizConfig,
): QuizOutcome {
  const resolved = resolveAnswers(answers, config);

  const inSize = products.flatMap((product) => {
    const variant = variantForSize(product, resolved.size);
    return variant?.available ? [{product, variant}] : [];
  });
  const inBudget = inSize.filter(
    ({variant}) =>
      (resolved.maxCents === null || variant.priceCents <= resolved.maxCents) &&
      (resolved.minCents === null || variant.priceCents >= resolved.minCents),
  );
  const candidates: Candidate[] = inBudget
    .filter(
      ({product}) =>
        !resolved.exclusions.some((rule) =>
          hasAttribute(product, rule.attribute, rule.value),
        ),
    )
    .map(({product, variant}) => ({
      product,
      variant,
      score: scoreOf(product, resolved.weights),
    }));

  if (candidates.length === 0) {
    return {
      status: 'empty',
      size: resolved.size,
      reason: emptyReason(products.length, inSize.length, inBudget.length),
    };
  }
  const top = [...candidates]
    .sort(compareCandidates)
    .slice(0, QUIZ_RESULT_COUNT);
  return {
    status: 'ok',
    size: resolved.size,
    matches: top.map((candidate, index) =>
      toMatch(candidate, index + 1, resolved.weights),
    ),
  };
}

/** Attribute dimensions in the order they are dropped when "See all matches" is too narrow. */
export const MATCH_FILTER_RELAXATION_ORDER: readonly FilterDimension[] = [
  'benefit',
  'sleepPosition',
  'mattressType',
  'comfortLevel',
];

const ATTRIBUTE_DIMENSION: Readonly<
  Record<QuizScoredAttribute, FilterDimension>
> = {
  comfortLevel: 'comfortLevel',
  mattressType: 'mattressType',
  sleepPosition: 'sleepPosition',
  benefit: 'benefit',
};

/**
 * The collection filters for "See all matches" (REQ-QZ-002): the chosen size,
 * the budget range, and for each attribute the values the answers favour most
 * (the highest total weight; several values when they tie). Exclusion rules
 * cannot be expressed as filters and are not applied here.
 *
 * Filters from different dimensions combine with AND, so the full set can be
 * narrow. `options.dimensions` lets the route retry with fewer attribute
 * dimensions (see MATCH_FILTER_RELAXATION_ORDER) when nothing is found.
 */
export function matchesToFilters(
  answers: QuizAnswers,
  config: QuizConfig,
  options: {readonly dimensions?: readonly QuizScoredAttribute[]} = {},
): FilterState {
  const resolved = resolveAnswers(answers, config);
  const attributes: readonly QuizScoredAttribute[] = options.dimensions ?? [
    'comfortLevel',
    'mattressType',
    'sleepPosition',
    'benefit',
  ];

  const selected: Partial<Record<FilterDimension, string[]>> = {};
  for (const attribute of attributes) {
    const positive = resolved.weights.filter(
      (entry) => entry.attribute === attribute && entry.weight > 0,
    );
    const top = Math.max(0, ...positive.map((entry) => entry.weight));
    if (top === 0) continue;
    selected[ATTRIBUTE_DIMENSION[attribute]] = positive
      .filter((entry) => entry.weight === top)
      .map((entry) => entry.value);
  }
  if (resolved.sizeAnswered) {
    selected.size = [resolved.size];
  }

  return normalizeFilterState({
    selected,
    priceMinCents: resolved.minCents,
    priceMaxCents: resolved.maxCents,
  });
}
