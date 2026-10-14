import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  MIN_COOKIE_SECRET_LENGTH,
  reportUnusableSecret,
  resetReportedSecrets,
  sessionSecretProblem,
  usableCookieSecret,
} from '~/lib/cookie-secret';

describe('usableCookieSecret (E-L1)', () => {
  it('accepts a secret of 32 characters or more', () => {
    expect(usableCookieSecret('x'.repeat(MIN_COOKIE_SECRET_LENGTH))).toBe(
      'x'.repeat(32),
    );
    expect(usableCookieSecret('y'.repeat(100))).not.toBeNull();
  });

  it.each([
    'x'.repeat(31),
    '',
    'short',
    undefined,
    null,
    42,
    {},
    ['x'.repeat(40)],
  ])('treats %j as no secret', (value) => {
    expect(usableCookieSecret(value)).toBeNull();
  });
});

// Missing configuration must not be silent: one value-free line per variable per isolate, production only.
describe('reportUnusableSecret', () => {
  afterEach(() => {
    resetReportedSecrets();
    vi.restoreAllMocks();
  });

  it('logs the variable name once in production and never twice', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    reportUnusableSecret('DELIVERY_COOKIE_SECRET', true);
    reportUnusableSecret('DELIVERY_COOKIE_SECRET', true);
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toContain('DELIVERY_COOKIE_SECRET');
    reportUnusableSecret('SESSION_SECRET', true);
    expect(error).toHaveBeenCalledTimes(2);
  });

  it('is silent outside production (local placeholder env files are short on purpose)', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    reportUnusableSecret('DELIVERY_COOKIE_SECRET', false);
    expect(error).not.toHaveBeenCalled();
  });
});

describe('sessionSecretProblem', () => {
  it.each([undefined, '', null, 7])(
    'says the secret is not set for %j',
    (v) => {
      expect(sessionSecretProblem(v, true)).toMatch(
        /SESSION_SECRET is not set/,
      );
      expect(sessionSecretProblem(v, false)).toMatch(
        /SESSION_SECRET is not set/,
      );
    },
  );

  it('demands the full length in production only, and names the variable not the value', () => {
    const short = 'local-dev-only-not-a-secret';
    const problem = sessionSecretProblem(short, true);
    expect(problem).toMatch(/SESSION_SECRET is shorter than 32 characters/);
    expect(problem).not.toContain(short);
    expect(sessionSecretProblem(short, false)).toBeNull();
    expect(sessionSecretProblem('x'.repeat(32), true)).toBeNull();
  });
});
