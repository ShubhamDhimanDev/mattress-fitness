// Saved quiz results (REQ-QZ-005): remembered on the device, and saved to the
// customer account when signed in.
//
// One versioned envelope is used for both places. Parsing is tolerant: a
// corrupted, oversized or old entry never throws, it is reported and ignored.
// Storage is injected (a Web Storage object in the browser, a fake in tests).
//
// What is stored: the answers (option IDs) and, per result, only the handle,
// size, score and reasons. Prices and variant IDs are deliberately NOT stored:
// saved data comes from the browser and is not trusted, so a returning shopper's
// prices are always read again from Shopify before anything can be added to a cart.
//
// Quiz answers are not personal data by design (no free text), which is why
// they may sit in local storage and in a customer metafield.

import type {Size} from '~/lib/catalog/attributes';
import {isSize} from '~/lib/catalog/attributes';
import {cleanText} from '~/lib/catalog/text';
import type {QuizAnswers, QuizOutcome} from '~/lib/quiz/types';

export const QUIZ_STORAGE_KEY = 'quiz.saved';
export const QUIZ_STORAGE_VERSION = 1;
export const QUIZ_STORAGE_MAX_BYTES = 8192;
export const QUIZ_STORAGE_MAX_AGE_DAYS = 180;

/**
 * Where the account copy lives: one customer metafield of type json, written through the Customer Account
 * API `metafieldsSet` mutation (documented since 2024-07). It needs a definition with customer-account
 * access READ_WRITE; see docs/integrations/QUIZ_ACCOUNT_SYNC.md. Unverified on the client's store (V-08).
 */
export const QUIZ_ACCOUNT_METAFIELD = {
  namespace: 'custom',
  key: 'quiz_result',
  type: 'json',
} as const;

const MAX_ANSWERED_QUESTIONS = 12;
const MAX_OPTIONS_PER_ANSWER = 8;
const MAX_RESULTS = 3;
const MAX_REASONS = 6;
const MAX_REASON_LENGTH = 60;
const MAX_ABS_SCORE = 1000;
const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const HANDLE_PATTERN = /^[a-z0-9][a-z0-9-]{0,254}$/;
const FINGERPRINT_PATTERN = /^[0-9a-f]{1,16}$/;
const DAY_MS = 86_400_000;

export function isSafeHandle(value: unknown): value is string {
  return typeof value === 'string' && HANDLE_PATTERN.test(value);
}

export type SavedQuizResult = {
  readonly handle: string;
  readonly size: Size;
  readonly score: number;
  readonly reasons: readonly string[];
};

export type SavedQuiz = {
  /** Epoch milliseconds, from the injected clock when saved. */
  readonly savedAt: number;
  /** Fingerprint of the quiz configuration the answers were given against. */
  readonly configFingerprint: string | null;
  readonly answers: QuizAnswers;
  readonly results: readonly SavedQuizResult[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function sanitizeAnswers(raw: unknown): QuizAnswers | null {
  if (!isRecord(raw)) return null;
  const entries: [string, readonly string[]][] = [];
  for (const [questionId, optionIds] of Object.entries(raw)) {
    if (entries.length >= MAX_ANSWERED_QUESTIONS) break;
    if (!ID_PATTERN.test(questionId) || !Array.isArray(optionIds)) continue;
    const ids = optionIds
      .filter(
        (id): id is string => typeof id === 'string' && ID_PATTERN.test(id),
      )
      .slice(0, MAX_OPTIONS_PER_ANSWER);
    entries.push([questionId, [...new Set(ids)]]);
  }
  // fromEntries creates own properties, so a key like "constructor" is harmless.
  return Object.fromEntries(entries);
}

function sanitizeResult(raw: unknown): SavedQuizResult | null {
  if (!isRecord(raw)) return null;
  const {handle, size, score, reasons} = raw;
  if (typeof handle !== 'string' || !HANDLE_PATTERN.test(handle)) return null;
  if (!isSize(size)) return null;
  if (
    typeof score !== 'number' ||
    !Number.isInteger(score) ||
    Math.abs(score) > MAX_ABS_SCORE
  ) {
    return null;
  }
  const cleaned = (Array.isArray(reasons) ? reasons : [])
    .filter((reason): reason is string => typeof reason === 'string')
    .map(cleanText)
    .filter((reason) => reason !== '' && reason.length <= MAX_REASON_LENGTH)
    .slice(0, MAX_REASONS);
  return {handle, size, score, reasons: cleaned};
}

/** Returns a clean copy, or null when the value is not a saved quiz at all. */
export function sanitizeSavedQuiz(raw: unknown): SavedQuiz | null {
  if (!isRecord(raw)) return null;
  const {savedAt, configFingerprint, answers, results} = raw;
  if (
    typeof savedAt !== 'number' ||
    !Number.isSafeInteger(savedAt) ||
    savedAt < 0
  ) {
    return null;
  }
  const cleanAnswers = sanitizeAnswers(answers);
  if (!cleanAnswers) return null;
  const cleanResults = (Array.isArray(results) ? results : [])
    .map(sanitizeResult)
    .filter((result): result is SavedQuizResult => result !== null)
    .slice(0, MAX_RESULTS);
  return {
    savedAt,
    configFingerprint:
      typeof configFingerprint === 'string' &&
      FINGERPRINT_PATTERN.test(configFingerprint)
        ? configFingerprint
        : null,
    answers: cleanAnswers,
    results: cleanResults,
  };
}

/** Builds what gets saved from a scoring outcome. An empty outcome saves answers only. */
export function savedQuizFromOutcome(input: {
  readonly answers: QuizAnswers;
  readonly outcome: QuizOutcome;
  readonly nowMs: number;
  readonly configFingerprint: string | null;
}): SavedQuiz | null {
  return sanitizeSavedQuiz({
    savedAt: input.nowMs,
    configFingerprint: input.configFingerprint,
    answers: input.answers,
    results:
      input.outcome.status === 'ok'
        ? input.outcome.matches.map((match) => ({
            handle: match.handle,
            size: match.size,
            score: match.score,
            reasons: match.reasons,
          }))
        : [],
  });
}

export type SerializeOutcome =
  | {readonly status: 'ok'; readonly json: string}
  | {readonly status: 'error'; readonly reason: 'invalid' | 'too_large'};

/** The versioned JSON for device storage or the account metafield. */
export function serializeSavedQuiz(saved: SavedQuiz): SerializeOutcome {
  const clean = sanitizeSavedQuiz(saved);
  if (!clean) return {status: 'error', reason: 'invalid'};
  const json = JSON.stringify({v: QUIZ_STORAGE_VERSION, ...clean});
  if (byteLength(json) > QUIZ_STORAGE_MAX_BYTES) {
    return {status: 'error', reason: 'too_large'};
  }
  return {status: 'ok', json};
}

export type ParseOutcome =
  | {readonly status: 'ok'; readonly saved: SavedQuiz}
  | {readonly status: 'empty'}
  | {
      readonly status: 'invalid';
      readonly reason:
        'too_large' | 'corrupt' | 'unsupported_version' | 'bad_shape';
    };

/**
 * Reads a saved quiz from device storage text or from the account value (text,
 * or already-parsed JSON). Never throws.
 */
export function parseSavedQuiz(raw: unknown): ParseOutcome {
  if (raw === null || raw === undefined || raw === '') {
    return {status: 'empty'};
  }
  let value: unknown = raw;
  if (typeof raw === 'string') {
    // UTF-16 length never exceeds the byte length, so this rejects early and cheaply.
    if (
      raw.length > QUIZ_STORAGE_MAX_BYTES ||
      byteLength(raw) > QUIZ_STORAGE_MAX_BYTES
    ) {
      return {status: 'invalid', reason: 'too_large'};
    }
    try {
      value = JSON.parse(raw);
    } catch {
      return {status: 'invalid', reason: 'corrupt'};
    }
  }
  if (!isRecord(value)) return {status: 'invalid', reason: 'bad_shape'};
  if (value.v !== QUIZ_STORAGE_VERSION) {
    return {status: 'invalid', reason: 'unsupported_version'};
  }
  const saved = sanitizeSavedQuiz(value);
  return saved
    ? {status: 'ok', saved}
    : {status: 'invalid', reason: 'bad_shape'};
}

// --- Device storage ---

/** The part of the Web Storage interface used here; localStorage satisfies it. */
export type KeyValueStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export type DeviceSaveOutcome =
  | {readonly status: 'saved'}
  | {
      readonly status: 'error';
      readonly reason: 'invalid' | 'too_large' | 'storage_unavailable';
    };

export function saveQuizToDevice(
  storage: KeyValueStorage,
  saved: SavedQuiz,
): DeviceSaveOutcome {
  const serialized = serializeSavedQuiz(saved);
  if (serialized.status === 'error') return serialized;
  try {
    storage.setItem(QUIZ_STORAGE_KEY, serialized.json);
    return {status: 'saved'};
  } catch {
    // Private mode, disabled storage or a full quota: the quiz still works without saving.
    return {status: 'error', reason: 'storage_unavailable'};
  }
}

export type DeviceLoadOutcome =
  ParseOutcome | {readonly status: 'storage_unavailable'};

/** Reads the device copy. An unreadable entry is removed so it is not retried forever. */
export function loadQuizFromDevice(
  storage: KeyValueStorage,
): DeviceLoadOutcome {
  let raw: string | null;
  try {
    raw = storage.getItem(QUIZ_STORAGE_KEY);
  } catch {
    return {status: 'storage_unavailable'};
  }
  const parsed = parseSavedQuiz(raw);
  if (parsed.status === 'invalid') {
    try {
      storage.removeItem(QUIZ_STORAGE_KEY);
    } catch {
      // Best effort only.
    }
  }
  return parsed;
}

export function clearQuizFromDevice(
  storage: KeyValueStorage,
): {readonly status: 'cleared'} | {readonly status: 'storage_unavailable'} {
  try {
    storage.removeItem(QUIZ_STORAGE_KEY);
    return {status: 'cleared'};
  } catch {
    return {status: 'storage_unavailable'};
  }
}

// --- Device and account together ---

export type SignInMerge =
  | {readonly action: 'none'}
  | {readonly action: 'upload_device'; readonly saved: SavedQuiz}
  | {readonly action: 'use_account'; readonly saved: SavedQuiz};

/**
 * Decides what to do when a shopper signs in: the more recent copy wins, and the
 * account wins a tie so a second device sees what the first one saved.
 */
export function mergeOnSignIn(
  device: SavedQuiz | null,
  account: SavedQuiz | null,
): SignInMerge {
  if (device === null) {
    return account === null
      ? {action: 'none'}
      : {action: 'use_account', saved: account};
  }
  if (account === null) return {action: 'upload_device', saved: device};
  return device.savedAt > account.savedAt
    ? {action: 'upload_device', saved: device}
    : {action: 'use_account', saved: account};
}

export type Staleness = 'fresh' | 'expired' | 'config_changed';

/**
 * Whether saved results can be shown as they are. A changed quiz configuration
 * means the old answers may no longer mean the same thing, so the results are
 * recomputed from the stored answers instead of being shown.
 */
export function checkStaleness(
  saved: SavedQuiz,
  nowMs: number,
  currentFingerprint: string | null,
): Staleness {
  if (nowMs - saved.savedAt > QUIZ_STORAGE_MAX_AGE_DAYS * DAY_MS) {
    return 'expired';
  }
  if (
    saved.configFingerprint !== null &&
    currentFingerprint !== null &&
    saved.configFingerprint !== currentFingerprint
  ) {
    return 'config_changed';
  }
  return 'fresh';
}
