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
  storefrontResponder,
} from '~/lib/offers-runtime/test-fixtures';

// RS-01 (REAL_STORE_FINDINGS): the offer configuration is judged on every cart, product and checkout request.
// A missing configuration used to log an error line each time (106 in one session). It is now logged once per
// isolate, and only as an error in production, where it pauses checkout. REQ-PRE-006.

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

  it('development with no configuration logs one info line, never an error, however many requests', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (let request = 0; request < 5; request += 1) {
      await judge({}, false);
    }
    expect(error).not.toHaveBeenCalled();
    const logged = lines(warn).filter((line) =>
      line.includes('offers.config_absent'),
    );
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('"level":"info"');
  });

  it('production with no configuration logs one error line, not one per request', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (let request = 0; request < 5; request += 1) {
      await judge({}, true);
    }
    const logged = lines(error).filter((line) =>
      line.includes('offers.config_problem'),
    );
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('"level":"error"');
  });

  it('a different problem is still logged (the once-only rule is per problem)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await judge({}, true);
    await judge({OFFER_CONFIG_JSON: '{nope'}, true);
    await judge({OFFER_CONFIG_JSON: '{nope'}, true);
    expect(
      lines(error).filter((line) => line.includes('offers.config_problem')),
    ).toHaveLength(2);
  });

  it('development with an unreadable configuration is a warning, not an error', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await judge({OFFER_CONFIG_JSON: '{nope'}, false);
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

  it('the logged line carries the status only, never the configuration text', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await judge({OFFER_CONFIG_JSON: '{secret-looking-text'}, true);
    expect(lines(error).join('\n')).not.toContain('secret-looking-text');
  });
});
