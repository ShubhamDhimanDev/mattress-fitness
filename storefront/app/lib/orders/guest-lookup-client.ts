// SERVER ONLY. The Admin API read behind guest order tracking (REQ-ACC-003, P6-08, threat T-09, V-09, V-20).
//
// `GuestOrderAdminClient` is the seam the handler depends on: tests use a typed fake, production uses the
// fetch-based client below. UNVERIFIED against a real store until a development store and a read_orders-only token
// exist (V-20): the query, the `name:` search and the fields' availability are written from the documentation only.
//
// The fetch client reuses the Extend sync's configuration check (`adminConfigFromEnv`): the host is always
// `<shop>.myshopify.com` from PUBLIC_STORE_DOMAIN (never from a request), the token lives in a closure and is
// never in a log or an error, redirects are refused, the call has a timeout and the body a size cap. One attempt,
// no retry: a shopper is waiting, and every failure already looks the same to them.

import type {AdminConfigResult} from '~/lib/extend/admin-client';
import {readCappedBody} from '~/lib/extend/capped-body';
import type {FetchLike} from '~/lib/extend/types';
import {
  parseGuestOrderResponse,
  type GuestOrderCandidate,
  type GuestOrderLookupRequest,
} from '~/lib/orders/guest-lookup';

export type GuestOrderLookupFailure =
  | 'not_configured'
  | 'auth'
  | 'throttled'
  | 'timeout'
  | 'network'
  | 'http'
  | 'malformed'
  | 'graphql';

export type GuestOrderLookupResult =
  | {
      readonly status: 'ok';
      readonly candidates: readonly GuestOrderCandidate[];
    }
  | {readonly status: 'error'; readonly reason: GuestOrderLookupFailure};

export type GuestOrderAdminClient = {
  /** Runs the constant lookup query with the already validated variables. Never throws. */
  lookup(request: GuestOrderLookupRequest): Promise<GuestOrderLookupResult>;
};

const MAX_RESPONSE_BYTES = 500_000;
export const GUEST_LOOKUP_UPSTREAM_TIMEOUT_MS = 6000;

export function createAdminGuestOrderClient(deps: {
  readonly admin: Extract<AdminConfigResult, {status: 'ready'}>;
  readonly fetch: FetchLike;
  readonly timeoutMs?: number;
}): GuestOrderAdminClient {
  const {admin} = deps;
  return {
    async lookup(request) {
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        deps.timeoutMs ?? GUEST_LOOKUP_UPSTREAM_TIMEOUT_MS,
      );
      try {
        const response = await deps.fetch(
          `https://${admin.store}/admin/api/${admin.apiVersion}/graphql.json`,
          {
            method: 'POST',
            headers: admin.headers(),
            body: JSON.stringify({
              query: request.query,
              variables: request.variables,
              operationName: request.operationName,
            }),
            signal: controller.signal,
            redirect: 'error',
          },
        );
        if (response.status === 401 || response.status === 403) {
          await response.body?.cancel();
          return {status: 'error', reason: 'auth'};
        }
        if (response.status === 429) {
          await response.body?.cancel();
          return {status: 'error', reason: 'throttled'};
        }
        if (response.status < 200 || response.status > 299) {
          await response.body?.cancel();
          return {status: 'error', reason: 'http'};
        }
        const read = await readCappedBody(response, MAX_RESPONSE_BYTES);
        if (read.status !== 'ok') return {status: 'error', reason: 'malformed'};
        let json: unknown;
        try {
          json = JSON.parse(new TextDecoder().decode(read.bytes));
        } catch {
          return {status: 'error', reason: 'malformed'};
        }
        const parsed = parseGuestOrderResponse(json);
        return parsed.status === 'ok'
          ? {status: 'ok', candidates: parsed.candidates}
          : {status: 'error', reason: 'graphql'};
      } catch {
        return {
          status: 'error',
          reason: controller.signal.aborted ? 'timeout' : 'network',
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
