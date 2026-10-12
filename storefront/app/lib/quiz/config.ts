// Parses the admin-managed quiz configuration (REQ-QZ-004).
//
// The client edits questions, options and answer-to-attribute mappings as
// Shopify metaobjects. This module takes that loosely typed JSON and returns a
// validated QuizConfig plus warnings. It never throws: an invalid question,
// option or rule is dropped and reported, so a typo in admin can reduce the quiz
// but can never break the page. Callers log the warnings (no personal data in them).
//
// Accepted shape (field aliases in brackets):
//   [{ id, order, text, help_text [helpText], multi [multi_select],
//      options: [{ id, label,
//        rules [scoring_rules]: [
//          { attribute: "comfort_level" | "mattress_type" | "sleep_positions"
//                       | "benefits", value: "Medium", weight: 3 },
//          { attribute: "mattress_type", value: "Latex", exclude: true },
//          { attribute: "size", value: "Queen" },
//          { attribute: "budget", max: 1500, min: 500 }   // whole dollars
//        ] }] }]
// The metaobject schema is finalised in P3A-02 after V-05; keep this parser the
// only place that knows the stored shape.

import {
  BENEFITS,
  COMFORT_LEVELS,
  MATTRESS_TYPES,
  SIZES,
  SLEEP_POSITIONS,
  matchCanonical,
  toSlug,
} from '~/lib/catalog/attributes';
import {cleanText, hashString} from '~/lib/catalog/text';
import type {
  QuizConfig,
  QuizConfigResult,
  QuizOption,
  QuizQuestion,
  QuizRule,
  QuizScoredAttribute,
  QuizWarning,
  QuizWarningCode,
} from '~/lib/quiz/types';

export const QUIZ_LIMITS = {
  /** REQ-QZ-001: 6 to 8 questions. */
  maxQuestions: 8,
  recommendedMinQuestions: 6,
  minOptions: 2,
  maxOptions: 8,
  maxRulesPerOption: 12,
  maxWeight: 10,
  maxTextLength: 200,
  maxHelpTextLength: 300,
  maxLabelLength: 80,
  maxBudgetDollars: 100000,
  /** Only this many raw questions are even looked at, so a huge payload costs nothing. */
  maxRawQuestions: 50,
} as const;

const ID_MAX_LENGTH = 64;

type Warn = (code: QuizWarningCode, path: string, message: string) => void;
type RuleAttribute = QuizScoredAttribute | 'size' | 'budget';

const ATTRIBUTE_ALIASES = new Map<string, RuleAttribute>([
  ['comfort_level', 'comfortLevel'],
  ['comfortlevel', 'comfortLevel'],
  ['comfort', 'comfortLevel'],
  ['mattress_type', 'mattressType'],
  ['mattresstype', 'mattressType'],
  ['type', 'mattressType'],
  ['sleep_positions', 'sleepPosition'],
  ['sleep_position', 'sleepPosition'],
  ['sleepposition', 'sleepPosition'],
  ['position', 'sleepPosition'],
  ['benefits', 'benefit'],
  ['benefit', 'benefit'],
  ['size', 'size'],
  ['budget', 'budget'],
  ['price', 'budget'],
  ['max_price', 'budget'],
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** First present value among the alias names (admin field names vary in style). */
function pick(record: Record<string, unknown>, names: readonly string[]) {
  for (const name of names) {
    const value = record[name];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

const MAX_JSON_LENGTH = 200_000;

/** JSON text becomes its value (metaobject JSON fields arrive as text); anything else is returned as is. */
function readJson(raw: unknown): unknown {
  if (typeof raw !== 'string' || raw.length > MAX_JSON_LENGTH) return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** A list, or JSON text holding a list. */
function asList(raw: unknown): readonly unknown[] | null {
  const value = readJson(raw);
  return Array.isArray(value) ? value : null;
}

function asText(raw: unknown, maxLength: number): string | null {
  if (typeof raw !== 'string') return null;
  const text = cleanText(raw);
  return text !== '' && text.length <= maxLength ? text : null;
}

function parseWholeNumber(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isInteger(raw) ? raw : null;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return /^-?\d{1,9}$/.test(trimmed) ? Number(trimmed) : null;
}

function parseBoolean(raw: unknown): boolean | null {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw !== 'string') return null;
  const value = raw.trim().toLowerCase();
  if (value === 'true' || value === 'yes' || value === '1') return true;
  if (value === 'false' || value === 'no' || value === '0') return false;
  return null;
}

/** "$1,500", "1500" or 1500 (whole dollars) to cents; null when not a usable amount. */
function parseDollarsToCents(raw: unknown): number | null {
  const digits =
    typeof raw === 'number'
      ? Number.isInteger(raw) && raw >= 0
        ? String(raw)
        : ''
      : typeof raw === 'string'
        ? raw.replace(/[$,\s]/g, '')
        : '';
  if (!/^\d{1,6}$/.test(digits)) return null;
  const dollars = Number(digits);
  return dollars <= QUIZ_LIMITS.maxBudgetDollars ? dollars * 100 : null;
}

function resolveAttribute(raw: unknown): RuleAttribute | null {
  if (typeof raw !== 'string') return null;
  const key = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return ATTRIBUTE_ALIASES.get(key) ?? null;
}

export function quizVocabulary(
  attribute: QuizScoredAttribute,
): readonly string[] {
  switch (attribute) {
    case 'comfortLevel':
      return COMFORT_LEVELS;
    case 'mattressType':
      return MATTRESS_TYPES;
    case 'sleepPosition':
      return SLEEP_POSITIONS;
    case 'benefit':
      return BENEFITS;
    default: {
      const unreachable: never = attribute;
      return unreachable;
    }
  }
}

function parseScoredRule(
  raw: Record<string, unknown>,
  attribute: QuizScoredAttribute,
  reject: (message: string) => null,
): QuizRule | null {
  const value = matchCanonical(quizVocabulary(attribute), pick(raw, ['value']));
  if (value === null) {
    return reject(`The value is not one of the known ${attribute} values.`);
  }
  const excludeRaw = pick(raw, ['exclude', 'exclusion']);
  if (excludeRaw !== undefined) {
    const exclude = parseBoolean(excludeRaw);
    if (exclude === null)
      return reject('The exclude flag must be true or false.');
    if (exclude) return {kind: 'exclude', attribute, value};
  }
  const weight = parseWholeNumber(pick(raw, ['weight', 'score', 'points']));
  if (
    weight === null ||
    weight === 0 ||
    Math.abs(weight) > QUIZ_LIMITS.maxWeight
  ) {
    return reject(
      `The weight must be a whole number from -${QUIZ_LIMITS.maxWeight} to ${QUIZ_LIMITS.maxWeight}, not 0.`,
    );
  }
  return {kind: 'score', attribute, value, weight};
}

function parseBudgetRule(
  raw: Record<string, unknown>,
  reject: (message: string) => null,
): QuizRule | null {
  const maxRaw = pick(raw, ['max', 'value', 'max_price']);
  const minRaw = pick(raw, ['min', 'min_price']);
  const maxCents = maxRaw === undefined ? null : parseDollarsToCents(maxRaw);
  const minCents = minRaw === undefined ? null : parseDollarsToCents(minRaw);
  if (maxRaw !== undefined && (maxCents === null || maxCents === 0)) {
    return reject(
      'The budget maximum must be a whole number of dollars above 0.',
    );
  }
  if (minRaw !== undefined && minCents === null) {
    return reject('The budget minimum must be a whole number of dollars.');
  }
  if (maxCents === null && (minCents === null || minCents === 0)) {
    return reject('A budget rule needs a minimum or a maximum.');
  }
  if (maxCents !== null && minCents !== null && minCents > maxCents) {
    return reject('The budget minimum is above the maximum.');
  }
  return {
    kind: 'budget',
    minCents: minCents === 0 ? null : minCents,
    maxCents,
  };
}

function parseRule(raw: unknown, path: string, warn: Warn): QuizRule | null {
  const reject = (message: string): null => {
    warn('rule_invalid', path, message);
    return null;
  };
  if (!isRecord(raw)) return reject('A rule must be an object.');
  const attribute = resolveAttribute(
    pick(raw, ['attribute', 'filter', 'attr']),
  );
  if (attribute === null)
    return reject('The rule attribute is not recognised.');

  switch (attribute) {
    case 'size': {
      const size = matchCanonical(SIZES, pick(raw, ['value', 'size']));
      return size === null
        ? reject('The size is not one of the known sizes.')
        : {kind: 'size', size};
    }
    case 'budget':
      return parseBudgetRule(raw, reject);
    case 'comfortLevel':
    case 'mattressType':
    case 'sleepPosition':
    case 'benefit':
      return parseScoredRule(raw, attribute, reject);
    default: {
      const unreachable: never = attribute;
      return unreachable;
    }
  }
}

function parseRules(raw: unknown, path: string, warn: Warn): QuizRule[] {
  if (raw === undefined) return [];
  const list = asList(raw);
  if (!list) {
    warn('rule_invalid', path, 'The rules are not a list; none were applied.');
    return [];
  }
  if (list.length > QUIZ_LIMITS.maxRulesPerOption) {
    warn(
      'rules_truncated',
      path,
      `Only the first ${QUIZ_LIMITS.maxRulesPerOption} rules are used.`,
    );
  }
  const rules: QuizRule[] = [];
  list.slice(0, QUIZ_LIMITS.maxRulesPerOption).forEach((item, index) => {
    const rule = parseRule(item, `${path}[${index}]`, warn);
    if (rule) rules.push(rule);
  });
  return rules;
}

function parseId(raw: unknown): string {
  return typeof raw === 'string' ? toSlug(raw).slice(0, ID_MAX_LENGTH) : '';
}

function parseOption(
  raw: unknown,
  questionId: string,
  index: number,
  path: string,
  warn: Warn,
): QuizOption | null {
  if (!isRecord(raw)) {
    warn(
      'option_invalid',
      path,
      'An option must be an object; it was dropped.',
    );
    return null;
  }
  const label = asText(
    pick(raw, ['label', 'text', 'title']),
    QUIZ_LIMITS.maxLabelLength,
  );
  if (label === null) {
    warn(
      'option_invalid',
      path,
      `The option label is missing or longer than ${QUIZ_LIMITS.maxLabelLength} characters; it was dropped.`,
    );
    return null;
  }
  const id =
    parseId(pick(raw, ['id', 'handle', 'key'])) || `${questionId}-${index + 1}`;
  const rules = parseRules(
    pick(raw, ['rules', 'scoring_rules', 'scoringRules']),
    `${path}.rules`,
    warn,
  );
  return {id, label, rules};
}

function parseOptions(
  raw: unknown,
  questionId: string,
  path: string,
  warn: Warn,
): QuizOption[] {
  const list = asList(raw);
  if (!list) return [];
  if (list.length > QUIZ_LIMITS.maxOptions) {
    warn(
      'options_truncated',
      path,
      `Only the first ${QUIZ_LIMITS.maxOptions} options are used (one-tap answers).`,
    );
  }
  const options: QuizOption[] = [];
  const seen = new Set<string>();
  list.slice(0, QUIZ_LIMITS.maxOptions).forEach((item, index) => {
    const option = parseOption(
      item,
      questionId,
      index,
      `${path}[${index}]`,
      warn,
    );
    if (!option) return;
    if (seen.has(option.id)) {
      warn(
        'option_duplicate',
        `${path}[${index}]`,
        'Another option already uses this id; it was dropped.',
      );
      return;
    }
    seen.add(option.id);
    options.push(option);
  });
  return options;
}

function parseQuestion(
  raw: unknown,
  index: number,
  path: string,
  warn: Warn,
): QuizQuestion | null {
  if (!isRecord(raw)) {
    warn(
      'question_invalid',
      path,
      'A question must be an object; it was dropped.',
    );
    return null;
  }
  const text = asText(
    pick(raw, ['text', 'question']),
    QUIZ_LIMITS.maxTextLength,
  );
  if (text === null) {
    warn(
      'question_invalid',
      path,
      `The question text is missing or longer than ${QUIZ_LIMITS.maxTextLength} characters; the question was dropped.`,
    );
    return null;
  }
  let id = parseId(pick(raw, ['id', 'handle', 'key', 'slug']));
  if (id === '') {
    id = `q${index + 1}`;
    warn(
      'id_generated',
      path,
      `No usable id; "${id}" was generated from the position.`,
    );
  }

  const helpRaw = pick(raw, ['help_text', 'helpText', 'help']);
  const helpText = asText(helpRaw, QUIZ_LIMITS.maxHelpTextLength);
  const helpIsBlank = typeof helpRaw === 'string' && cleanText(helpRaw) === '';
  if (helpRaw !== undefined && helpText === null && !helpIsBlank) {
    warn(
      'question_invalid',
      `${path}.help_text`,
      'The help text is not text or is too long; it was left out.',
    );
  }

  const multiRaw = pick(raw, ['multi', 'multi_select', 'multiSelect']);
  const multi =
    multiRaw === undefined ? false : (parseBoolean(multiRaw) ?? false);
  const order =
    parseWholeNumber(pick(raw, ['order', 'position', 'sort'])) ?? index + 1;

  const options = parseOptions(
    pick(raw, ['options', 'answers']),
    id,
    `${path}.options`,
    warn,
  );
  if (options.length < QUIZ_LIMITS.minOptions) {
    warn(
      'question_too_few_options',
      path,
      `A question needs at least ${QUIZ_LIMITS.minOptions} valid options; the question was dropped.`,
    );
    return null;
  }
  return {id, order, text, helpText, multi, options};
}

function buildConfig(raw: unknown, warn: Warn): QuizConfig {
  const value = readJson(raw);
  const source = isRecord(value) ? pick(value, ['questions']) : value;
  const list = asList(source);
  if (!list) {
    warn(
      'config_unreadable',
      '',
      'The quiz configuration is not a list of questions.',
    );
    return {questions: []};
  }

  const parsed: {question: QuizQuestion; index: number}[] = [];
  const seen = new Set<string>();
  list.slice(0, QUIZ_LIMITS.maxRawQuestions).forEach((item, index) => {
    const question = parseQuestion(item, index, `questions[${index}]`, warn);
    if (!question) return;
    if (seen.has(question.id)) {
      warn(
        'question_duplicate',
        `questions[${index}]`,
        'Another question already uses this id; it was dropped.',
      );
      return;
    }
    seen.add(question.id);
    parsed.push({question, index});
  });

  // Stable: equal order numbers keep the order they were entered in.
  parsed.sort(
    (a, b) => a.question.order - b.question.order || a.index - b.index,
  );

  if (parsed.length > QUIZ_LIMITS.maxQuestions) {
    warn(
      'questions_truncated',
      'questions',
      `Only the first ${QUIZ_LIMITS.maxQuestions} questions are used (REQ-QZ-001).`,
    );
  }
  const questions = parsed
    .slice(0, QUIZ_LIMITS.maxQuestions)
    .map((entry) => entry.question);

  if (questions.length === 0) {
    warn('no_questions', 'questions', 'No valid questions were found.');
  } else if (questions.length < QUIZ_LIMITS.recommendedMinQuestions) {
    warn(
      'few_questions',
      'questions',
      `The quiz has ${questions.length} questions; the scope is 6 to 8.`,
    );
  }
  return {questions};
}

/** Validates admin-managed JSON. Never throws; see the file header for the shape. */
export function parseQuizConfig(raw: unknown): QuizConfigResult {
  const warnings: QuizWarning[] = [];
  const warn: Warn = (code, path, message) => {
    warnings.push({code, path, message});
  };
  try {
    return {config: buildConfig(raw, warn), warnings};
  } catch {
    // Hostile or exotic input (for example an object whose getters throw). The
    // error text is not logged: it could echo the content.
    warn('config_unreadable', '', 'The quiz configuration could not be read.');
    return {config: {questions: []}, warnings};
  }
}

/**
 * A short stable fingerprint of the configuration. Saved results carry it so a
 * change in admin (new questions or rules) marks old results as out of date.
 */
export function fingerprintConfig(config: QuizConfig): string {
  return hashString(JSON.stringify(config));
}
