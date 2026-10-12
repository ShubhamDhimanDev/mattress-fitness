import {describe, expect, it} from 'vitest';
import {SIZES} from '~/lib/catalog/attributes';
import {mulberry32} from '~/lib/catalog/test-helpers';
import {
  QUIZ_LIMITS,
  fingerprintConfig,
  parseQuizConfig,
} from '~/lib/quiz/config';
import {
  DEFAULT_QUIZ_CONFIG,
  DEFAULT_QUIZ_RAW,
  DEFAULT_QUIZ_WARNINGS,
  resolveQuizConfig,
} from '~/lib/quiz/default-config';
import type {QuizWarningCode} from '~/lib/quiz/types';

function question(overrides: Record<string, unknown> = {}) {
  return {
    id: 'feel',
    order: 1,
    text: 'What feel do you like?',
    options: [
      {id: 'soft', label: 'Soft', rules: []},
      {id: 'firm', label: 'Firm', rules: []},
    ],
    ...overrides,
  };
}

function codes(raw: unknown): QuizWarningCode[] {
  return parseQuizConfig(raw).warnings.map((warning) => warning.code);
}

describe('quiz configuration parsing (REQ-QZ-004)', () => {
  it('accepts a valid question list with no warnings beyond the question count note', () => {
    const {config, warnings} = parseQuizConfig([question()]);
    expect(config.questions).toHaveLength(1);
    expect(config.questions[0]).toMatchObject({
      id: 'feel',
      order: 1,
      text: 'What feel do you like?',
      helpText: null,
      multi: false,
    });
    expect(warnings.map((w) => w.code)).toEqual(['few_questions']);
  });

  it('accepts {questions: [...]} and a JSON string, with field aliases', () => {
    const raw = {
      questions: [
        question({
          helpText: 'Pick one',
          multi_select: 'true',
          options: [
            {
              handle: 'soft',
              text: 'Soft',
              scoring_rules: [
                {attribute: 'comfort_level', value: 'plush', weight: '3'},
              ],
            },
            {key: 'firm', title: 'Firm'},
          ],
        }),
      ],
    };
    for (const input of [raw, JSON.stringify(raw)]) {
      const {config} = parseQuizConfig(input);
      expect(config.questions[0]).toMatchObject({
        helpText: 'Pick one',
        multi: true,
      });
      expect(config.questions[0]?.options[0]).toEqual({
        id: 'soft',
        label: 'Soft',
        rules: [
          {
            kind: 'score',
            attribute: 'comfortLevel',
            value: 'Plush',
            weight: 3,
          },
        ],
      });
    }
  });

  it('sorts by order and keeps entry order for equal numbers', () => {
    const {config} = parseQuizConfig([
      question({id: 'c', order: 3}),
      question({id: 'a', order: 1}),
      question({id: 'b2', order: 2}),
      question({id: 'b1', order: 2}),
    ]);
    expect(config.questions.map((q) => q.id)).toEqual(['a', 'b2', 'b1', 'c']);
  });

  it('normalises ids to lowercase slugs and generates one when missing', () => {
    const {config, warnings} = parseQuizConfig([
      question({id: 'Sleep Position'}),
      question({id: undefined, order: 2}),
    ]);
    expect(config.questions.map((q) => q.id)).toEqual(['sleep-position', 'q2']);
    expect(warnings.some((w) => w.code === 'id_generated')).toBe(true);
  });

  it('strips markup and control characters from text', () => {
    const {config} = parseQuizConfig([
      question({
        text: '  <b>How</b> do you\u0000 sleep?\n<script>alert(1)</script>',
        options: [
          {id: 'a', label: '<img src=x onerror=alert(1)>Side'},
          {id: 'b', label: 'Back‮'},
        ],
      }),
    ]);
    expect(config.questions[0]?.text).toBe('How do you sleep? alert(1)');
    expect(config.questions[0]?.options.map((o) => o.label)).toEqual([
      'Side',
      'Back',
    ]);
  });

  describe('invalid configuration never throws and is reported', () => {
    it.each([
      [null],
      [undefined],
      [42],
      [true],
      ['not json'],
      ['{"questions": "nope"}'],
      [{}],
      [[]],
      [{questions: {}}],
      [Symbol('x')],
      [() => 'fn'],
    ])('returns an empty config for %j', (input) => {
      const result = parseQuizConfig(input);
      expect(result.config.questions).toEqual([]);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it.each<[string, unknown, QuizWarningCode]>([
      ['a question that is not an object', ['text'], 'question_invalid'],
      [
        'a question with no text',
        [question({text: undefined})],
        'question_invalid',
      ],
      ['a blank question', [question({text: '   '})], 'question_invalid'],
      [
        'a question text over the limit',
        [question({text: 'x'.repeat(QUIZ_LIMITS.maxTextLength + 1)})],
        'question_invalid',
      ],
      [
        'a question with one option',
        [question({options: [{id: 'a', label: 'A'}]})],
        'question_too_few_options',
      ],
      [
        'a question whose options are not a list',
        [question({options: 'nope'})],
        'question_too_few_options',
      ],
    ])('drops %s', (_name, input, code) => {
      const result = parseQuizConfig(input);
      expect(result.config.questions).toEqual([]);
      expect(result.warnings.map((w) => w.code)).toContain(code);
    });

    it('drops a duplicate question id but keeps the first', () => {
      const result = parseQuizConfig([
        question({text: 'First'}),
        question({text: 'Second', order: 2}),
      ]);
      expect(result.config.questions.map((q) => q.text)).toEqual(['First']);
      expect(codes([question(), question()])).toContain('question_duplicate');
    });

    it('drops invalid and duplicate options but keeps the question when two remain', () => {
      const result = parseQuizConfig([
        question({
          options: [
            {id: 'a', label: 'A'},
            {id: 'b'},
            'text',
            {id: 'a', label: 'A again'},
            {id: 'c', label: 'x'.repeat(QUIZ_LIMITS.maxLabelLength + 1)},
            {id: 'd', label: 'D'},
          ],
        }),
      ]);
      expect(result.config.questions[0]?.options.map((o) => o.id)).toEqual([
        'a',
        'd',
      ]);
      const found = result.warnings.map((w) => w.code);
      expect(found.filter((c) => c === 'option_invalid')).toHaveLength(3);
      expect(found).toContain('option_duplicate');
    });

    it('truncates to 8 options, 8 questions and 12 rules', () => {
      const manyOptions = Array.from({length: 12}, (_, i) => ({
        id: `o${i}`,
        label: `Option ${i}`,
      }));
      const manyRules = Array.from({length: 20}, () => ({
        attribute: 'benefit',
        value: 'Cooling',
        weight: 1,
      }));
      const questions = Array.from({length: 12}, (_, i) =>
        question({
          id: `q-${i}`,
          order: i,
          options:
            i === 0
              ? manyOptions
              : [
                  {id: 'a', label: 'A', rules: i === 1 ? manyRules : []},
                  {id: 'b', label: 'B'},
                ],
        }),
      );
      const result = parseQuizConfig(questions);
      expect(result.config.questions).toHaveLength(QUIZ_LIMITS.maxQuestions);
      expect(result.config.questions[0]?.options).toHaveLength(
        QUIZ_LIMITS.maxOptions,
      );
      expect(result.config.questions[1]?.options[0]?.rules).toHaveLength(
        QUIZ_LIMITS.maxRulesPerOption,
      );
      const found = result.warnings.map((w) => w.code);
      expect(found).toContain('questions_truncated');
      expect(found).toContain('options_truncated');
      expect(found).toContain('rules_truncated');
    });

    it('only inspects a bounded number of raw questions', () => {
      const huge = Array.from({length: 100_000}, (_, i) =>
        question({id: `q${i}`, order: i}),
      );
      const result = parseQuizConfig(huge);
      expect(result.config.questions).toHaveLength(QUIZ_LIMITS.maxQuestions);
    });

    it('survives input whose properties throw', () => {
      const hostile = new Proxy(
        {},
        {
          get() {
            throw new Error('boom');
          },
        },
      );
      const result = parseQuizConfig([hostile]);
      expect(result.config.questions).toEqual([]);
      const nested = parseQuizConfig(hostile);
      expect(nested.config.questions).toEqual([]);
      expect(nested.warnings.map((w) => w.code)).toContain('config_unreadable');
      // The error text must not leak into warnings.
      expect(JSON.stringify(nested.warnings)).not.toContain('boom');
    });
  });

  describe('rules: invalid mappings are dropped with a warning, the option stays', () => {
    function ruleResult(rule: unknown) {
      const result = parseQuizConfig([
        question({
          options: [
            {id: 'a', label: 'A', rules: [rule]},
            {id: 'b', label: 'B'},
          ],
        }),
      ]);
      return {
        rules: result.config.questions[0]?.options[0]?.rules ?? [],
        rule: result.warnings.filter((w) => w.code === 'rule_invalid'),
        optionKept: result.config.questions[0]?.options.length === 2,
      };
    }

    it.each([
      [
        {attribute: 'comfort_level', value: 'Medium', weight: 3},
        {kind: 'score', attribute: 'comfortLevel', value: 'Medium', weight: 3},
      ],
      [
        {attribute: 'mattress_type', value: 'memory-foam', weight: -2},
        {
          kind: 'score',
          attribute: 'mattressType',
          value: 'Memory Foam',
          weight: -2,
        },
      ],
      [
        {attribute: 'sleep_positions', value: 'SIDE', weight: '10'},
        {kind: 'score', attribute: 'sleepPosition', value: 'Side', weight: 10},
      ],
      [
        {attribute: 'benefits', value: 'Eco Friendly', weight: 1},
        {kind: 'score', attribute: 'benefit', value: 'Eco-Friendly', weight: 1},
      ],
      [
        {attribute: 'mattress_type', value: 'Latex', exclude: true},
        {kind: 'exclude', attribute: 'mattressType', value: 'Latex'},
      ],
      [
        {
          attribute: 'mattress_type',
          value: 'Latex',
          exclude: 'true',
          weight: 5,
        },
        {kind: 'exclude', attribute: 'mattressType', value: 'Latex'},
      ],
      [
        {attribute: 'mattress_type', value: 'Latex', exclude: false, weight: 2},
        {kind: 'score', attribute: 'mattressType', value: 'Latex', weight: 2},
      ],
      [
        {attribute: 'size', value: 'california king'},
        {kind: 'size', size: 'California King'},
      ],
      [
        {attribute: 'budget', max: 1500},
        {kind: 'budget', minCents: null, maxCents: 150000},
      ],
      [
        {attribute: 'budget', value: '$2,500'},
        {kind: 'budget', minCents: null, maxCents: 250000},
      ],
      [
        {attribute: 'price', min: 500, max: 1500},
        {kind: 'budget', minCents: 50000, maxCents: 150000},
      ],
      [
        {attribute: 'budget', min: 2000},
        {kind: 'budget', minCents: 200000, maxCents: null},
      ],
    ])('accepts %j', (rule, expected) => {
      const {rules, rule: warnings} = ruleResult(rule);
      expect(rules).toEqual([expected]);
      expect(warnings).toEqual([]);
    });

    it.each([
      ['not an object', 'comfort'],
      ['null', null],
      ['an array', []],
      ['an unknown attribute', {attribute: 'color', value: 'red', weight: 1}],
      ['no attribute', {value: 'Medium', weight: 1}],
      [
        'an unknown comfort value',
        {attribute: 'comfort_level', value: 'Squishy', weight: 1},
      ],
      [
        'an unknown benefit value',
        {attribute: 'benefits', value: 'Free pizza', weight: 1},
      ],
      [
        'a script as value',
        {attribute: 'benefits', value: '<script>', weight: 1},
      ],
      ['a missing weight', {attribute: 'benefits', value: 'Cooling'}],
      ['a zero weight', {attribute: 'benefits', value: 'Cooling', weight: 0}],
      [
        'a weight above the limit',
        {attribute: 'benefits', value: 'Cooling', weight: 11},
      ],
      [
        'a weight below the limit',
        {attribute: 'benefits', value: 'Cooling', weight: -11},
      ],
      [
        'a fractional weight',
        {attribute: 'benefits', value: 'Cooling', weight: 2.5},
      ],
      [
        'a text weight',
        {attribute: 'benefits', value: 'Cooling', weight: 'heavy'},
      ],
      [
        'an infinite weight',
        {
          attribute: 'benefits',
          value: 'Cooling',
          weight: Number.POSITIVE_INFINITY,
        },
      ],
      [
        'a bad exclude flag',
        {attribute: 'benefits', value: 'Cooling', exclude: 'maybe'},
      ],
      ['an unknown size', {attribute: 'size', value: 'Emperor'}],
      ['a budget with no amounts', {attribute: 'budget'}],
      ['a budget of zero', {attribute: 'budget', max: 0}],
      ['a negative budget', {attribute: 'budget', max: -5}],
      ['a fractional budget', {attribute: 'budget', max: 99.5}],
      ['a huge budget', {attribute: 'budget', max: 99999999}],
      ['a text budget', {attribute: 'budget', max: 'lots'}],
      [
        'a budget with min above max',
        {attribute: 'budget', min: 2000, max: 1000},
      ],
    ])('drops a rule that is %s', (_name, rule) => {
      const result = ruleResult(rule);
      expect(result.rules).toEqual([]);
      expect(result.rule).toHaveLength(1);
      expect(result.optionKept).toBe(true);
    });

    it('reports rules that are not a list and keeps the option', () => {
      const result = parseQuizConfig([
        question({
          options: [
            {id: 'a', label: 'A', rules: 'broken'},
            {id: 'b', label: 'B'},
          ],
        }),
      ]);
      expect(result.config.questions[0]?.options).toHaveLength(2);
      expect(result.warnings.map((w) => w.code)).toContain('rule_invalid');
    });

    it('warning paths point at the offending place', () => {
      const result = parseQuizConfig([
        question({
          options: [
            {id: 'a', label: 'A'},
            {
              id: 'b',
              label: 'B',
              rules: [
                {attribute: 'benefits', value: 'Cooling', weight: 1},
                {attribute: 'nope'},
              ],
            },
          ],
        }),
      ]);
      const warning = result.warnings.find((w) => w.code === 'rule_invalid');
      expect(warning?.path).toBe('questions[0].options[1].rules[1]');
    });
  });

  describe('property: arbitrary JSON never throws and the result is always well formed', () => {
    function randomValue(random: () => number, depth: number): unknown {
      const pick = Math.floor(random() * (depth > 3 ? 6 : 10));
      switch (pick) {
        case 0:
          return null;
        case 1:
          return Math.floor(random() * 30) - 15;
        case 2:
          return random() * 10;
        case 3:
          return [
            '',
            'Medium',
            'comfort_level',
            'size',
            'budget',
            'true',
            '<b>x</b>',
            'Queen',
          ][Math.floor(random() * 8)];
        case 4:
          return random() > 0.5;
        case 5:
          return undefined;
        case 6:
        case 7:
          return Array.from({length: Math.floor(random() * 5)}, () =>
            randomValue(random, depth + 1),
          );
        default: {
          const keys = [
            'id',
            'order',
            'text',
            'options',
            'label',
            'rules',
            'attribute',
            'value',
            'weight',
            'exclude',
            'multi',
            'max',
            'min',
            'questions',
          ];
          const entries = Array.from({length: Math.floor(random() * 7)}, () => [
            keys[Math.floor(random() * keys.length)] ?? 'id',
            randomValue(random, depth + 1),
          ]);
          return Object.fromEntries(entries);
        }
      }
    }

    function expectWellFormed(raw: unknown) {
      const {questions} = parseQuizConfig(raw).config;
      expect(questions.length).toBeLessThanOrEqual(QUIZ_LIMITS.maxQuestions);
      expect(new Set(questions.map((q) => q.id)).size).toBe(questions.length);
      for (const q of questions) {
        expect(q.options.length).toBeGreaterThanOrEqual(QUIZ_LIMITS.minOptions);
        expect(q.options.length).toBeLessThanOrEqual(QUIZ_LIMITS.maxOptions);
        expect(new Set(q.options.map((o) => o.id)).size).toBe(q.options.length);
        expect(q.text).not.toBe('');
        const rules = q.options.flatMap((option) => option.rules);
        for (const option of q.options) {
          expect(option.rules.length).toBeLessThanOrEqual(
            QUIZ_LIMITS.maxRulesPerOption,
          );
        }
        const weights = rules.flatMap((rule) =>
          rule.kind === 'score' ? [rule.weight] : [],
        );
        for (const weight of weights) {
          expect(Number.isInteger(weight)).toBe(true);
          expect(Math.abs(weight)).toBeLessThanOrEqual(QUIZ_LIMITS.maxWeight);
          expect(weight).not.toBe(0);
        }
      }
    }

    it('holds for 400 random structures', () => {
      const random = mulberry32(4242);
      for (let i = 0; i < 400; i += 1) {
        expectWellFormed(randomValue(random, 0));
      }
    });

    it('holds for 300 mostly valid configurations with random corruption', () => {
      const random = mulberry32(777);
      const maybe = (value: unknown) =>
        random() < 0.2 ? randomValue(random, 2) : value;
      for (let i = 0; i < 300; i += 1) {
        const questions = Array.from(
          {length: Math.floor(random() * 13)},
          (_, q) =>
            maybe({
              id: maybe(`q${q}`),
              order: maybe(Math.floor(random() * 5)),
              text: maybe('A question'),
              multi: maybe(random() > 0.5),
              options: maybe(
                Array.from({length: Math.floor(random() * 11)}, (_o, o) =>
                  maybe({
                    id: maybe(`o${o}`),
                    label: maybe(`Option ${o}`),
                    rules: maybe(
                      Array.from({length: Math.floor(random() * 15)}, () =>
                        maybe({
                          attribute: maybe('benefits'),
                          value: maybe('Cooling'),
                          weight: maybe(Math.floor(random() * 25) - 12),
                        }),
                      ),
                    ),
                  }),
                ),
              ),
            }),
        );
        expectWellFormed(questions);
      }
    });
  });

  describe('fingerprint', () => {
    it('is stable and changes when a rule changes', () => {
      const a = parseQuizConfig(DEFAULT_QUIZ_RAW).config;
      const b = parseQuizConfig(DEFAULT_QUIZ_RAW).config;
      expect(fingerprintConfig(a)).toBe(fingerprintConfig(b));
      const changed = parseQuizConfig(
        JSON.parse(
          JSON.stringify(DEFAULT_QUIZ_RAW).replace('"weight":3', '"weight":4'),
        ),
      ).config;
      expect(fingerprintConfig(changed)).not.toBe(fingerprintConfig(a));
      expect(fingerprintConfig(a)).toMatch(/^[0-9a-f]{1,16}$/);
    });
  });
});

describe('default quiz (REQ-QZ-001, CLR-012 draft)', () => {
  it('parses with no warnings through the same parser as admin content', () => {
    expect(DEFAULT_QUIZ_WARNINGS).toEqual([]);
  });

  it('has the eight questions the SOW names, in order', () => {
    expect(DEFAULT_QUIZ_CONFIG.questions.map((q) => q.id)).toEqual([
      'sleep-position',
      'feel',
      'sleep-hot',
      'sharing',
      'discomfort',
      'mattress-type',
      'size',
      'budget',
    ]);
    expect(DEFAULT_QUIZ_CONFIG.questions.length).toBeGreaterThanOrEqual(6);
    expect(DEFAULT_QUIZ_CONFIG.questions.length).toBeLessThanOrEqual(8);
  });

  it('is all one-tap: every question is single-select with 2 to 8 options', () => {
    for (const q of DEFAULT_QUIZ_CONFIG.questions) {
      expect(q.multi).toBe(false);
      expect(q.options.length).toBeGreaterThanOrEqual(2);
      expect(q.options.length).toBeLessThanOrEqual(8);
      expect(q.text.length).toBeGreaterThan(0);
    }
  });

  it('offers every size, each mapped to a size rule', () => {
    const sizeQuestion = DEFAULT_QUIZ_CONFIG.questions.find(
      (q) => q.id === 'size',
    );
    expect(sizeQuestion?.options.map((o) => o.label)).toEqual([...SIZES]);
    for (const option of sizeQuestion?.options ?? []) {
      expect(option.rules).toEqual([{kind: 'size', size: option.label}]);
    }
  });

  it('maps the budget answers to rising caps and leaves "No limit" unconstrained', () => {
    const budget = DEFAULT_QUIZ_CONFIG.questions.find((q) => q.id === 'budget');
    const caps = (budget?.options ?? []).map((o) => {
      const rule = o.rules[0];
      return rule?.kind === 'budget' ? rule.maxCents : null;
    });
    expect(caps).toEqual([100000, 150000, 250000, 400000, null]);
  });

  it('falls back to the default only when admin content has no valid question', () => {
    const missing = resolveQuizConfig(null);
    expect(missing.config).toBe(DEFAULT_QUIZ_CONFIG);
    expect(missing.warnings.map((w) => w.code)).toContain(
      'fallback_to_default',
    );

    const custom = resolveQuizConfig([
      question(),
      question({id: 'x', order: 2}),
    ]);
    expect(custom.config.questions.map((q) => q.id)).toEqual(['feel', 'x']);
    expect(custom.warnings.map((w) => w.code)).not.toContain(
      'fallback_to_default',
    );
  });
});
