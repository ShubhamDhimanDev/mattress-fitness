// Analytics events for the quiz (REQ-QZ-006): quiz_start, quiz_complete and
// quiz_result_click. Pure builders: they return the event name and parameters;
// the Phase 2 `track()` interface sends them, and only after analytics consent
// (provider wiring and consent are Phase 7). Firing exactly once per action is
// the caller's job; these builders have no state.
//
// Privacy (threat T-05): parameters are counts, a size, a product handle and a
// fixed vocabulary. Never answers' free text (there is none), never names,
// emails, ZIP codes or customer IDs. Values are capped to GA4 limits (names 40
// characters, string values 100).
//
// Documented parameter set (also asserted by tests):
//   quiz_start:        quiz_id, question_count, entry_point
//   quiz_complete:     quiz_id, question_count, answered_count, result_count,
//                      chosen_size, top_result_handle, outcome, duration_seconds
//   quiz_result_click: quiz_id, product_handle, result_position, chosen_size,
//                      click_target

import type {Size} from '~/lib/catalog/attributes';
import {isSize, matchCanonical} from '~/lib/catalog/attributes';
import type {QuizAnswers, QuizOutcome} from '~/lib/quiz/types';

export const QUIZ_ID = 'sleep_quiz';

export const QUIZ_ENTRY_POINTS = [
  'home',
  'menu',
  'collection',
  'product',
  'direct',
] as const;
export type QuizEntryPoint = (typeof QUIZ_ENTRY_POINTS)[number];

export const QUIZ_CLICK_TARGETS = [
  'product',
  'add_to_cart',
  'see_all_matches',
] as const;
export type QuizClickTarget = (typeof QUIZ_CLICK_TARGETS)[number];

type ParamValue = string | number;

export type QuizEventName =
  'quiz_start' | 'quiz_complete' | 'quiz_result_click';

export type QuizEvent = {
  readonly name: QuizEventName;
  readonly params: Readonly<Record<string, ParamValue>>;
};

export const QUIZ_EVENT_PARAMS = {
  quiz_start: ['quiz_id', 'question_count', 'entry_point'],
  quiz_complete: [
    'quiz_id',
    'question_count',
    'answered_count',
    'result_count',
    'chosen_size',
    'top_result_handle',
    'outcome',
    'duration_seconds',
  ],
  quiz_result_click: [
    'quiz_id',
    'product_handle',
    'result_position',
    'chosen_size',
    'click_target',
  ],
} as const;

const MAX_STRING = 100;

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Handles are lowercase letters, digits and hyphens; anything else is not sent. */
function handleParam(raw: string): string {
  const handle = raw.toLowerCase();
  return /^[a-z0-9][a-z0-9-]*$/.test(handle)
    ? handle.slice(0, MAX_STRING)
    : 'unknown';
}

function sizeParam(size: Size): string {
  return isSize(size) ? size : 'unknown';
}

export function buildQuizStartEvent(input: {
  readonly questionCount: number;
  readonly entryPoint?: string;
}): QuizEvent {
  return {
    name: 'quiz_start',
    params: {
      quiz_id: QUIZ_ID,
      question_count: clampInt(input.questionCount, 0, 50),
      entry_point:
        matchCanonical(QUIZ_ENTRY_POINTS, input.entryPoint) ?? 'direct',
    },
  };
}

/** The number of questions that have at least one valid answer. */
export function countAnswered(answers: QuizAnswers): number {
  return Object.values(answers).filter(
    (optionIds) => Array.isArray(optionIds) && optionIds.length > 0,
  ).length;
}

export function buildQuizCompleteEvent(input: {
  readonly questionCount: number;
  readonly answers: QuizAnswers;
  readonly outcome: QuizOutcome;
  /** Time from start to results, from the caller's clock; omitted when unknown. */
  readonly durationMs?: number;
}): QuizEvent {
  const matches = input.outcome.status === 'ok' ? input.outcome.matches : [];
  const params: Record<string, ParamValue> = {
    quiz_id: QUIZ_ID,
    question_count: clampInt(input.questionCount, 0, 50),
    answered_count: clampInt(countAnswered(input.answers), 0, 50),
    result_count: matches.length,
    chosen_size: sizeParam(input.outcome.size),
    top_result_handle: handleParam(matches[0]?.handle ?? 'none'),
    outcome: input.outcome.status,
  };
  if (input.durationMs !== undefined) {
    params.duration_seconds = clampInt(input.durationMs / 1000, 0, 3600);
  }
  return {name: 'quiz_complete', params};
}

export function buildQuizResultClickEvent(input: {
  readonly handle: string;
  /** 1 to 3, the position in the results. */
  readonly position: number;
  readonly size: Size;
  readonly target: string;
}): QuizEvent {
  return {
    name: 'quiz_result_click',
    params: {
      quiz_id: QUIZ_ID,
      product_handle: handleParam(input.handle),
      result_position: clampInt(input.position, 1, 3),
      chosen_size: sizeParam(input.size),
      click_target:
        matchCanonical(QUIZ_CLICK_TARGETS, input.target) ?? 'product',
    },
  };
}
