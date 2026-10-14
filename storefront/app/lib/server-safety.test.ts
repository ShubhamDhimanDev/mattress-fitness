import {describe, expect, it} from 'vitest';
import {appendSetCookie, describeError} from '~/lib/server-safety';

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
