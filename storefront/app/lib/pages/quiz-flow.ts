// The quiz as a pure state machine (REQ-QZ-001, REQ-QZ-002).
//
// The URL is the store: `?step=3&a.feel=soft` decodes to a state, an action
// produces the next state, and the next state encodes back to a URL. A reload,
// the back button and a shared link therefore all land on the same screen, and
// there is no client state to keep in sync. Everything read from the URL is
// checked against the loaded configuration (unknown questions, options and
// steps are dropped), so a hand-edited URL can degrade the quiz but not break it.

import type {QuizAnswers, QuizConfig, QuizQuestion} from '~/lib/quiz/types';

export type QuizFlowState =
  | {readonly phase: 'intro'}
  | {
      readonly phase: 'question';
      /** Zero-based index into the configuration's questions. */
      readonly index: number;
      readonly answers: QuizAnswers;
    }
  | {readonly phase: 'results'; readonly answers: QuizAnswers};

export type QuizFlowAction =
  | {readonly type: 'start'}
  /** One tap on an option; a single-select question advances at once. */
  | {readonly type: 'select'; readonly optionId: string}
  /** "Continue" on a multi-select question, or skipping an answered one. */
  | {readonly type: 'next'}
  | {readonly type: 'back'}
  | {readonly type: 'retake'}
  /** Jump to results with answers already known (saved on this device). */
  | {readonly type: 'resume'; readonly answers: QuizAnswers};

export const INTRO_STATE: QuizFlowState = {phase: 'intro'};

export const STEP_PARAM = 'step';
export const ANSWER_PREFIX = 'a.';
export const RESULTS_STEP = 'results';
const ENTRY_PARAM = 'from';

function questionAt(
  config: QuizConfig,
  index: number,
): QuizQuestion | undefined {
  return config.questions[index];
}

/** Keeps only answers for known questions and options, in question order. */
export function sanitizeFlowAnswers(
  answers: QuizAnswers,
  config: QuizConfig,
): QuizAnswers {
  const clean: Record<string, readonly string[]> = {};
  for (const question of config.questions) {
    if (!Object.hasOwn(answers, question.id)) continue;
    const given = answers[question.id];
    if (!Array.isArray(given)) continue;
    const valid = question.options
      .filter((option) => given.includes(option.id))
      .map((option) => option.id);
    const kept = question.multi ? valid : valid.slice(0, 1);
    if (kept.length > 0) clean[question.id] = kept;
  }
  return clean;
}

export function hasAnyAnswer(answers: QuizAnswers): boolean {
  return Object.values(answers).some((ids) => ids.length > 0);
}

// --- URL codec ---

export function decodeFlow(
  params: URLSearchParams,
  config: QuizConfig,
): QuizFlowState {
  const raw: Record<string, string[]> = {};
  for (const question of config.questions) {
    const values = params.getAll(`${ANSWER_PREFIX}${question.id}`);
    if (values.length > 0) raw[question.id] = values;
  }
  const answers = sanitizeFlowAnswers(raw, config);
  const step = params.get(STEP_PARAM);

  if (step === RESULTS_STEP) {
    return hasAnyAnswer(answers) ? {phase: 'results', answers} : INTRO_STATE;
  }
  if (step !== null && /^\d{1,2}$/.test(step)) {
    const index = Number(step) - 1;
    if (index >= 0 && index < config.questions.length) {
      return {phase: 'question', index, answers};
    }
  }
  return INTRO_STATE;
}

/**
 * The flow parameters for a state. Other parameters (such as `from`) are kept
 * from `base`; this codec's own parameters are replaced.
 */
export function encodeFlow(
  state: QuizFlowState,
  base?: URLSearchParams,
): URLSearchParams {
  const params = new URLSearchParams(base);
  for (const key of [...params.keys()]) {
    if (key === STEP_PARAM || key.startsWith(ANSWER_PREFIX)) {
      params.delete(key);
    }
  }
  if (state.phase === 'intro') return params;

  params.set(
    STEP_PARAM,
    state.phase === 'results' ? RESULTS_STEP : String(state.index + 1),
  );
  for (const [questionId, optionIds] of Object.entries(state.answers)) {
    for (const optionId of optionIds) {
      params.append(`${ANSWER_PREFIX}${questionId}`, optionId);
    }
  }
  return params;
}

/** The entry point for analytics: where the shopper came from. Validated by the event builder. */
export function readEntryPoint(params: URLSearchParams): string | undefined {
  return params.get(ENTRY_PARAM) ?? undefined;
}

// --- Transitions ---

function withAnswer(
  answers: QuizAnswers,
  question: QuizQuestion,
  optionId: string,
): QuizAnswers {
  const current = answers[question.id] ?? [];
  if (!question.multi) return {...answers, [question.id]: [optionId]};
  const next = current.includes(optionId)
    ? current.filter((id) => id !== optionId)
    : [...current, optionId];
  const rest = Object.fromEntries(
    Object.entries(answers).filter(([id]) => id !== question.id),
  );
  return next.length > 0 ? {...rest, [question.id]: next} : rest;
}

function advance(
  index: number,
  answers: QuizAnswers,
  config: QuizConfig,
): QuizFlowState {
  return index + 1 < config.questions.length
    ? {phase: 'question', index: index + 1, answers}
    : {phase: 'results', answers};
}

/**
 * The next state for an action. Invalid actions (an unknown option, going back
 * from the intro) return the state unchanged rather than throwing.
 */
export function reduceFlow(
  state: QuizFlowState,
  action: QuizFlowAction,
  config: QuizConfig,
): QuizFlowState {
  switch (action.type) {
    case 'start':
      return config.questions.length === 0
        ? state
        : {phase: 'question', index: 0, answers: {}};

    case 'select': {
      if (state.phase !== 'question') return state;
      const question = questionAt(config, state.index);
      if (!question?.options.some((o) => o.id === action.optionId)) {
        return state;
      }
      const answers = withAnswer(state.answers, question, action.optionId);
      return question.multi
        ? {...state, answers}
        : advance(state.index, answers, config);
    }

    case 'next': {
      if (state.phase !== 'question') return state;
      const question = questionAt(config, state.index);
      // Every question needs an answer: a multi-select question must have at least one.
      if (!question || (state.answers[question.id]?.length ?? 0) === 0) {
        return state;
      }
      return advance(state.index, state.answers, config);
    }

    case 'back':
      if (state.phase === 'question') {
        return state.index === 0
          ? INTRO_STATE
          : {...state, index: state.index - 1};
      }
      // From the results, back reopens the last question with answers kept.
      return state.phase === 'results'
        ? {
            phase: 'question',
            index: Math.max(0, config.questions.length - 1),
            answers: state.answers,
          }
        : state;

    case 'retake':
      return INTRO_STATE;

    case 'resume': {
      const answers = sanitizeFlowAnswers(action.answers, config);
      return hasAnyAnswer(answers) ? {phase: 'results', answers} : state;
    }

    default: {
      const unreachable: never = action;
      return unreachable;
    }
  }
}

export type QuizProgress = {
  /** 1-based number of the question being answered. */
  readonly current: number;
  readonly total: number;
  readonly percent: number;
};

export function progressOf(
  state: QuizFlowState,
  config: QuizConfig,
): QuizProgress {
  const total = config.questions.length;
  if (state.phase === 'question') {
    return {
      current: state.index + 1,
      total,
      percent: Math.round((state.index / total) * 100),
    };
  }
  return {
    current: state.phase === 'results' ? total : 0,
    total,
    percent: state.phase === 'results' ? 100 : 0,
  };
}
