import {afterEach, describe, expect, it, vi} from 'vitest';
import {resetReportedSecrets} from '~/lib/cookie-secret';
import {deliveryViewForEnv} from '~/lib/delivery-runtime/view';
import {ENV as OFFER_ENV} from '~/lib/offers-runtime/test-fixtures';

// P3B-11 (a): with the delivery secret unusable in production no yes or no may be shown, whatever ZIP arrives.

const SECRET = 'unit-test-delivery-secret-0123456789-not-real';
const ENV = {...OFFER_ENV, DELIVERY_COOKIE_SECRET: SECRET};

afterEach(() => {
  resetReportedSecrets();
  vi.restoreAllMocks();
});

describe('deliveryViewForEnv', () => {
  it('answers as the zone says when the secret is usable', () => {
    expect(deliveryViewForEnv(ENV, '60645', true)).toMatchObject({
      status: 'in-zone',
    });
    expect(deliveryViewForEnv(ENV, '90210', true)).toMatchObject({
      status: 'outside-zone',
    });
    expect(deliveryViewForEnv(ENV, null, true)).toEqual({status: 'no-zip'});
  });

  it.each([
    ['missing', OFFER_ENV],
    ['short', {...OFFER_ENV, DELIVERY_COOKIE_SECRET: 'x'.repeat(31)}],
    ['the wrong type', {...OFFER_ENV, DELIVERY_COOKIE_SECRET: 12345}],
  ])(
    'is service-unavailable in production when the secret is %s, even for a ZIP in the zone',
    (_label, env) => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(deliveryViewForEnv(env, '60645', true)).toEqual({
        status: 'service-unavailable',
      });
      expect(deliveryViewForEnv(env, null, true)).toEqual({
        status: 'service-unavailable',
      });
    },
  );

  it('logs the variable name once, never a value or the ZIP', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const env = {...OFFER_ENV, DELIVERY_COOKIE_SECRET: 'short-secret-value'};
    for (let i = 0; i < 3; i += 1) deliveryViewForEnv(env, '60645', true);
    expect(error).toHaveBeenCalledTimes(1);
    const line = String(error.mock.calls[0][0]);
    expect(line).toContain('DELIVERY_COOKIE_SECRET');
    expect(line).not.toContain('short-secret-value');
    expect(line).not.toContain('60645');
  });

  it('keeps the normal answer in development without a secret (the mock stores stay usable)', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(deliveryViewForEnv(OFFER_ENV, null, false)).toEqual({
      status: 'no-zip',
    });
    expect(error).not.toHaveBeenCalled();
  });
});
