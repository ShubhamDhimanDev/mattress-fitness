// The default sleep quiz: eight one-tap questions covering sleep position,
// preferred feel, sleeping hot, sharing the bed, areas of discomfort, preferred
// mattress type, size and budget (SOW section 4, REQ-QZ-001).
//
// It is written in the same loose JSON shape the admin-managed metaobjects use,
// and goes through the same parser, so it doubles as a worked example and proves
// the parser accepts what the client will enter. It is the fallback when admin
// content is missing or entirely invalid. The wording and weights are a draft
// pending the client's approval (CLR-012); they are data, so changing them never
// needs a code change in the scoring.

import {SIZES, toSlug} from '~/lib/catalog/attributes';
import {parseQuizConfig} from '~/lib/quiz/config';
import type {QuizConfig, QuizConfigResult, QuizWarning} from '~/lib/quiz/types';

type RawRule = Record<string, string | number | boolean>;

const position = (value: string, weight: number): RawRule => ({
  attribute: 'sleep_positions',
  value,
  weight,
});
const comfort = (value: string, weight: number): RawRule => ({
  attribute: 'comfort_level',
  value,
  weight,
});
const type = (value: string, weight: number): RawRule => ({
  attribute: 'mattress_type',
  value,
  weight,
});
const benefit = (value: string, weight: number): RawRule => ({
  attribute: 'benefits',
  value,
  weight,
});
const budget = (maxDollars: number): RawRule => ({
  attribute: 'budget',
  max: maxDollars,
});

export const DEFAULT_QUIZ_RAW: readonly unknown[] = [
  {
    id: 'sleep-position',
    order: 1,
    text: 'How do you usually sleep?',
    help_text: 'Pick the position you spend the most time in.',
    multi: false,
    options: [
      {
        id: 'side',
        label: 'On my side',
        rules: [position('Side', 3), comfort('Plush', 1), comfort('Medium', 1)],
      },
      {
        id: 'back',
        label: 'On my back',
        rules: [position('Back', 3), comfort('Medium', 1), comfort('Firm', 1)],
      },
      {
        id: 'stomach',
        label: 'On my stomach',
        rules: [
          position('Stomach', 3),
          comfort('Firm', 1),
          comfort('Extra Firm', 1),
        ],
      },
      {
        id: 'mix',
        label: 'I switch around',
        rules: [
          position('Side', 1),
          position('Back', 1),
          position('Stomach', 1),
        ],
      },
    ],
  },
  {
    id: 'feel',
    order: 2,
    text: 'What kind of feel do you like?',
    help_text: 'Think about how you want the bed to feel when you lie down.',
    multi: false,
    options: [
      {
        id: 'soft',
        label: 'Soft and cushioned',
        rules: [
          comfort('Ultra Plush', 4),
          comfort('Plush', 3),
          comfort('Medium', 1),
        ],
      },
      {
        id: 'balanced',
        label: 'Balanced, not too soft or firm',
        rules: [comfort('Medium', 4), comfort('Plush', 2), comfort('Firm', 2)],
      },
      {
        id: 'firm',
        label: 'Firm and supportive',
        rules: [
          comfort('Firm', 4),
          comfort('Extra Firm', 3),
          comfort('Medium', 1),
        ],
      },
      {id: 'unsure', label: 'Not sure yet', rules: []},
    ],
  },
  {
    id: 'sleep-hot',
    order: 3,
    text: 'Do you tend to sleep hot?',
    multi: false,
    options: [
      {id: 'yes', label: 'Yes, I run hot', rules: [benefit('Cooling', 4)]},
      {id: 'sometimes', label: 'Sometimes', rules: [benefit('Cooling', 2)]},
      {id: 'no', label: 'No, I sleep cool or neutral', rules: []},
    ],
  },
  {
    id: 'sharing',
    order: 4,
    text: 'Who shares your bed?',
    multi: false,
    options: [
      {id: 'alone', label: 'Just me', rules: []},
      {
        id: 'partner',
        label: 'A partner',
        rules: [benefit('Motion Separation', 2)],
      },
      {
        id: 'restless',
        label: 'A partner, kids or pets who move a lot',
        rules: [benefit('Motion Separation', 4)],
      },
    ],
  },
  {
    id: 'discomfort',
    order: 5,
    text: 'Where do you feel aches or pain?',
    help_text: 'Choose the one that bothers you most.',
    multi: false,
    options: [
      {
        id: 'lower-back',
        label: 'Lower back',
        rules: [benefit('Back Support', 4)],
      },
      {
        id: 'hips-shoulders',
        label: 'Hips and shoulders',
        rules: [benefit('Pressure Relief', 4)],
      },
      {
        id: 'neck-upper-back',
        label: 'Neck and upper back',
        rules: [benefit('Back Support', 2), benefit('Pressure Relief', 2)],
      },
      {id: 'none', label: 'No aches or pain', rules: []},
    ],
  },
  {
    id: 'mattress-type',
    order: 6,
    text: 'Do you prefer a type of mattress?',
    multi: false,
    options: [
      {
        id: 'memory-foam',
        label: 'Memory foam',
        rules: [type('Memory Foam', 5)],
      },
      {id: 'hybrid', label: 'Hybrid', rules: [type('Hybrid', 5)]},
      {
        id: 'innerspring',
        label: 'Innerspring',
        rules: [type('Innerspring', 5)],
      },
      {
        id: 'latex',
        label: 'Latex',
        rules: [type('Latex', 5), benefit('Eco-Friendly', 1)],
      },
      {id: 'foam', label: 'Foam', rules: [type('Foam', 5)]},
      {id: 'no-preference', label: 'No preference', rules: []},
    ],
  },
  {
    id: 'size',
    order: 7,
    text: 'What size do you need?',
    multi: false,
    options: SIZES.map((size) => ({
      id: toSlug(size),
      label: size,
      rules: [{attribute: 'size', value: size}],
    })),
  },
  {
    id: 'budget',
    order: 8,
    text: 'What is your budget?',
    help_text: 'Prices are for the size you chose.',
    multi: false,
    options: [
      {id: 'up-to-1000', label: 'Up to $1,000', rules: [budget(1000)]},
      {id: 'up-to-1500', label: 'Up to $1,500', rules: [budget(1500)]},
      {id: 'up-to-2500', label: 'Up to $2,500', rules: [budget(2500)]},
      {id: 'up-to-4000', label: 'Up to $4,000', rules: [budget(4000)]},
      {id: 'any', label: 'No limit', rules: []},
    ],
  },
];

const defaults = parseQuizConfig(DEFAULT_QUIZ_RAW);

/** The default configuration, validated by the same parser as admin content. */
export const DEFAULT_QUIZ_CONFIG: QuizConfig = defaults.config;

/**
 * The configuration to run with: the admin-managed one when it has at least one
 * valid question, otherwise the default (with a warning so it gets noticed).
 */
export function resolveQuizConfig(raw: unknown): QuizConfigResult {
  const parsed = parseQuizConfig(raw);
  if (parsed.config.questions.length > 0) return parsed;
  const warning: QuizWarning = {
    code: 'fallback_to_default',
    path: '',
    message: 'No valid admin quiz questions; the default quiz is in use.',
  };
  return {
    config: DEFAULT_QUIZ_CONFIG,
    warnings: [...parsed.warnings, warning],
  };
}

/** Warnings from parsing the built-in default; a test asserts there are none. */
export const DEFAULT_QUIZ_WARNINGS: readonly QuizWarning[] = defaults.warnings;
