import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {fakeStorefront} from '../catalog/fake-storefront';
import {
  resetOfferConfigLogsForTests,
  revalidateCartOffers,
} from '~/lib/offers-runtime/server';
import {
  ENV,
  FakeCart,
  MATTRESS_LINE,
  OFFLINE_ENV,
  offerEnv,
  storefrontResponder,
} from '~/lib/offers-runtime/test-fixtures';

// RS-01 (REAL_STORE_FINDINGS): the offer configuration is judged on every cart, product and checkout request.
// A missing configuration used to log an error line each time (106 in one session). It is now logged once per
// isolate, and only as an error in production, where offers are then silently off. REQ-PRE-006.

async function judge(env: object, production: boolean) {
  const fake = new FakeCart([MATTRESS_LINE]);
  const {storefront} = fakeStorefront(storefrontResponder());
  await revalidateCartOffers(
    {storefront, cart: fake, env, production},
    fake.snapshot(),
  );
}

function lines(spy: {mock: {calls: unknown[][]}}): string[] {
  return spy.mock.calls.map((call) => String(call[0]));
}

describe('REQ-PRE-006 RS-01: configuration problems are logged once per isolate', () => {
  beforeEach(resetOfferConfigLogsForTests);
  afterEach(() => vi.restoreAllMocks());

  it('development with no Admin token logs one info line, never an error, however many requests', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (let request = 0; request < 5; request += 1) {
      await judge(OFFLINE_ENV, false);
    }
    expect(error).not.toHaveBeenCalled();
    const logged = lines(warn).filter((line) =>
      line.includes('offers.config_absent'),
    );
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('"level":"info"');
  });

  it('production with no Admin token logs one error line, not one per request', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (let request = 0; request < 5; request += 1) {
      await judge(OFFLINE_ENV, true);
    }
    const logged = lines(error).filter((line) =>
      line.includes('offers.config_problem'),
    );
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('"level":"error"');
  });

  it('a different problem is still logged (the once-only rule is per problem)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await judge(OFFLINE_ENV, true);
    await judge(offerEnv({}, 'invalid'), true);
    await judge(offerEnv({}, 'invalid'), true);
    expect(
      lines(error).filter((line) => line.includes('offers.config_problem')),
    ).toHaveLength(2);
  });

  it('development with a Shopify read failure is a warning, not an error', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await judge(offerEnv({}, 'invalid'), false);
    expect(error).not.toHaveBeenCalled();
    expect(lines(warn).join('\n')).toContain('offers.config_problem');
  });

  it('a valid configuration logs nothing', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await judge(ENV, true);
    expect(error).not.toHaveBeenCalled();
    expect(
      lines(warn).filter((line) => line.includes('offers.config')),
    ).toEqual([]);
  });

  it('the logged line carries the status and the reason code only, never the store domain', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const env = offerEnv({}, 'invalid');
    await judge(env, true);
    const text = lines(error).join('\n');
    expect(text).toContain('rules_http_500');
    expect(text).not.toContain('myshopify.com');
  });
});
