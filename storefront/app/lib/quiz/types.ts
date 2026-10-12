// Types for the sleep quiz (REQ-QZ-001 to REQ-QZ-006).
//
// Quiz content is data: questions, options and per-option scoring rules are
// managed in Shopify admin as metaobjects (REQ-QZ-004) and arrive as loose JSON.
// config.ts validates that JSON into these types. The rules are declarative so
// the client can approve them in plain language (CLR-012).

import type {Size} from '~/lib/catalog/attributes';

/** Product attributes a rule can score or exclude on (REQ-QZ-003). */
export type QuizScoredAttribute =
  'comfortLevel' | 'mattressType' | 'sleepPosition' | 'benefit';

export type QuizRule =
  /** Adds `weight` to a product that has the attribute value (negative penalises). */
  | {
      readonly kind: 'score';
      readonly attribute: QuizScoredAttribute;
      readonly value: string;
      readonly weight: number;
    }
  /** Removes products that have the attribute value from the results. */
  | {
      readonly kind: 'exclude';
      readonly attribute: QuizScoredAttribute;
      readonly value: string;
    }
  /** The answer picks the size whose price and availability are used. */
  | {readonly kind: 'size'; readonly size: Size}
  /** The answer sets a price range in the chosen size, in cents. */
  | {
      readonly kind: 'budget';
      readonly minCents: number | null;
      readonly maxCents: number | null;
    };

export type QuizOption = {
  readonly id: string;
  readonly label: string;
  readonly rules: readonly QuizRule[];
};

export type QuizQuestion = {
  readonly id: string;
  readonly order: number;
  readonly text: string;
  readonly helpText: string | null;
  /** Multi-select questions need a Continue button; single-select advance on tap. */
  readonly multi: boolean;
  readonly options: readonly QuizOption[];
};

export type QuizConfig = {
  readonly questions: readonly QuizQuestion[];
};

export type QuizWarningCode =
  | 'config_unreadable'
  | 'no_questions'
  | 'few_questions'
  | 'questions_truncated'
  | 'question_invalid'
  | 'question_duplicate'
  | 'question_too_few_options'
  | 'id_generated'
  | 'option_invalid'
  | 'option_duplicate'
  | 'options_truncated'
  | 'rule_invalid'
  | 'rules_truncated'
  | 'fallback_to_default';

/** A problem in the admin-managed configuration. Safe to log: it holds no personal data. */
export type QuizWarning = {
  readonly code: QuizWarningCode;
  /** Where in the configuration, for example "questions[2].options[1].rules[0]". */
  readonly path: string;
  readonly message: string;
};

export type QuizConfigResult = {
  readonly config: QuizConfig;
  readonly warnings: readonly QuizWarning[];
};

/** Option IDs the shopper chose, by question ID. */
export type QuizAnswers = Readonly<Record<string, readonly string[]>>;

export type QuizMatch = {
  /** 1 for the best match. */
  readonly rank: number;
  readonly productId: string;
  readonly handle: string;
  readonly title: string;
  readonly brand: string;
  readonly score: number;
  /** For example ["Medium", "Hybrid", "Cooling"]. */
  readonly reasons: readonly string[];
  /** The reasons joined for display: "Medium · Hybrid · Cooling". */
  readonly reasonLine: string;
  readonly size: Size;
  /** The variant to add to the cart for the chosen size. */
  readonly variantId: string;
  readonly priceCents: number;
  readonly compareAtCents: number | null;
};

export type QuizEmptyReason =
  | 'catalog_empty'
  | 'nothing_in_size'
  | 'nothing_in_budget'
  | 'excluded_by_answers';

export type QuizOutcome =
  | {
      readonly status: 'ok';
      readonly size: Size;
      readonly matches: readonly QuizMatch[];
    }
  | {
      readonly status: 'empty';
      readonly size: Size;
      readonly reason: QuizEmptyReason;
    };
