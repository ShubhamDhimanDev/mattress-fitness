// SERVER ONLY. Builds the reviews service from the request-context env (ADR-0004: never process.env). Shared state lives in
// module scope (per isolate or process, enough for a cost bound; NFR-006 has no database) and is created on first use, so
// importing this module has no side effect and a store with reviews off never builds anything.

import {pickEnv} from '~/lib/extend/env';
import {logEvent} from '~/lib/logging/logger';
import {
  parseReviewsConfig,
  type ReviewsConfigResult,
  type ReviewsEnv,
} from '~/lib/reviews/config';
import {createReviewsProvider} from '~/lib/reviews/registry';
import {createReviewsService, type ReviewsService} from '~/lib/reviews/service';

export const REVIEWS_ENV_KEYS = [
  'REVIEWS_PROVIDER',
  'JUDGEME_PRIVATE_API_TOKEN',
  'JUDGEME_SHOP_DOMAIN',
] as const;

export type ReviewsRuntime =
  | {readonly status: 'off'}
  | {readonly status: 'on'; readonly service: ReviewsService};

const OFF: ReviewsRuntime = {status: 'off'};

const warned = new Set<string>();
let cached:
  {readonly key: string; readonly runtime: ReviewsRuntime} | undefined;

/** Test hook. */
export function resetReviewsRuntimeForTests(): void {
  cached = undefined;
  warned.clear();
}

function stringsOf(env: object): ReviewsEnv {
  const picked = pickEnv(env, REVIEWS_ENV_KEYS);
  const read = (name: string): string | undefined => {
    const value = picked[name];
    return typeof value === 'string' ? value : undefined;
  };
  return {
    REVIEWS_PROVIDER: read('REVIEWS_PROVIDER'),
    JUDGEME_PRIVATE_API_TOKEN: read('JUDGEME_PRIVATE_API_TOKEN'),
    JUDGEME_SHOP_DOMAIN: read('JUDGEME_SHOP_DOMAIN'),
  };
}

function logFields(event: string, fields: Record<string, string | number>) {
  logEvent('warn', event, fields);
}

/** The configuration result alone (cheap, no provider is built); a refused-but-set provider is logged once by reason. */
export function reviewsConfigOf(
  env: object,
  development: boolean,
): ReviewsConfigResult {
  const result = parseReviewsConfig(stringsOf(env), {development});
  if (
    result.status === 'off' &&
    result.reason !== 'unset' &&
    !warned.has(result.reason)
  ) {
    warned.add(result.reason);
    logEvent('warn', 'reviews.config_refused', {reason: result.reason});
  }
  return result;
}

/** Whether reviews are on for this deployment. Synchronous and free: the page decides from it before anything is built. */
export function reviewsEnabled(env: object, development: boolean): boolean {
  return reviewsConfigOf(env, development).status === 'on';
}

export async function getReviewsRuntime(
  env: object,
  development: boolean,
): Promise<ReviewsRuntime> {
  const result = reviewsConfigOf(env, development);
  if (result.status === 'off') return OFF;
  const key =
    result.config.provider === 'judgeme'
      ? `judgeme:${result.config.shopDomain}`
      : 'fake';
  if (cached?.key === key) return cached.runtime;
  const provider = await createReviewsProvider(result.config, {
    fetch: (url, init) => fetch(url, init),
    log: logFields,
  });
  const runtime: ReviewsRuntime = provider
    ? {
        status: 'on',
        service: createReviewsService(provider, {log: logFields}),
      }
    : OFF;
  cached = {key, runtime};
  return runtime;
}
