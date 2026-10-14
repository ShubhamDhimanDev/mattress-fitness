import {describe, expect, it} from 'vitest';
import {FIXTURE_PRODUCTS} from '~/lib/catalog/fixtures';
import {parseFilterParams} from '~/lib/filters';
import {
  INTRO_STATE,
  decodeFlow,
  encodeFlow,
  progressOf,
  reduceFlow,
  type QuizFlowState,
} from '~/lib/pages/quiz-flow';
import {
  answerSummary,
  buildSavedQuiz,
  emptyOutcomeMessage,
  isResumable,
  matchPriceView,
  seeAllMatchesPath,
} from '~/lib/pages/quiz-view';
import {DEFAULT_QUIZ_CONFIG} from '~/lib/quiz/default-config';
import {scoreProducts} from '~/lib/quiz/score';
import type {QuizConfig} from '~/lib/quiz/types';

// REQ-QZ-001 (one-tap flow, progress, back), REQ-QZ-002 (see all matches, price in chosen size),
// REQ-QZ-005 (saved results). Golden transitions over the default configuration.

const config = DEFAULT_QUIZ_CONFIG;
const questionIds = config.questions.map((q) => q.id);
const firstOptions = config.questions.map((q) => q.options[0]?.id ?? '');

function run(
  actions: readonly Parameters<typeof reduceFlow>[1][],
  from: QuizFlowState = INTRO_STATE,
  cfg: QuizConfig = config,
): QuizFlowState {
  return actions.reduce(
    (state, action) => reduceFlow(state, action, cfg),
    from,
  );
}

function answerAll(): QuizFlowState {
  return run([
    {type: 'start'},
    ...firstOptions.map((optionId) => ({type: 'select' as const, optionId})),
  ]);
}

describe('REQ-QZ-001 reducer transitions', () => {
  it('has the eight default questions', () => {
    expect(config.questions).toHaveLength(8);
  });

  it('start opens question 1 with no answers', () => {
    expect(run([{type: 'start'}])).toEqual({
      phase: 'question',
      index: 0,
      answers: {},
    });
  });

  it('one tap on a single-select option records it and advances', () => {
    const state = run([{type: 'start'}, {type: 'select', optionId: 'side'}]);
    expect(state).toEqual({
      phase: 'question',
      index: 1,
      answers: {'sleep-position': ['side']},
    });
  });

  it('answering the last question shows the results with all answers', () => {
    const state = answerAll();
    expect(state.phase).toBe('results');
    if (state.phase === 'results') {
      expect(Object.keys(state.answers)).toEqual(questionIds);
    }
  });

  it('back moves one question and keeps the answers; from question 1 it returns to the intro', () => {
    const second = run([{type: 'start'}, {type: 'select', optionId: 'side'}]);
    const back = reduceFlow(second, {type: 'back'}, config);
    expect(back).toEqual({
      phase: 'question',
      index: 0,
      answers: {'sleep-position': ['side']},
    });
    expect(reduceFlow(back, {type: 'back'}, config)).toEqual(INTRO_STATE);
  });

  it('back from the results reopens the last question with answers kept', () => {
    const state = reduceFlow(answerAll(), {type: 'back'}, config);
    expect(state).toMatchObject({
      phase: 'question',
      index: config.questions.length - 1,
    });
  });

  it('retake clears everything', () => {
    expect(reduceFlow(answerAll(), {type: 'retake'}, config)).toEqual(
      INTRO_STATE,
    );
  });

  it('ignores an unknown option, an action in the wrong phase and an empty config', () => {
    const started = run([{type: 'start'}]);
    expect(
      reduceFlow(started, {type: 'select', optionId: 'nope'}, config),
    ).toBe(started);
    expect(
      reduceFlow(INTRO_STATE, {type: 'select', optionId: 'side'}, config),
    ).toBe(INTRO_STATE);
    expect(reduceFlow(INTRO_STATE, {type: 'back'}, config)).toBe(INTRO_STATE);
    expect(reduceFlow(INTRO_STATE, {type: 'start'}, {questions: []})).toBe(
      INTRO_STATE,
    );
    // Next without an answer does not skip the question.
    expect(reduceFlow(started, {type: 'next'}, config)).toBe(started);
  });

  it('a multi-select question toggles and needs Continue', () => {
    const multi: QuizConfig = {
      questions: [
        {
          id: 'm',
          order: 1,
          text: 'Pick',
          helpText: null,
          multi: true,
          options: [
            {id: 'a', label: 'A', rules: []},
            {id: 'b', label: 'B', rules: []},
          ],
        },
      ],
    };
    let state = run([{type: 'start'}], INTRO_STATE, multi);
    state = run([{type: 'select', optionId: 'a'}], state, multi);
    state = run([{type: 'select', optionId: 'b'}], state, multi);
    expect(state).toEqual({
      phase: 'question',
      index: 0,
      answers: {m: ['a', 'b']},
    });
    state = run([{type: 'select', optionId: 'a'}], state, multi);
    expect(state).toMatchObject({answers: {m: ['b']}});
    expect(run([{type: 'next'}], state, multi).phase).toBe('results');
  });

  it('resume goes to results only for known answers', () => {
    expect(
      reduceFlow(
        INTRO_STATE,
        {type: 'resume', answers: {feel: ['soft'], bogus: ['x']}},
        config,
      ),
    ).toEqual({phase: 'results', answers: {feel: ['soft']}});
    expect(
      reduceFlow(
        INTRO_STATE,
        {type: 'resume', answers: {bogus: ['x']}},
        config,
      ),
    ).toBe(INTRO_STATE);
  });
});

describe('REQ-QZ-001 progress', () => {
  it('reports the question number and a percentage', () => {
    expect(progressOf(INTRO_STATE, config)).toEqual({
      current: 0,
      total: 8,
      percent: 0,
    });
    expect(
      progressOf({phase: 'question', index: 3, answers: {}}, config),
    ).toEqual({current: 4, total: 8, percent: 38});
    expect(progressOf(answerAll(), config).percent).toBe(100);
  });
});

describe('URL codec (reload and shared links)', () => {
  it('round-trips a mid-quiz state', () => {
    const state = run([
      {type: 'start'},
      {type: 'select', optionId: 'side'},
      {type: 'select', optionId: 'soft'},
    ]);
    const params = encodeFlow(state);
    expect(params.toString()).toBe('step=3&a.sleep-position=side&a.feel=soft');
    expect(decodeFlow(params, config)).toEqual(state);
  });

  it('round-trips the results and keeps unrelated parameters', () => {
    const state = answerAll();
    const params = encodeFlow(state, new URLSearchParams('from=home&step=2'));
    expect(params.get('from')).toBe('home');
    expect(decodeFlow(params, config)).toEqual(state);
  });

  it('the intro has no flow parameters', () => {
    expect(
      encodeFlow(INTRO_STATE, new URLSearchParams('a.feel=soft')).toString(),
    ).toBe('');
  });

  it.each([
    ['unknown step', 'step=banana&a.feel=soft'],
    ['step zero', 'step=0'],
    ['step beyond the end', 'step=99'],
    ['results without any answer', 'step=results'],
    ['results with only unknown answers', 'step=results&a.nope=x&a.feel=nope'],
    ['negative step', 'step=-1'],
  ])('hostile or stale URL (%s) falls back to the intro', (_name, query) => {
    expect(decodeFlow(new URLSearchParams(query), config)).toEqual(INTRO_STATE);
  });

  it('drops unknown options and extra values on a single-select question', () => {
    const state = decodeFlow(
      new URLSearchParams(
        'step=2&a.feel=soft&a.feel=firm&a.sleep-position=zzz',
      ),
      config,
    );
    expect(state).toEqual({
      phase: 'question',
      index: 1,
      answers: {feel: ['soft']},
    });
  });

  it('does not read prototype keys as answers', () => {
    const state = decodeFlow(
      new URLSearchParams(
        'step=results&a.constructor=x&a.__proto__=y&a.feel=soft',
      ),
      config,
    );
    expect(state).toEqual({phase: 'results', answers: {feel: ['soft']}});
  });
});

describe('REQ-QZ-002 results helpers', () => {
  const answers = {
    'sleep-position': ['side'],
    feel: ['soft'],
    size: ['queen'],
    budget: ['up-to-2500'],
  };

  it('see-all-matches links to the collection with validated filters', () => {
    const path = seeAllMatchesPath(answers, config);
    expect(path.startsWith('/collections/mattresses?')).toBe(true);
    const params = new URLSearchParams(path.split('?')[1]);
    const state = parseFilterParams(params);
    expect(state.selected.size).toEqual(['Queen']);
    expect(state.priceMaxCents).toBe(250000);
    expect(state.selected.comfortLevel).toEqual(['Ultra Plush', 'Plush']);
  });

  it('see-all-matches is the bare collection when the answers set no filter', () => {
    expect(seeAllMatchesPath({}, config)).toBe('/collections/mattresses');
  });

  it('formats the price in the chosen size, with the original price only on a sale', () => {
    expect(
      matchPriceView({priceCents: 149900, compareAtCents: null, size: 'Queen'}),
    ).toEqual({text: '$1,499', compareAtText: null, label: 'Queen price'});
    expect(
      matchPriceView({priceCents: 99900, compareAtCents: 129900, size: 'King'}),
    ).toMatchObject({text: '$999', compareAtText: '$1,299'});
    // Compare-at not above price is not a sale.
    expect(
      matchPriceView({priceCents: 99900, compareAtCents: 99900, size: 'King'})
        .compareAtText,
    ).toBeNull();
  });

  it('gives a message for every empty reason', () => {
    for (const reason of [
      'catalog_empty',
      'nothing_in_size',
      'nothing_in_budget',
      'excluded_by_answers',
    ] as const) {
      expect(emptyOutcomeMessage(reason).length).toBeGreaterThan(10);
    }
  });

  it('summarises the chosen options in question order', () => {
    expect(answerSummary(answers, config)[0]).toEqual({
      questionId: 'sleep-position',
      question: 'How do you usually sleep?',
      answer: 'On my side',
    });
    expect(answerSummary({}, config)).toEqual([]);
  });

  it('end to end: fixture answers give exactly three ranked matches', () => {
    const outcome = scoreProducts(answers, FIXTURE_PRODUCTS, config);
    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') expect(outcome.matches).toHaveLength(3);
  });
});

describe('REQ-QZ-005 saving and resuming', () => {
  const answers = {feel: ['soft'], size: ['queen']};
  const outcome = scoreProducts(answers, FIXTURE_PRODUCTS, config);
  const now = Date.UTC(2026, 9, 13);

  it('saves answers and result summaries without prices or variant ids', () => {
    const saved = buildSavedQuiz({answers, outcome, config, nowMs: now});
    expect(saved?.answers).toEqual(answers);
    expect(saved?.results).toHaveLength(3);
    expect(JSON.stringify(saved)).not.toMatch(/variant|priceCents/i);
  });

  it('offers a recent save, drops an expired one', () => {
    const saved = buildSavedQuiz({answers, outcome, config, nowMs: now});
    if (!saved) throw new Error('expected a saved quiz');
    expect(isResumable(saved, config, now + 86_400_000)).toBe(true);
    expect(isResumable(saved, config, now + 200 * 86_400_000)).toBe(false);
  });
});
