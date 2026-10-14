// SERVER ONLY. Builds the real dependencies of the Extend server code from the request context (P5A-04, P5A-08).
// Routes and the cart-gate seam call this; everything it hands out is plain data and functions, so the logic modules
// stay pure and tested with fakes.
//
// Shared state (circuit breaker, offers memory, webhook coalescer, replay marks) lives in module scope: on Oxygen and on
// Node that is per isolate or process, which is enough for its purpose (stop hammering a failing provider, bound repeated
// work) and keeps NFR-006 (no database). It is created lazily so importing this module has no side effect.

import {parseExtendConfig, type ExtendConfigResult} from '~/lib/extend/config';
import {adminConfigFromEnv} from '~/lib/extend/admin-client';
import {
  createCircuitBreaker,
  type CircuitBreaker,
} from '~/lib/extend/circuit-breaker';
import {
  loadCoverageCatalog,
  type CatalogStorefront,
} from '~/lib/extend/coverage-catalog';
import {
  loadVariantFacts,
  type FactsStorefront,
} from '~/lib/extend/coverage-facts';
import {extendEnvOf, readEnvString} from '~/lib/extend/env';
import type {ExtendLogger} from '~/lib/extend/log';
import {
  answerOffers,
  type OffersRequestItem,
  type OffersResponseBody,
} from '~/lib/extend/offers-endpoint';
import {createOrderCoalescer} from '~/lib/extend/order-coalescer';
import {
  createOffersMemo,
  quoteCoverage,
  type OffersMemo,
} from '~/lib/extend/offers-service';
import {
  createReplayStore,
  type CacheStorageLike,
} from '~/lib/extend/replay-store';
import type {FetchLike, SleepFn} from '~/lib/extend/types';
import {processOrderAction} from '~/lib/extend/webhook-processor';
import {
  handleShopifyWebhook,
  type ProcessOutcome,
  type WebhookHandlerDeps,
} from '~/lib/extend/webhook-handler';
import type {OrderCoalescer} from '~/lib/extend/order-coalescer';
import type {WebhookReplayStore} from '~/lib/extend/webhook';

export const realFetch: FetchLike = (url, init) => fetch(url, init);
export const realSleep: SleepFn = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));
const realNow = () => Date.now();

/**
 * One JSON line per event, redacted by construction (the event type has no field for personal data or secrets, log.ts).
 * The project lint allows only `console.warn` and `console.error`, so informational events travel on `warn` with their
 * own `level` field intact.
 */
export const consoleLogger: ExtendLogger = (event) => {
  const line = JSON.stringify(event);
  if (event.level === 'error') console.error(line);
  else console.warn(line);
};

/**
 * The Workers Cache API where it exists, nothing elsewhere. This is the only platform global the Extend server code
 * touches (ADR-0004); it is passed down structurally, never imported from.
 */
export function platformCaches(): CacheStorageLike | undefined {
  return typeof caches === 'undefined' ? undefined : caches;
}

export type ExtendShared = {
  readonly breaker: CircuitBreaker;
  readonly offersMemo: OffersMemo;
  readonly coalescer: OrderCoalescer<ProcessOutcome>;
  readonly replay: WebhookReplayStore;
};

let shared: ExtendShared | undefined;

export function getExtendShared(): ExtendShared {
  shared ??= {
    breaker: createCircuitBreaker({now: realNow}),
    offersMemo: createOffersMemo({now: realNow}),
    coalescer: createOrderCoalescer<ProcessOutcome>({
      now: realNow,
      sleep: realSleep,
    }),
    replay: createReplayStore({now: realNow, storage: platformCaches()}),
  };
  return shared;
}

export type ExtendRuntimeInput = {
  /** The request-context env (ADR-0004). */
  readonly env: object;
  /** True for a production build: the loopback mock host is then refused (config.ts). */
  readonly production: boolean;
};

/** Offers need the UI flag. */
export function offersConfigOf(input: ExtendRuntimeInput): ExtendConfigResult {
  return parseExtendConfig(extendEnvOf(input.env), {
    production: input.production,
  });
}

/** Order sync keeps running after the flag hides the UI, so orders that already hold coverage still reach Extend. */
export function syncConfigOf(input: ExtendRuntimeInput): ExtendConfigResult {
  return parseExtendConfig(extendEnvOf(input.env), {
    requireFlag: false,
    production: input.production,
  });
}

export function webhookDepsFor(
  input: ExtendRuntimeInput & {
    waitUntil?: ((task: Promise<unknown>) => void) | undefined;
  },
  state: ExtendShared = getExtendShared(),
): WebhookHandlerDeps {
  const config = syncConfigOf(input);
  const admin = adminConfigFromEnv(input.env);
  return {
    secret: readEnvString(input.env, 'SHOPIFY_APP_CLIENT_SECRET'),
    replay: state.replay,
    coalescer: state.coalescer,
    process: (action) =>
      processOrderAction(action, {
        config,
        admin,
        fetch: realFetch,
        sleep: realSleep,
        now: realNow,
        log: consoleLogger,
        breaker: state.breaker,
      }),
    // Without waitUntil (Node, long-lived process) the promise simply runs on after the response is sent.
    schedule:
      input.waitUntil ??
      ((task) => {
        task.catch(() => {});
      }),
    now: realNow,
    log: consoleLogger,
  };
}

export function respondToShopifyWebhook(
  request: Request,
  input: Parameters<typeof webhookDepsFor>[0],
): Promise<Response> {
  return handleShopifyWebhook(request, webhookDepsFor(input));
}

/** The offers route: configuration, Shopify reads and the Extend call, composed for one request. */
export function answerOffersFor(
  items: readonly OffersRequestItem[],
  input: ExtendRuntimeInput & {storefront: CatalogStorefront & FactsStorefront},
  state: ExtendShared = getExtendShared(),
): Promise<OffersResponseBody> {
  const config = offersConfigOf(input);
  return answerOffers(items, {
    config,
    loadCatalog: () => loadCoverageCatalog(input.storefront),
    loadFacts: (variantIds) => loadVariantFacts(input.storefront, variantIds),
    quote: (covered, index) =>
      quoteCoverage(
        {
          config,
          fetch: realFetch,
          index,
          memo: state.offersMemo,
          breaker: state.breaker,
          log: consoleLogger,
        },
        covered,
      ),
    log: consoleLogger,
  });
}
