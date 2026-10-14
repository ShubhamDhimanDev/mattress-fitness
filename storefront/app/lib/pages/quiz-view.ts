// View-model helpers for the quiz results screen. Pure: the route computes the
// outcome with scoreProducts and these turn it into plain strings and links.

import {isOnSale} from '~/lib/catalog/pricing';
import type {SizeVariant} from '~/lib/catalog/types';
import {serializeFilterParams} from '~/lib/filters';
import {formatCents} from '~/lib/money';
import type {SavedQuiz} from '~/lib/quiz/storage';
import {checkStaleness, savedQuizFromOutcome} from '~/lib/quiz/storage';
import {fingerprintConfig} from '~/lib/quiz/config';
import {matchesToFilters} from '~/lib/quiz/score';
import type {
  QuizAnswers,
  QuizConfig,
  QuizEmptyReason,
  QuizMatch,
  QuizOutcome,
} from '~/lib/quiz/types';

/** The mattress collection, as linked from the main navigation. */
export const MATTRESS_COLLECTION_PATH = '/collections/mattresses';

/**
 * "See all matches" (REQ-QZ-002): the collection with the filters the answers
 * favour. Built from validated state through the shared codec, never by hand.
 */
export function seeAllMatchesPath(
  answers: QuizAnswers,
  config: QuizConfig,
): string {
  const params = serializeFilterParams(matchesToFilters(answers, config));
  const query = params.toString();
  return query === ''
    ? MATTRESS_COLLECTION_PATH
    : `${MATTRESS_COLLECTION_PATH}?${query}`;
}

export type MatchPriceView = {
  readonly text: string;
  readonly compareAtText: string | null;
  /** For example "Queen price". */
  readonly label: string;
};

export function matchPriceView(
  match: Pick<QuizMatch, 'priceCents' | 'compareAtCents' | 'size'>,
): MatchPriceView {
  const variant: Pick<SizeVariant, 'priceCents' | 'compareAtCents'> = match;
  const sale =
    variant.compareAtCents !== null &&
    isOnSale({
      id: '',
      size: match.size,
      sku: null,
      dimensions: null,
      available: true,
      ...variant,
    });
  return {
    text: formatCents(match.priceCents, {compact: true}),
    compareAtText:
      sale && match.compareAtCents !== null
        ? formatCents(match.compareAtCents, {compact: true})
        : null,
    label: `${match.size} price`,
  };
}

const EMPTY_MESSAGES: Readonly<Record<QuizEmptyReason, string>> = {
  catalog_empty:
    'We could not load mattresses right now. Please try again soon.',
  nothing_in_size:
    'No mattress is available in that size right now. Try retaking the quiz with another size.',
  nothing_in_budget:
    'No mattress fits that budget in your size. Try retaking the quiz with a higher budget.',
  excluded_by_answers:
    'Your answers ruled out every mattress we have in your size. Try retaking the quiz with fewer constraints.',
};

export function emptyOutcomeMessage(reason: QuizEmptyReason): string {
  return EMPTY_MESSAGES[reason];
}

/** What is written to the device after results (answers and result summaries, no prices). */
export function buildSavedQuiz(input: {
  readonly answers: QuizAnswers;
  readonly outcome: QuizOutcome;
  readonly config: QuizConfig;
  readonly nowMs: number;
}): SavedQuiz | null {
  return savedQuizFromOutcome({
    answers: input.answers,
    outcome: input.outcome,
    nowMs: input.nowMs,
    configFingerprint: fingerprintConfig(input.config),
  });
}

/**
 * Whether a saved quiz can be offered as "continue where you left off". Expired
 * results are dropped; results from an older configuration are still offered
 * because the screen recomputes them from the saved answers.
 */
export function isResumable(
  saved: SavedQuiz,
  config: QuizConfig,
  nowMs: number,
): boolean {
  return (
    checkStaleness(saved, nowMs, fingerprintConfig(config)) !== 'expired' &&
    Object.keys(saved.answers).length > 0
  );
}

/** Labels of the chosen options, in question order, for the "your answers" summary. */
export function answerSummary(
  answers: QuizAnswers,
  config: QuizConfig,
): readonly {
  readonly questionId: string;
  readonly question: string;
  readonly answer: string;
}[] {
  return config.questions.flatMap((question) => {
    const chosen = question.options
      .filter((option) => answers[question.id]?.includes(option.id))
      .map((option) => option.label);
    return chosen.length === 0
      ? []
      : [
          {
            questionId: question.id,
            question: question.text,
            answer: chosen.join(', '),
          },
        ];
  });
}
