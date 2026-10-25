import {describe, expect, it} from 'vitest';
import {shouldRevalidate} from '~/root';

// REQ-ANL-003 / SU-L4: a signup post must not re-run the root loader (navigation, footer links, cart, delivery). Every
// other mutation keeps the template's behaviour.

type Args = Parameters<typeof shouldRevalidate>[0];

function args(overrides: Partial<Args>): Args {
  return {
    currentUrl: new URL('https://shop.example/'),
    nextUrl: new URL('https://shop.example/'),
    defaultShouldRevalidate: true,
    ...overrides,
  } as Args;
}

describe('root shouldRevalidate (SU-L4)', () => {
  it('does not revalidate for a POST to /signup, with or without a query', () => {
    expect(
      shouldRevalidate(args({formMethod: 'POST', formAction: '/signup'})),
    ).toBe(false);
    expect(
      shouldRevalidate(args({formMethod: 'POST', formAction: '/signup?x=1'})),
    ).toBe(false);
  });

  it('still revalidates for any other mutation (cart, login, delivery ZIP)', () => {
    for (const formAction of [
      '/cart',
      '/delivery',
      '/account/logout',
      '/signupx',
      '/track-order',
    ]) {
      expect(shouldRevalidate(args({formMethod: 'POST', formAction}))).toBe(
        true,
      );
    }
  });

  it('keeps the template rules: manual revalidation yes, plain navigation no', () => {
    expect(shouldRevalidate(args({}))).toBe(true);
    expect(
      shouldRevalidate(args({nextUrl: new URL('https://shop.example/cart')})),
    ).toBe(false);
  });
});
