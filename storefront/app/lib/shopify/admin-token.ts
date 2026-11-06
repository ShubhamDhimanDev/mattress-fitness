// SERVER ONLY. Fetches and refreshes an Admin API access token from a Dev Dashboard app's client id and secret (the
// "client credentials grant"), so the server needs no hand-copied token. Shopify no longer creates permanent tokens for
// new apps; this token lives about 24 hours (`expires_in`), so it is cached in memory and renewed before it runs out.
// Same exchange as scripts/setup/with-admin-token.sh (docs/deployment/LOCAL_DEV_WALKTHROUGH.md section 3).
//
// Safety: the host is only `<shop>.myshopify.com` over https (checked by the caller's domain pattern), redirects are
// refused, the call has a timeout and a size cap, and the secret and the token live in closures and module memory only:
// never in a log, an error or a response. Failures return a reason code; they do not throw.
//
// UNVERIFIED against the client's store: needs a run on the development store (see docs/integrations/NEWSLETTER_SHOPIFY.md).
// The token carries ALL scopes the app was granted, so use an app that has only the scopes the server needs.

import {readCappedBody} from '~/lib/extend/capped-body';
import {readEnvString} from '~/lib/extend/env';
import type {FetchLike} from '~/lib/extend/types';

export const CLIENT_ID_ENV = 'ADMIN_CLIENT_ID';
export const CLIENT_SECRET_ENV = 'ADMIN_CLIENT_SECRET';

const TIMEOUT_MS = 6000;
const MAX_RESPONSE_BYTES = 20_000;
/** Renew this long before Shopify says the token ends, so a request never starts with a token about to expire. */
const RENEW_EARLY_MS = 5 * 60 * 1000;
/** Used when the answer has no usable `expires_in`: shorter than the 24 hours Shopify documents. */
const FALLBACK_LIFETIME_MS = 60 * 60 * 1000;
const TOKEN = /^[\x21-\x7E]{8,512}$/;
const CLIENT_VALUE = /^[\x21-\x7E]{1,256}$/;

export type TokenFailure =
  'auth' | 'rate_limited' | 'server' | 'network' | 'timeout' | 'unexpected';

export type TokenResult =
  | {readonly status: 'ok'; readonly token: string}
  | {readonly status: 'failed'; readonly reason: TokenFailure};

export type AdminTokenProvider = {
  /** A valid token: the cached one, or a fresh one. Concurrent callers share one request. */
  readonly get: () => Promise<TokenResult>;
  /** Forget the cached token (after Shopify answered 401 with it), so the next `get` asks for a new one. */
  readonly invalidate: () => void;
};

export type ClientCredentials = {
  readonly clientId: string;
  readonly clientSecret: string;
};

/** Both values or null: a half-set pair means "not configured", never a guess. */
export function readClientCredentials(env: object): ClientCredentials | null {
  const clientId = readEnvString(env, CLIENT_ID_ENV);
  const clientSecret = readEnvString(env, CLIENT_SECRET_ENV);
  if (
    clientId === null ||
    clientSecret === null ||
    !CLIENT_VALUE.test(clientId) ||
    !CLIENT_VALUE.test(clientSecret)
  ) {
    return null;
  }
  return {clientId, clientSecret};
}

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null
    ? Reflect.get(value, key)
    : undefined;
}

export function createAdminTokenProvider(options: {
  /** A validated `<shop>.myshopify.com` domain. */
  readonly store: string;
  readonly credentials: ClientCredentials;
  readonly fetch?: FetchLike;
  readonly now?: () => number;
}): AdminTokenProvider {
  const fetchFn: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  const now = options.now ?? (() => Date.now());
  const endpoint = `https://${options.store}/admin/oauth/access_token`;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: options.credentials.clientId,
    client_secret: options.credentials.clientSecret,
  }).toString();

  let cached: {readonly token: string; readonly renewAt: number} | null = null;
  let inFlight: Promise<TokenResult> | null = null;

  async function request(): Promise<TokenResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetchFn(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body,
        signal: controller.signal,
        redirect: 'error',
      });
      if (response.status === 429) {
        await response.body?.cancel();
        return {status: 'failed', reason: 'rate_limited'};
      }
      if (response.status >= 400 && response.status < 500) {
        // Wrong id or secret, app not installed on this store, or the store is in another organisation.
        await response.body?.cancel();
        return {status: 'failed', reason: 'auth'};
      }
      if (response.status < 200 || response.status > 299) {
        await response.body?.cancel();
        return {status: 'failed', reason: 'server'};
      }
      const read = await readCappedBody(response, MAX_RESPONSE_BYTES);
      if (read.status !== 'ok') return {status: 'failed', reason: 'unexpected'};
      const parsed: unknown = JSON.parse(new TextDecoder().decode(read.bytes));
      const token = field(parsed, 'access_token');
      if (typeof token !== 'string' || !TOKEN.test(token)) {
        return {status: 'failed', reason: 'unexpected'};
      }
      const seconds = field(parsed, 'expires_in');
      const lifetime =
        typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0
          ? seconds * 1000
          : FALLBACK_LIFETIME_MS;
      cached = {
        token,
        renewAt: now() + Math.max(0, lifetime - RENEW_EARLY_MS),
      };
      return {status: 'ok', token};
    } catch {
      return {
        status: 'failed',
        reason: controller.signal.aborted ? 'timeout' : 'network',
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async get() {
      if (cached !== null && now() < cached.renewAt) {
        return {status: 'ok', token: cached.token};
      }
      inFlight ??= request().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
    invalidate() {
      cached = null;
    },
  };
}

// One provider per store and app for the life of the server process, so every request shares one cached token instead of
// asking Shopify for a new one each time. Keyed by id and store only; the secret is never part of a key.
const providers = new Map<string, AdminTokenProvider>();

export function sharedAdminTokenProvider(
  store: string,
  credentials: ClientCredentials,
  fetchFn?: FetchLike,
): AdminTokenProvider {
  const key = `${store}|${credentials.clientId}`;
  let provider = providers.get(key);
  if (provider === undefined) {
    provider = createAdminTokenProvider({
      store,
      credentials,
      ...(fetchFn === undefined ? {} : {fetch: fetchFn}),
    });
    providers.set(key, provider);
  }
  return provider;
}

/** Test-only reset of the shared cache. Not used by the app. */
export function resetAdminTokenProvidersForTests(): void {
  providers.clear();
}
