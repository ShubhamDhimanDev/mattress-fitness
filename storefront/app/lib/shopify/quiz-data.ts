// The sleep quiz as the client edits it in Shopify admin (P6-13, P6-01, REQ-QZ-004, NFR-005). Server side only.
//
// Admin holds three kinds of metaobject: `quiz_question` (text, order, options), `quiz_option` (label and rules) and
// `quiz_scoring_rule` (attribute, value, effect, weight). This module reads them in one query and rebuilds the loose JSON
// shape that `parseQuizConfig` validates (app/lib/quiz/config.ts), so that parser stays the only place that decides
// what a valid question, option or rule is; an invalid rule is dropped there with a warning, never a crash.
//
// Merge rule per option: if the option references at least one `quiz_scoring_rule`, those rules are used and the older
// JSON field `scoring_rules` is ignored; with no references the JSON field is used as before. They are never added
// together, so moving an option from JSON to rules cannot double its scores. With no `quiz_question` entries at all the
// result is `undefined`, which the quiz treats as "use the built-in default quiz".
//
// Verified against the Storefront API reference (2026-10): `metaobjects(type, first)`, `MetaobjectField.value`,
// `.reference` and `.references(first)` (a `MetafieldReferenceConnection`, whose nodes include `Metaobject`).
// ASSUMPTION(V-05): the nested read stays within the Storefront API's query cost; the counts below are kept small for it.

import type {Storefront} from '~/lib/hydrogen/storefront';
import {errorFields, logError} from '~/lib/logging/logger';
import {catalogCache} from '~/lib/shopify/cache';

const QUESTION_LIMIT = 12;
const OPTION_LIMIT = 8;
const RULE_LIMIT = 12;

export const QUIZ_QUESTIONS_QUERY = `#graphql
  query QuizQuestions($country: CountryCode, $language: LanguageCode)
  @inContext(country: $country, language: $language) {
    questions: metaobjects(type: "quiz_question", first: 12) {
      nodes {
        id
        handle
        fields {
          key
          value
          references(first: 8) {
            nodes {
              ... on Metaobject {
                id
                handle
                fields {
                  key
                  value
                  references(first: 12) {
                    nodes {
                      ... on Metaobject {
                        id
                        handle
                        fields {
                          key
                          value
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
` as const;

/** The shape this module needs; the generated query type is assignable to it. */
type RawField = {
  readonly key: string;
  readonly value?: string | null;
  readonly references?: {readonly nodes: readonly unknown[]} | null;
};

type RawMetaobject = {
  readonly handle?: string | null;
  readonly fields: readonly RawField[];
};

function isRawMetaobject(value: unknown): value is RawMetaobject {
  return (
    typeof value === 'object' &&
    value !== null &&
    'fields' in value &&
    Array.isArray(value.fields)
  );
}

function valuesOf(node: RawMetaobject): Readonly<Record<string, string>> {
  const record: Record<string, string> = {};
  for (const field of node.fields) {
    if (typeof field.value === 'string' && field.value.trim() !== '') {
      record[field.key] = field.value;
    }
  }
  return record;
}

function referencedNodes(node: RawMetaobject, key: string): RawMetaobject[] {
  const field = node.fields.find((candidate) => candidate.key === key);
  return (field?.references?.nodes ?? []).filter(isRawMetaobject);
}

/**
 * One `quiz_scoring_rule` entry as the rule object `parseQuizConfig` reads. Values are passed on as text; the parser
 * checks them against the known attribute values and weight limits. An unknown effect is passed as an unreadable
 * `exclude` flag on purpose, so the parser reports it instead of this module guessing what the client meant.
 */
export function ruleToRaw(node: RawMetaobject): Record<string, unknown> {
  const fields = valuesOf(node);
  const attribute = fields.attribute;
  const value = fields.value;
  if (attribute === 'budget') {
    return {attribute, max: value, ...pickDefined('min', fields.min_dollars)};
  }
  if (attribute === 'size') return {attribute, value};
  const effect = fields.effect ?? 'boost';
  if (effect === 'exclude') return {attribute, value, exclude: true};
  if (effect === 'boost') return {attribute, value, weight: fields.weight};
  return {attribute, value, exclude: effect};
}

function pickDefined(key: string, value: string | undefined) {
  return value === undefined ? {} : {[key]: value};
}

function optionToRaw(node: RawMetaobject): Record<string, unknown> {
  const fields = valuesOf(node);
  const rules = referencedNodes(node, 'rules').slice(0, RULE_LIMIT);
  return {
    id: node.handle ?? undefined,
    label: fields.label,
    // References win; the JSON text (parsed by the quiz parser) is the fallback. Never both.
    ...(rules.length > 0
      ? {rules: rules.map(ruleToRaw)}
      : fields.scoring_rules === undefined
        ? {}
        : {rules: fields.scoring_rules}),
  };
}

function questionToRaw(node: RawMetaobject): Record<string, unknown> {
  const fields = valuesOf(node);
  return {
    id: node.handle ?? undefined,
    order: fields.order,
    text: fields.text,
    help_text: fields.help_text,
    multi: fields.multi,
    options: referencedNodes(node, 'options')
      .slice(0, OPTION_LIMIT)
      .map(optionToRaw),
  };
}

/**
 * The admin quiz as loose JSON for `resolveQuizConfig`, or `undefined` when no question exists (then the built-in
 * default quiz is used). Pure over the query's nodes.
 */
export function buildQuizRaw(nodes: readonly unknown[]): unknown {
  const questions = nodes.filter(isRawMetaobject).map(questionToRaw);
  return questions.length > 0 ? questions.slice(0, QUESTION_LIMIT) : undefined;
}

/** Reads the quiz. A failed read is `undefined` (the default quiz), logged by class name only (T-05). */
export async function loadQuizConfigRaw(
  storefront: Storefront,
): Promise<unknown> {
  try {
    const {questions} = await storefront.query(QUIZ_QUESTIONS_QUERY, {
      // Questions and rules carry no price or availability: the long strategy (edits show within about an hour).
      cache: catalogCache(storefront),
    });
    return buildQuizRaw(questions.nodes);
  } catch (error: unknown) {
    logError('quiz.admin_config_read_failed', errorFields(error));
    return undefined;
  }
}
