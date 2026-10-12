// SERVER ONLY. One bounded HTTP call to the configured Extend host. It returns a typed result and never
// throws for expected failures (timeout, network error, non-2xx, unreadable body).

import type {ExtendConfig} from '~/lib/extend/config';
import type {FetchLike} from '~/lib/extend/types';

/** Offers and orders payloads are small; anything bigger is treated as a broken or hostile response. */
const MAX_RESPONSE_CHARS = 1_000_000;
const MAX_RETRY_AFTER_MS = 60_000;

export type CallFailureReason = 'timeout' | 'network' | 'http' | 'malformed';

export type CallResult =
  | {status: 'ok'; httpStatus: number; body: unknown}
  | {
      status: 'error';
      reason: CallFailureReason;
      httpStatus?: number;
      retryAfterMs?: number;
    };

export type CallRequest = {
  method: 'GET' | 'POST' | 'PUT';
  /** Only the two documented endpoints exist; a typo cannot reach an undocumented path. */
  path: '/offers' | '/orders';
  query?: Readonly<Record<string, string>>;
  body?: unknown;
  timeoutMs: number;
  /** Offers need a JSON body. For PUT /orders the body is undocumented, so it is parsed if possible and otherwise ignored. */
  expectJson: boolean;
};

type Exchange =
  {kind: 'done'; result: CallResult} | {kind: 'network'} | {kind: 'aborted'};

function parseRetryAfter(value: string | null): number | undefined {
  if (value === null || !/^\d{1,5}$/.test(value)) return undefined;
  return Math.min(Number(value) * 1000, MAX_RETRY_AFTER_MS);
}

function parseJson(text: string): {ok: true; value: unknown} | {ok: false} {
  try {
    return {ok: true, value: JSON.parse(text)};
  } catch {
    return {ok: false};
  }
}

async function readBody(response: Response): Promise<string | null> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_CHARS) return null;
  const text = await response.text();
  return text.length > MAX_RESPONSE_CHARS ? null : text;
}

async function release(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The connection is being discarded anyway.
  }
}

export async function callExtend(
  config: ExtendConfig,
  fetchFn: FetchLike,
  request: CallRequest,
): Promise<CallResult> {
  const url = new URL(request.path, config.apiHost);
  for (const [key, value] of Object.entries(request.query ?? {})) {
    url.searchParams.set(key, value);
  }
  // Defence in depth for outbound allow-listing: the host was validated when the config was parsed,
  // and nothing the caller passes can change it.
  if (url.origin !== config.apiHost)
    return {status: 'error', reason: 'network'};

  const hasBody = request.body !== undefined;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve('timeout');
    }, request.timeoutMs);
  });

  // The exchange handles its own errors, so a late rejection after the timeout wins the race is harmless.
  const exchange = (async (): Promise<Exchange> => {
    try {
      const response = await fetchFn(url.toString(), {
        method: request.method,
        headers: config.requestHeaders({json: hasBody}),
        ...(hasBody ? {body: JSON.stringify(request.body)} : {}),
        signal: controller.signal,
        redirect: 'error',
      });
      if (response.status < 200 || response.status > 299) {
        await release(response);
        const retryAfterMs = parseRetryAfter(
          response.headers.get('retry-after'),
        );
        return {
          kind: 'done',
          result: {
            status: 'error',
            reason: 'http',
            httpStatus: response.status,
            ...(retryAfterMs === undefined ? {} : {retryAfterMs}),
          },
        };
      }
      const text = await readBody(response);
      if (text === null) {
        return {
          kind: 'done',
          result: {status: 'error', reason: 'malformed'},
        };
      }
      const parsed = parseJson(text);
      if (!parsed.ok && request.expectJson) {
        return {
          kind: 'done',
          result: {status: 'error', reason: 'malformed'},
        };
      }
      return {
        kind: 'done',
        result: {
          status: 'ok',
          httpStatus: response.status,
          body: parsed.ok ? parsed.value : null,
        },
      };
    } catch {
      return controller.signal.aborted ? {kind: 'aborted'} : {kind: 'network'};
    }
  })();

  try {
    const outcome = await Promise.race([exchange, timedOut]);
    if (outcome === 'timeout' || outcome.kind === 'aborted') {
      return {status: 'error', reason: 'timeout'};
    }
    if (outcome.kind === 'network') {
      return {status: 'error', reason: 'network'};
    }
    return outcome.result;
  } finally {
    clearTimeout(timer);
  }
}
