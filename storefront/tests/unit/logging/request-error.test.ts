import {afterEach, describe, expect, it, vi} from 'vitest';
import {handleError} from '~/entry.server';
import {logRequestError} from '~/lib/logging/request-error';

// T-05 / security re-review RR-M1: errors React Router handles are logged by class name and path only, never with the
// message, the cause (a Storefront call's query and variables), or the query string.

const CART =
  'gid://shopify/Cart/c1-ABCDEF123456?key=0123456789abcdef0123456789abcdef';
const EMAIL = 'shopper@example.com';

class StorefrontError extends Error {
  constructor() {
    super(`Cart ${CART} for ${EMAIL} could not be loaded`, {
      cause: {
        query: 'query Cart($id: ID!) { cart(id: $id) { id } }',
        variables: {id: CART, term: EMAIL},
      },
    });
    this.name = 'StorefrontError';
  }
}

function spies() {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const everything = () =>
    [error, warn, log]
      .flatMap((spy) => spy.mock.calls.map((c) => String(c.join(' '))))
      .join('\n');
  return {error, everything};
}

afterEach(() => vi.restoreAllMocks());

describe('handleError', () => {
  it('is exported by the server entry, so React Router no longer prints errors with console.error', () => {
    expect(typeof handleError).toBe('function');
  });

  it('logs the class name and the path, and nothing from the message, cause or query string', () => {
    const {error, everything} = spies();
    const request = new Request(
      `https://shop.example/search?q=${encodeURIComponent(EMAIL)}&cart=${encodeURIComponent(CART)}`,
    );
    handleError(new StorefrontError(), {request});
    expect(error).toHaveBeenCalledTimes(1);
    const output = everything();
    for (const secret of [
      CART,
      EMAIL,
      'cart(id',
      '0123456789abcdef',
      'q=',
      'cart=',
      'could not be loaded',
    ]) {
      expect(output, secret).not.toContain(secret);
    }
    const line: unknown = JSON.parse(String(error.mock.calls[0]?.[0]));
    expect(line).toMatchObject({
      level: 'error',
      event: 'request.failed',
      errorName: 'StorefrontError',
      path: '/search',
    });
  });

  it('logs a thrown non-error value without printing it', () => {
    const {error, everything} = spies();
    logRequestError(
      `${EMAIL} ${CART}`,
      new Request('https://shop.example/cart'),
    );
    expect(everything()).not.toContain(EMAIL);
    expect(String(error.mock.calls[0]?.[0])).toContain(
      'non-error value thrown',
    );
  });

  it('does not log a request the visitor abandoned', () => {
    const {error, everything} = spies();
    const controller = new AbortController();
    controller.abort();
    handleError(new StorefrontError(), {
      request: new Request('https://shop.example/pages/faq', {
        signal: controller.signal,
      }),
    });
    expect(error).not.toHaveBeenCalled();
    expect(everything()).toBe('');
  });

  it('never throws, even for an unreadable request URL', () => {
    spies();
    const odd = {
      url: 'not a url',
      signal: {aborted: false},
    } as unknown as Request;
    expect(() => logRequestError(new Error('x'), odd)).not.toThrow();
  });
});
