import {describe, expect, it, vi} from 'vitest';
import {loader as loginLoader} from '~/routes/account_.login';
import {loader as authorizeLoader} from '~/routes/account_.authorize';
import {
  cleanLoginUrl,
  isSameOriginLocation,
  withSameOriginRedirect,
} from '~/lib/account/results';

// S-M1 (T-08, T-11): Hydrogen stores `return_to`, else the Referer, at sign-in and redirects there from the
// callback without a same-origin check. Two layers: the login route never lets a foreign target reach Hydrogen,
// and the callback replaces a foreign Location with /account, keeping the status and the session cookie.

// Written with a code point so no layer between this file and the test can read the backslash as an escape.
const BACKSLASH_EVIL = `/${String.fromCharCode(92)}evil.example`;
const ORIGIN = 'http://localhost:3000';

function redirectTo(location: string) {
  const response = new Response(null, {status: 302});
  response.headers.set('Location', location);
  response.headers.append('Set-Cookie', 'session=1; HttpOnly');
  response.headers.append('Set-Cookie', 'other=2; Secure');
  return response;
}

function fakeAccount(location = 'https://shopify.example/login') {
  return {
    login: vi.fn(async () => redirectTo(location)),
    authorize: vi.fn(async () => redirectTo(location)),
  };
}

function args(
  request: Request,
  customerAccount: ReturnType<typeof fakeAccount>,
) {
  return {
    request,
    params: {},
    context: {
      customerAccount,
      storefront: {i18n: {country: 'US', language: 'EN'}},
    },
  } as never;
}

const FOREIGN_TARGETS = [
  'https://evil.example',
  '//evil.example',
  BACKSLASH_EVIL,
  '/\t/evil.example',
  'javascript:alert(1)',
  'http://localhost:3000.evil.example/',
  'data:text/html,x',
];

describe('authorize callback keeps the redirect on this site', () => {
  it.each(FOREIGN_TARGETS)(
    'replaces a Location of %j with /account and keeps status and cookies',
    async (location) => {
      const account = fakeAccount(location);
      const response = await authorizeLoader(
        args(
          new Request(`${ORIGIN}/account/authorize?code=c&state=s`),
          account,
        ),
      );
      expect(response.status).toBe(302);
      expect(response.headers.get('Location')).toBe('/account');
      expect(response.headers.getSetCookie()).toEqual([
        'session=1; HttpOnly',
        'other=2; Secure',
      ]);
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    },
  );

  it.each(['/account', '/products/x?size=queen', `${ORIGIN}/collections/a`])(
    'leaves the same-origin Location %j alone',
    async (location) => {
      const response = await authorizeLoader(
        args(new Request(`${ORIGIN}/account/authorize`), fakeAccount(location)),
      );
      expect(response.headers.get('Location')).toBe(location);
      expect(response.headers.getSetCookie()).toHaveLength(2);
    },
  );

  it('keeps a Location-less response unchanged', () => {
    const response = new Response('x', {status: 200});
    expect(withSameOriginRedirect(response, `${ORIGIN}/a`)).toBe(response);
  });

  it('compares against the request origin, so another port or scheme is foreign', () => {
    expect(isSameOriginLocation('http://localhost:3001/', `${ORIGIN}/a`)).toBe(
      false,
    );
    expect(isSameOriginLocation('https://localhost:3000/', `${ORIGIN}/a`)).toBe(
      false,
    );
    expect(isSameOriginLocation('/x', `${ORIGIN}/a`)).toBe(true);
    expect(isSameOriginLocation('', `${ORIGIN}/a`)).toBe(false);
  });
});

describe('login route never hands a foreign target to Hydrogen', () => {
  it('redirects a cross-origin Referer to the login with return_to=/account', async () => {
    const account = fakeAccount();
    const response = await loginLoader(
      args(
        new Request(`${ORIGIN}/account/login`, {
          headers: {Referer: 'https://evil.example/'},
        }),
        account,
      ),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe(
      '/account/login?return_to=%2Faccount',
    );
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(account.login).not.toHaveBeenCalled();
  });

  it.each([
    '//evil.example',
    BACKSLASH_EVIL,
    'https://evil.example',
    'javascript:alert(1)',
  ])(
    'replaces return_to=%j with /account before Hydrogen sees it',
    async (target) => {
      const account = fakeAccount();
      const response = await loginLoader(
        args(
          new Request(
            `${ORIGIN}/account/login?return_to=${encodeURIComponent(target)}&locale=en`,
          ),
          account,
        ),
      );
      expect(response.status).toBe(302);
      const location = new URL(response.headers.get('Location') ?? '', ORIGIN);
      expect(location.pathname).toBe('/account/login');
      expect(location.searchParams.get('return_to')).toBe('/account');
      expect(location.searchParams.get('locale')).toBe('en');
      expect(account.login).not.toHaveBeenCalled();
    },
  );

  it('also cleans the redirect parameter Hydrogen reads', () => {
    const cleaned = cleanLoginUrl(
      new Request(`${ORIGIN}/account/login?redirect=//evil.example`),
    );
    expect(cleaned?.searchParams.get('return_to')).toBe('/account');
    expect(cleaned?.searchParams.has('redirect')).toBe(false);
  });

  it('lets a safe path or a same-origin Referer through to Hydrogen', async () => {
    const account = fakeAccount();
    const withPath = await loginLoader(
      args(
        new Request(`${ORIGIN}/account/login?return_to=/products/x%3Fsize%3Dq`),
        account,
      ),
    );
    expect(withPath.headers.get('Location')).toBe(
      'https://shopify.example/login',
    );
    const withReferer = await loginLoader(
      args(
        new Request(`${ORIGIN}/account/login`, {
          headers: {Referer: `${ORIGIN}/products/x`},
        }),
        account,
      ),
    );
    expect(withReferer.headers.get('Location')).toBe(
      'https://shopify.example/login',
    );
    expect(account.login).toHaveBeenCalledTimes(2);
  });

  it('ignores a foreign Referer when a safe return_to is given (Hydrogen prefers return_to)', async () => {
    const account = fakeAccount();
    await loginLoader(
      args(
        new Request(`${ORIGIN}/account/login?return_to=/account/orders`, {
          headers: {Referer: 'https://evil.example/'},
        }),
        account,
      ),
    );
    expect(account.login).toHaveBeenCalledTimes(1);
  });
});
