// Quiz result kept in the signed-in customer's account (REQ-QZ-005, P6-04).
//
// Pure rules only: what is accepted from the browser, what is stored in the customer metafield
// `custom.quiz_result`, and how it is read back. The Customer Account API calls are in
// `account-sync.server.ts`; the fetch wrappers for the browser are in `account-sync-client.ts`.
//
// What is stored: the answers (option ids), the handles of the top recommendations, a timestamp and the
// quiz-configuration fingerprint. No free text and no personal data. The browser sends only answers and a
// timestamp: the handles are recomputed on the server from the same recommendation source the quiz page uses,
// so a forged handle cannot be written.

import {
  isSafeHandle,
  sanitizeAnswers,
  type SavedQuiz,
} from '~/lib/quiz/storage';
import type {QuizAnswers, QuizConfig, QuizOutcome} from '~/lib/quiz/types';

export const ACCOUNT_SUMMARY_VERSION = 1;
export const ACCOUNT_SUMMARY_MAX_BYTES = 4096;
export const SYNC_REQUEST_MAX_BYTES = 6144;
export const ACCOUNT_MAX_HANDLES = 3;
export const SYNC_ENDPOINT = '/account/quiz-sync';

const FINGERPRINT_PATTERN = /^[0-9a-f]{1,16}$/;
const FUTURE_SKEW_MS = 5 * 60_000;

export type AccountQuizSummary = {
  /** Epoch milliseconds when the shopper finished the quiz. */
  readonly savedAt: number;
  readonly configFingerprint: string | null;
  readonly answers: QuizAnswers;
  /** Top recommendations at that time, best first. */
  readonly handles: readonly string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Keeps only questions and options that exist in the current quiz; a single-select keeps its first option. */
export function restrictAnswersToConfig(
  answers: QuizAnswers,
  config: QuizConfig,
): QuizAnswers {
  const entries: [string, readonly string[]][] = [];
  for (const question of config.questions) {
    const chosen = answers[question.id];
    if (!Array.isArray(chosen)) continue;
    const known = question.options
      .map((option) => option.id)
      .filter((id) => chosen.includes(id));
    const kept = question.multi ? known : known.slice(0, 1);
    if (kept.length > 0) entries.push([question.id, kept]);
  }
  return Object.fromEntries(entries);
}

export type SyncRequestParse =
  | {
      readonly status: 'ok';
      readonly answers: QuizAnswers;
      readonly savedAt: number;
    }
  | {
      readonly status: 'invalid';
      readonly reason: 'missing' | 'too_large' | 'corrupt' | 'no_valid_answers';
    };

/** Reads the `payload` form field the browser posts. Never trusts anything beyond answers and a timestamp. */
export function parseSyncRequest(
  raw: unknown,
  config: QuizConfig,
  nowMs: number,
): SyncRequestParse {
  if (typeof raw !== 'string' || raw === '') {
    return {status: 'invalid', reason: 'missing'};
  }
  if (byteLength(raw) > SYNC_REQUEST_MAX_BYTES) {
    return {status: 'invalid', reason: 'too_large'};
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return {status: 'invalid', reason: 'corrupt'};
  }
  if (!isRecord(value)) return {status: 'invalid', reason: 'corrupt'};
  const cleaned = sanitizeAnswers(value.answers);
  const answers = cleaned ? restrictAnswersToConfig(cleaned, config) : {};
  if (Object.keys(answers).length === 0) {
    return {status: 'invalid', reason: 'no_valid_answers'};
  }
  const claimed = value.savedAt;
  const savedAt =
    typeof claimed === 'number' && Number.isSafeInteger(claimed) && claimed >= 0
      ? Math.min(claimed, nowMs)
      : nowMs;
  return {status: 'ok', answers, savedAt};
}

/** The summary to store: handles come from the server's own scoring outcome, never from the request. */
export function buildAccountSummary(input: {
  readonly answers: QuizAnswers;
  readonly savedAt: number;
  readonly outcome: QuizOutcome;
  readonly configFingerprint: string | null;
}): AccountQuizSummary {
  const handles =
    input.outcome.status === 'ok'
      ? input.outcome.matches
          .map((match) => match.handle)
          .filter(isSafeHandle)
          .slice(0, ACCOUNT_MAX_HANDLES)
      : [];
  return {
    savedAt: input.savedAt,
    configFingerprint: input.configFingerprint,
    answers: input.answers,
    handles: [...new Set(handles)],
  };
}

export type SummarySerialize =
  | {readonly status: 'ok'; readonly json: string}
  | {readonly status: 'error'; readonly reason: 'invalid' | 'too_large'};

/** The value for the json metafield. */
export function serializeAccountSummary(
  summary: AccountQuizSummary,
): SummarySerialize {
  const clean = sanitizeAccountSummary({
    v: ACCOUNT_SUMMARY_VERSION,
    ...summary,
  });
  if (!clean || Object.keys(clean.answers).length === 0) {
    return {status: 'error', reason: 'invalid'};
  }
  const json = JSON.stringify({v: ACCOUNT_SUMMARY_VERSION, ...clean});
  if (byteLength(json) > ACCOUNT_SUMMARY_MAX_BYTES) {
    return {status: 'error', reason: 'too_large'};
  }
  return {status: 'ok', json};
}

function sanitizeAccountSummary(raw: unknown): AccountQuizSummary | null {
  if (!isRecord(raw)) return null;
  const {savedAt, configFingerprint, answers, handles} = raw;
  if (
    typeof savedAt !== 'number' ||
    !Number.isSafeInteger(savedAt) ||
    savedAt < 0
  ) {
    return null;
  }
  const cleanAnswers = sanitizeAnswers(answers);
  if (!cleanAnswers) return null;
  const cleanHandles = (Array.isArray(handles) ? handles : [])
    .filter(isSafeHandle)
    .slice(0, ACCOUNT_MAX_HANDLES);
  return {
    savedAt,
    configFingerprint:
      typeof configFingerprint === 'string' &&
      FINGERPRINT_PATTERN.test(configFingerprint)
        ? configFingerprint
        : null,
    answers: cleanAnswers,
    handles: [...new Set(cleanHandles)],
  };
}

export type AccountSummaryParse =
  | {readonly status: 'ok'; readonly summary: AccountQuizSummary}
  | {readonly status: 'empty'}
  | {readonly status: 'invalid'};

/** Reads the metafield value (text or parsed JSON). Never throws; an unreadable value counts as none. */
export function parseAccountSummary(raw: unknown): AccountSummaryParse {
  if (raw === null || raw === undefined || raw === '') {
    return {status: 'empty'};
  }
  let value: unknown = raw;
  if (typeof raw === 'string') {
    if (byteLength(raw) > ACCOUNT_SUMMARY_MAX_BYTES) {
      return {status: 'invalid'};
    }
    try {
      value = JSON.parse(raw);
    } catch {
      return {status: 'invalid'};
    }
  }
  if (!isRecord(value) || value.v !== ACCOUNT_SUMMARY_VERSION) {
    return {status: 'invalid'};
  }
  const summary = sanitizeAccountSummary(value);
  if (!summary || Object.keys(summary.answers).length === 0) {
    return {status: 'invalid'};
  }
  return {status: 'ok', summary};
}

/**
 * The account copy as a device-format saved quiz. Results are empty on purpose: the quiz page recomputes
 * them from the answers with current prices, and a time in the future is pulled back to now.
 */
export function accountSummaryToSavedQuiz(
  summary: AccountQuizSummary,
  nowMs: number,
): SavedQuiz {
  return {
    savedAt: Math.min(summary.savedAt, nowMs + FUTURE_SKEW_MS),
    configFingerprint: summary.configFingerprint,
    answers: summary.answers,
    results: [],
  };
}

/** The form body the browser posts: only answers and the time they were given. */
export function buildSyncPayload(saved: SavedQuiz): string {
  return JSON.stringify({savedAt: saved.savedAt, answers: saved.answers});
}

export type AnswerRow = {
  readonly question: string;
  readonly answer: string;
};

/** Question and option labels for the account page, in question order; unknown ids are skipped. */
export function answerRows(
  answers: QuizAnswers,
  config: QuizConfig,
): readonly AnswerRow[] {
  return config.questions.flatMap((question) => {
    const labels = question.options
      .filter((option) => answers[question.id]?.includes(option.id))
      .map((option) => option.label);
    return labels.length === 0
      ? []
      : [{question: question.text, answer: labels.join(', ')}];
  });
}
