// TEST ONLY. Shared setup for the Extend integration tests: starts the local MOCK (scripts/mocks/extend-mock.mjs)
// on an ephemeral port and wires the library's real code (real fetch, real HTTP) to it. A pass here proves our code
// does what we think Extend's documentation says; it is not evidence of how Extend itself behaves (ADR-0009).
// Only the mock import below uses a relative path: the mock lives outside the app tree and has no alias.

import {readFileSync} from 'node:fs';
import {
  startMock,
  loadDefaultFixtures,
  type ExtendMock,
} from '../../../../scripts/mocks/extend-mock.mjs';
import {
  createCircuitBreaker,
  type CircuitBreaker,
} from '~/lib/extend/circuit-breaker';
import {parseExtendConfig, type ExtendConfigResult} from '~/lib/extend/config';
import type {ExtendLogEvent} from '~/lib/extend/log';
import {createOffersQuoteLookup} from '~/lib/extend/offers';
import {
  buildPricePointIndex,
  type PricePointVariant,
} from '~/lib/extend/price-points';
import type {SyncDeps} from '~/lib/extend/sync';
import type {FetchLike} from '~/lib/extend/types';

export const TOKEN = 'tok_fixture_integration_0001';
export const STORE_ID = 'store-integration-1';
export const ELIGIBLE_CATEGORIES = ['mattress', 'bedding'];

/** Real network I/O against the mock; the library only ever sees the narrow FetchLike. */
export const realFetch: FetchLike = (url, init) => fetch(url, init);

export function startTestMock(): Promise<ExtendMock> {
  return startMock({accessToken: TOKEN, storeId: STORE_ID});
}

export function configFor(
  mock: ExtendMock,
  overrides: Record<string, unknown> = {},
): ExtendConfigResult {
  return parseExtendConfig(
    {
      PUBLIC_EXTEND_ENABLED: 'true',
      EXTEND_API_HOST: mock.url,
      EXTEND_STORE_ID: STORE_ID,
      EXTEND_ACCESS_TOKEN: TOKEN,
      ...overrides,
    },
    {production: false},
  );
}

export type Clock = {t: number};

export type SyncHarness = {
  deps: SyncDeps;
  clock: Clock;
  sleeps: number[];
  logs: ExtendLogEvent[];
  breaker: CircuitBreaker;
};

/** Sync dependencies using real HTTP to the mock, an injected clock and a sleep that records instead of waiting. */
export function syncHarness(
  mock: ExtendMock,
  options: {
    env?: Record<string, unknown>;
    timeoutMs?: number;
    maxAttempts?: number;
  } = {},
): SyncHarness {
  const clock: Clock = {t: 0};
  const sleeps: number[] = [];
  const logs: ExtendLogEvent[] = [];
  const config = configFor(mock, options.env);
  const breaker = createCircuitBreaker({
    now: () => clock.t,
    failureThreshold: 3,
    openMs: 60_000,
  });
  const deps: SyncDeps = {
    config,
    fetch: realFetch,
    sleep: (ms) => {
      sleeps.push(ms);
      clock.t += ms;
      return Promise.resolve();
    },
    now: () => clock.t,
    lookupQuote: createOffersQuoteLookup({
      config,
      fetch: realFetch,
      eligibleCategories: ELIGIBLE_CATEGORIES,
    }),
    log: (event) => logs.push(event),
    random: () => 1,
    breaker,
    retry: {
      timeoutMs: options.timeoutMs ?? 2000,
      ...(options.maxAttempts === undefined
        ? {}
        : {maxAttempts: options.maxAttempts}),
    },
  };
  return {deps, clock, sleeps, logs, breaker};
}

/** The price-point variants the mock fixtures describe, as the catalog layer would return them. */
export function fixturePricePoints(): PricePointVariant[] {
  const file = new URL(
    '../../../../scripts/mocks/fixtures/extend/price-points.json',
    import.meta.url,
  );
  return readPricePoints(file);
}

function readPricePoints(file: URL): PricePointVariant[] {
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('variants' in parsed) ||
    !Array.isArray(parsed.variants)
  ) {
    throw new Error('price-points fixture is malformed');
  }
  return parsed.variants.map((entry: unknown): PricePointVariant => {
    if (
      typeof entry === 'object' &&
      entry !== null &&
      'variantId' in entry &&
      typeof entry.variantId === 'string' &&
      'name' in entry &&
      typeof entry.name === 'string' &&
      'priceCents' in entry &&
      typeof entry.priceCents === 'number'
    ) {
      return {
        variantId: entry.variantId,
        name: entry.name,
        priceCents: entry.priceCents,
      };
    }
    throw new Error('price-points fixture entry is malformed');
  });
}

export const fixturePricePointIndex = () =>
  buildPricePointIndex(fixturePricePoints());

export {loadDefaultFixtures};

/** PUT /orders requests the mock received, in order. */
export function putsTo(mock: ExtendMock) {
  return mock.state.requests.filter(
    (request) => request.method === 'PUT' && request.path === '/orders',
  );
}
