import {describe, expect, it} from 'vitest';
import {
  appendSetCookie,
  describeError,
  finishResponse,
  type PendingSession,
} from '~/lib/server-safety';

// N-L4 / T-04 / T-05: cookies written by a route survive the session commit, and raw errors are not logged.

describe('appendSetCookie', () => {
  it('keeps the cookies a route already set and adds the session cookie', () => {
    const response = new Response(null);
    response.headers.append('Set-Cookie', 'cart=abc; Path=/; HttpOnly');
    response.headers.append('Set-Cookie', 'zip=60645; Path=/; HttpOnly');
    appendSetCookie(response, 'session=xyz; Path=/; HttpOnly');
    expect(response.headers.getSetCookie()).toEqual([
      'cart=abc; Path=/; HttpOnly',
      'zip=60645; Path=/; HttpOnly',
      'session=xyz; Path=/; HttpOnly',
    ]);
  });

  it('works on a response with no cookie yet', () => {
    const response = new Response(null);
    appendSetCookie(response, 'session=xyz');
    expect(response.headers.getSetCookie()).toEqual(['session=xyz']);
  });
});

describe('describeError', () => {
  it('names the class and never the message or cause', () => {
    const error = new Error(
      'query CartLines($id: ID!) variables {"id":"gid://shopify/Cart/c1?key=SECRET"}',
      {
        cause: {variables: {id: 'gid://shopify/Cart/c1?key=SECRET'}},
      },
    );
    const text = describeError(error);
    expect(text).toBe('Error');
    expect(text).not.toContain('SECRET');
  });

  it('handles custom classes and non-errors', () => {
    class StorefrontApiError extends Error {
      override name = 'StorefrontApiError';
    }
    expect(describeError(new StorefrontApiError('x'))).toBe(
      'StorefrontApiError',
    );
    expect(describeError('a string with a key=SECRET')).toBe(
      'non-error value thrown',
    );
    expect(describeError(undefined)).toBe('non-error value thrown');
  });
});

// K-L6 follow-up: the headers go on before the session cookie, so an immutable response with a pending session works.

describe('finishResponse', () => {
  const input = {requestUrl: 'https://shop.example.test/cart'};
  const pending = (isPending: boolean): PendingSession & {commits: number} => ({
    isPending,
    commits: 0,
    commit() {
      this.commits += 1;
      return Promise.resolve('session=xyz; Path=/; HttpOnly');
    },
  });

  it('puts the security headers and the session cookie on an immutable response (a redirect)', async () => {
    const redirect = Response.redirect('https://shop.example.test/', 302);
    // The precondition of the bug: the original cannot take a header, so appending the cookie to it would throw.
    expect(() => appendSetCookie(redirect, 'a=b')).toThrow(TypeError);

    const out = await finishResponse(redirect, pending(true), input);
    expect(out.status).toBe(302);
    expect(out.headers.get('Location')).toBe('https://shop.example.test/');
    expect(out.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(out.headers.get('Strict-Transport-Security')).toContain('max-age=');
    expect(out.headers.getSetCookie()).toEqual([
      'session=xyz; Path=/; HttpOnly',
    ]);
  });

  it('keeps the cookies a route already wrote on a copied response and appends the session cookie', async () => {
    const source = new Response('body', {status: 200});
    source.headers.append('Set-Cookie', 'cart=abc; Path=/');
    Object.defineProperty(source.headers, 'set', {
      value: () => {
        throw new TypeError('immutable');
      },
    });
    const out = await finishResponse(source, pending(true), input);
    expect(await out.text()).toBe('body');
    expect(out.headers.getSetCookie()).toEqual([
      'cart=abc; Path=/',
      'session=xyz; Path=/; HttpOnly',
    ]);
    expect(out.headers.get('X-Frame-Options')).toBe('DENY');
  });

  it('does not commit the session when nothing is pending, and still adds the headers', async () => {
    const session = pending(false);
    const out = await finishResponse(
      new Response(null, {status: 204}),
      session,
      input,
    );
    expect(session.commits).toBe(0);
    expect(out.headers.getSetCookie()).toEqual([]);
    expect(out.headers.get('Referrer-Policy')).toBe(
      'strict-origin-when-cross-origin',
    );
  });

  it('adds no HSTS on a plain-http localhost request', async () => {
    const out = await finishResponse(new Response(null), pending(false), {
      requestUrl: 'http://localhost:3000/',
    });
    expect(out.headers.get('Strict-Transport-Security')).toBeNull();
  });

  it('lets a failing commit reject, so the caller can answer with its one error response', async () => {
    const broken: PendingSession = {
      isPending: true,
      commit: () => Promise.reject(new Error('storage down')),
    };
    await expect(
      finishResponse(new Response(null), broken, input),
    ).rejects.toThrow('storage down');
  });
});
