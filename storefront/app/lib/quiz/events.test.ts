import {describe, expect, it} from 'vitest';
import {
  QUIZ_EVENT_PARAMS,
  QUIZ_ID,
  buildQuizCompleteEvent,
  buildQuizResultClickEvent,
  buildQuizStartEvent,
  countAnswered,
} from '~/lib/quiz/events';
import type {QuizOutcome} from '~/lib/quiz/types';

const OK: QuizOutcome = {
  status: 'ok',
  size: 'King',
  matches: [
    {
      rank: 1,
      productId: 'p1',
      handle: 'larkmoor-cedar-medium-hybrid',
      title: 'Title',
      brand: 'Brand',
      image: null,
      score: 9,
      reasons: ['Medium'],
      reasonLine: 'Medium',
      size: 'King',
      variantId: 'v1',
      priceCents: 100,
      compareAtCents: null,
    },
  ],
};

// A parameter value that looks like personal data must never appear in an event.
const PERSONAL_LOOKING = [
  'jane@example.com',
  '+1 212 555 0100',
  '10001',
  'Jane Doe',
];

function expectNoPersonalData(
  params: Readonly<Record<string, string | number>>,
) {
  const text = JSON.stringify(params);
  for (const value of PERSONAL_LOOKING) expect(text).not.toContain(value);
}

describe('quiz analytics events (REQ-QZ-006)', () => {
  it('quiz_start carries only the documented parameters', () => {
    const event = buildQuizStartEvent({questionCount: 8, entryPoint: 'home'});
    expect(event).toEqual({
      name: 'quiz_start',
      params: {quiz_id: QUIZ_ID, question_count: 8, entry_point: 'home'},
    });
    expect(Object.keys(event.params)).toEqual([
      ...QUIZ_EVENT_PARAMS.quiz_start,
    ]);
  });

  it.each([
    ['Home', 'home'],
    ['collection', 'collection'],
    ['product', 'product'],
    ['menu', 'menu'],
    ['jane@example.com', 'direct'],
    ['<script>', 'direct'],
    ['', 'direct'],
    [undefined, 'direct'],
  ])('entry point %j is reported as %j', (entryPoint, expected) => {
    expect(
      buildQuizStartEvent({questionCount: 8, entryPoint}).params.entry_point,
    ).toBe(expected);
  });

  it('quiz_complete carries the documented parameters and the chosen size', () => {
    const event = buildQuizCompleteEvent({
      questionCount: 8,
      answers: {a: ['x'], b: ['y'], c: []},
      outcome: OK,
      durationMs: 41_400,
    });
    expect(event).toEqual({
      name: 'quiz_complete',
      params: {
        quiz_id: QUIZ_ID,
        question_count: 8,
        answered_count: 2,
        result_count: 1,
        chosen_size: 'King',
        top_result_handle: 'larkmoor-cedar-medium-hybrid',
        outcome: 'ok',
        duration_seconds: 41,
      },
    });
    expect(Object.keys(event.params).sort()).toEqual(
      [...QUIZ_EVENT_PARAMS.quiz_complete].sort(),
    );
  });

  it('quiz_complete without matches or a duration', () => {
    const event = buildQuizCompleteEvent({
      questionCount: 8,
      answers: {},
      outcome: {
        status: 'empty',
        size: 'Queen',
        reason: 'nothing_in_budget',
        similar: [],
      },
    });
    expect(event.params).toEqual({
      quiz_id: QUIZ_ID,
      question_count: 8,
      answered_count: 0,
      result_count: 0,
      chosen_size: 'Queen',
      top_result_handle: 'none',
      outcome: 'empty',
    });
  });

  it.each([
    [-5, 0],
    [Number.NaN, 0],
    [Number.POSITIVE_INFINITY, 0],
    [499, 0],
    [500, 1],
    [999_999_999, 3600],
  ])('duration %j ms is reported as %j seconds', (durationMs, seconds) => {
    expect(
      buildQuizCompleteEvent({
        questionCount: 8,
        answers: {},
        outcome: OK,
        durationMs,
      }).params.duration_seconds,
    ).toBe(seconds);
  });

  it('quiz_result_click carries the documented parameters', () => {
    const event = buildQuizResultClickEvent({
      handle: 'larkmoor-cedar-medium-hybrid',
      position: 2,
      size: 'Queen',
      target: 'add_to_cart',
    });
    expect(event).toEqual({
      name: 'quiz_result_click',
      params: {
        quiz_id: QUIZ_ID,
        product_handle: 'larkmoor-cedar-medium-hybrid',
        result_position: 2,
        chosen_size: 'Queen',
        click_target: 'add_to_cart',
      },
    });
    expect(Object.keys(event.params)).toEqual([
      ...QUIZ_EVENT_PARAMS.quiz_result_click,
    ]);
  });

  it.each([
    ['product', 'product'],
    ['add-to-cart', 'add_to_cart'],
    ['See all matches', 'see_all_matches'],
    ['jane@example.com', 'product'],
    ['', 'product'],
  ])('click target %j is reported as %j', (target, expected) => {
    expect(
      buildQuizResultClickEvent({
        handle: 'x',
        position: 1,
        size: 'Queen',
        target,
      }).params.click_target,
    ).toBe(expected);
  });

  it.each([
    [0, 1],
    [-3, 1],
    [1, 1],
    [3, 3],
    [99, 3],
    [Number.NaN, 1],
    [2.6, 3],
  ])('result position %j is clamped to %j', (position, expected) => {
    expect(
      buildQuizResultClickEvent({
        handle: 'x',
        position,
        size: 'Queen',
        target: 'product',
      }).params.result_position,
    ).toBe(expected);
  });

  it.each([
    ['jane@example.com'],
    ['Jane Doe'],
    ['a/b'],
    ['<script>alert(1)</script>'],
    [''],
    ['-leading-hyphen'],
  ])('a handle like %j is never sent', (handle) => {
    expect(
      buildQuizResultClickEvent({
        handle,
        position: 1,
        size: 'Queen',
        target: 'product',
      }).params.product_handle,
    ).toBe('unknown');
  });

  it('truncates a very long handle to the analytics limit', () => {
    const long = 'a'.repeat(300);
    const sent = buildQuizResultClickEvent({
      handle: long,
      position: 1,
      size: 'Queen',
      target: 'product',
    }).params.product_handle;
    expect(String(sent)).toHaveLength(100);
  });

  it('event and parameter names fit the analytics limits and no value is personal data', () => {
    const events = [
      buildQuizStartEvent({questionCount: 8, entryPoint: 'jane@example.com'}),
      buildQuizCompleteEvent({questionCount: 8, answers: {}, outcome: OK}),
      buildQuizResultClickEvent({
        handle: 'Jane Doe',
        position: 1,
        size: 'Queen',
        target: 'x',
      }),
    ];
    for (const event of events) {
      expect(event.name.length).toBeLessThanOrEqual(40);
      expect(event.name).toMatch(/^[a-z][a-z0-9_]*$/);
      for (const [key, value] of Object.entries(event.params)) {
        expect(key.length).toBeLessThanOrEqual(40);
        expect(key).toMatch(/^[a-z][a-z0-9_]*$/);
        expect(String(value).length).toBeLessThanOrEqual(100);
      }
      expectNoPersonalData(event.params);
    }
  });

  it('counts answered questions, ignoring empty answers', () => {
    expect(countAnswered({})).toBe(0);
    expect(countAnswered({a: [], b: ['x'], c: ['y', 'z']})).toBe(2);
  });
});
