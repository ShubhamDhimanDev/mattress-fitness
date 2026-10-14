import {describe, expect, it} from 'vitest';
import {
  MIN_COOKIE_SECRET_LENGTH,
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
