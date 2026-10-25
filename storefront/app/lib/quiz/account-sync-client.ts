// Browser side of the quiz account sync (REQ-QZ-005, P6-04): plain `fetch` calls to /account/quiz-sync that
// never throw. A plain fetch rather than a router fetcher so a save does not make the router reload every
// loader on the quiz page. Every failure resolves to a status and the quiz carries on with the device copy.

import {
  SYNC_ENDPOINT,
  accountSummaryToSavedQuiz,
  buildSyncPayload,
  parseAccountSummary,
} from '~/lib/quiz/account-sync';
import type {SavedQuiz} from '~/lib/quiz/storage';

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Pick<Response, 'ok' | 'json'>>;

const REQUEST_TIMEOUT_MS = 8000;

export type AccountFetchResult =
  | {readonly status: 'ok'; readonly saved: SavedQuiz | null}
  | {readonly status: 'signed_out'}
  | {readonly status: 'unavailable'};

export type AccountPushResult =
  | {readonly status: 'done'}
  | {readonly status: 'signed_out'}
  | {readonly status: 'unavailable'};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function request(
  fetchFn: FetchLike,
  init: RequestInit,
): Promise<{ok: boolean; body: unknown} | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchFn(SYNC_ENDPOINT, {
      ...init,
      credentials: 'same-origin',
      signal: controller.signal,
    });
    const body: unknown = await response.json().catch(() => null);
    return {ok: response.ok, body};
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function statusOf(body: unknown): string | null {
  return isRecord(body) && typeof body.status === 'string' ? body.status : null;
}

/** Whether the signed-in shopper has a saved result in their account, read as a device-format saved quiz. */
export async function fetchAccountQuiz(
  nowMs: number,
  fetchFn: FetchLike = fetch,
): Promise<AccountFetchResult> {
  const result = await request(fetchFn, {method: 'GET'});
  if (!result) return {status: 'unavailable'};
  const status = statusOf(result.body);
  if (status === 'signed_out') return {status: 'signed_out'};
  if (!result.ok || status !== 'ok' || !isRecord(result.body)) {
    return {status: 'unavailable'};
  }
  const parsed = parseAccountSummary(result.body.saved);
  return {
    status: 'ok',
    saved:
      parsed.status === 'ok'
        ? accountSummaryToSavedQuiz(parsed.summary, nowMs)
        : null,
  };
}

function pushOutcome(
  result: {ok: boolean; body: unknown} | null,
  done: string,
): AccountPushResult {
  if (!result) return {status: 'unavailable'};
  const status = statusOf(result.body);
  if (result.ok && status === done) return {status: 'done'};
  if (isRecord(result.body) && result.body.code === 'signed-out') {
    return {status: 'signed_out'};
  }
  return {status: 'unavailable'};
}

/** Saves this result to the account (the server re-checks the answers and recomputes the handles). */
export async function pushAccountQuiz(
  saved: SavedQuiz,
  fetchFn: FetchLike = fetch,
): Promise<AccountPushResult> {
  const result = await request(fetchFn, {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({payload: buildSyncPayload(saved)}).toString(),
  });
  return pushOutcome(result, 'saved');
}

export async function clearAccountQuiz(
  fetchFn: FetchLike = fetch,
): Promise<AccountPushResult> {
  const result = await request(fetchFn, {method: 'DELETE'});
  return pushOutcome(result, 'cleared');
}
