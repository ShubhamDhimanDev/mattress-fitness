// SERVER ONLY. The one Klaviyo call the signup makes (REQ-ANL-003, P7-02, NFR-013, T-10, T-13).
//
// Endpoint: POST https://a.klaviyo.com/api/profile-subscription-bulk-create-jobs ("Subscribe Profiles"), revision
// 2026-10-15, authenticated with a PRIVATE key. This is the endpoint Klaviyo documents for server-based applications;
// the browser endpoint (POST /client/subscriptions, public key) carries the warning "Do not use this endpoint from
// server-side applications", so it is not used here. Sources, dates and every unverified assumption:
// docs/integrations/KLAVIYO.md.
//
// Behaviour:
//   - the host is a constant and is checked against an allow-list before any request (a future edit cannot send the
//     private key to another host); redirects are refused;
//   - ONE attempt, a timeout, no retry: a shopper is waiting, Klaviyo says immediate retries after a 429 fail, and a
//     blind retry of a subscribe call could double-send a confirmation email;
//   - it returns a typed result and never throws; a failure is a reason code, never a message from Klaviyo, because an
//     error body can quote the email address (T-05);
//   - consent: the email (and, if the shopper ticked it, the phone) is sent as SUBSCRIBED with NO `consented_at` and
//     `historical_import: false`. Klaviyo documents `consented_at` as for historical imports only and says it raises an
//     error otherwise, so Klaviyo stamps the consent time itself;
//   - the key lives in a closure: it is not in the result, a log line or an error.

import type {FetchLike} from '~/lib/extend/types';

export const KLAVIYO_API_ORIGIN = 'https://a.klaviyo.com';
export const KLAVIYO_SUBSCRIBE_PATH =
  '/api/profile-subscription-bulk-create-jobs';
/** The revision the request shape was verified against (2026-10-25). Klaviyo supports a revision for about two years. */
export const KLAVIYO_REVISION = '2026-10-15';
/** The only hosts a request may go to. */
export const KLAVIYO_ALLOWED_HOSTS: readonly string[] = ['a.klaviyo.com'];
/** ASSUMPTION: Klaviyo documents no latency figure; 6 s matches the other server calls a shopper waits for. */
export const KLAVIYO_TIMEOUT_MS = 6000;

export type SubscribeRequest = {
  readonly email: string;
  /** E.164, only when the shopper ticked the SMS consent. */
  readonly phone: string | null;
  /** Free text Klaviyo stores as the consent record's `custom_method_detail`. No personal data. */
  readonly source: string;
};

export type SubscribeFailure =
  | 'timeout'
  | 'network'
  /** 401 or 403: the key is wrong or lacks a scope. A configuration fault, not the shopper's. */
  | 'auth'
  | 'rate_limited'
  /**
   * 400, 404, 405 or 415: the request itself is wrong, which is OUR configuration or code (a list id that does not exist,
   * a retired revision, an unsupported media type), never the shopper's address. Ops alert on it (review m5).
   */
  | 'config'
  /** Another 4xx (for example 409 or 422): Klaviyo refused this one request. */
  | 'rejected'
  | 'server'
  /** A 2xx other than the documented 202: not claimed as a success, shown as "try again later". */
  | 'unexpected_2xx'
  /** Any other status (1xx, 3xx). */
  | 'unexpected';

export type SubscribeResult =
  | {readonly status: 'accepted'}
  | {
      readonly status: 'failed';
      readonly reason: SubscribeFailure;
      /** The HTTP status Klaviyo answered with, when it answered. A number: safe to log, no personal data. */
      readonly httpStatus?: number;
    };

export type KlaviyoClient = {
  /** Never throws. */
  subscribe(request: SubscribeRequest): Promise<SubscribeResult>;
};

/** Whether a URL may receive the private key: https, an allow-listed host, no user-info, no unusual port. */
export function isAllowedKlaviyoUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' &&
      parsed.username === '' &&
      parsed.password === '' &&
      parsed.port === '' &&
      KLAVIYO_ALLOWED_HOSTS.includes(parsed.hostname)
    );
  } catch {
    return false;
  }
}

/** The JSON:API body for one profile. Pure, so the exact shape is unit-tested. */
export function buildSubscribeBody(
  request: SubscribeRequest,
  listId: string,
): unknown {
  return {
    data: {
      type: 'profile-subscription-bulk-create-job',
      attributes: {
        custom_source: request.source,
        historical_import: false,
        profiles: {
          data: [
            {
              type: 'profile',
              attributes: {
                email: request.email,
                ...(request.phone === null
                  ? {}
                  : {phone_number: request.phone}),
                subscriptions: {
                  email: {marketing: {consent: 'SUBSCRIBED'}},
                  ...(request.phone === null
                    ? {}
                    : {sms: {marketing: {consent: 'SUBSCRIBED'}}}),
                },
              },
            },
          ],
        },
      },
      relationships: {list: {data: {type: 'list', id: listId}}},
    },
  };
}

const CONFIG_STATUSES: ReadonlySet<number> = new Set([400, 404, 405, 415]);

function classify(status: number): SubscribeFailure | null {
  if (status === 202) return null;
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limited';
  if (CONFIG_STATUSES.has(status)) return 'config';
  if (status >= 400 && status < 500) return 'rejected';
  if (status >= 500) return 'server';
  if (status >= 200 && status < 300) return 'unexpected_2xx';
  return 'unexpected';
}

export function createKlaviyoClient(deps: {
  readonly apiKey: string;
  readonly listId: string;
  readonly fetch: FetchLike;
  readonly timeoutMs?: number;
}): KlaviyoClient {
  return {
    async subscribe(request) {
      const url = `${KLAVIYO_API_ORIGIN}${KLAVIYO_SUBSCRIBE_PATH}`;
      if (!isAllowedKlaviyoUrl(url)) {
        return {status: 'failed', reason: 'unexpected'};
      }
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        deps.timeoutMs ?? KLAVIYO_TIMEOUT_MS,
      );
      try {
        const response = await deps.fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Klaviyo-API-Key ${deps.apiKey}`,
            revision: KLAVIYO_REVISION,
            'Content-Type': 'application/vnd.api+json',
          },
          body: JSON.stringify(buildSubscribeBody(request, deps.listId)),
          signal: controller.signal,
          redirect: 'error',
        });
        // The body is never read: an error body can quote the address, and a 202 has none.
        await response.body?.cancel().catch(() => undefined);
        const failure = classify(response.status);
        return failure === null
          ? {status: 'accepted'}
          : {
              status: 'failed',
              reason: failure,
              httpStatus: response.status,
            };
      } catch {
        return {
          status: 'failed',
          reason: controller.signal.aborted ? 'timeout' : 'network',
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
