import {describe, expect, it} from 'vitest';
import {formatLogEvent} from '~/lib/logging/logger';
import {pathOf, requestLogFields} from '~/lib/logging/request-context';

// T-05: the path and request id of a logged failure carry no query string and no client-controlled free text.

const at = (url: string, headers: Record<string, string> = {}) =>
  new Request(url, {headers});

describe('pathOf', () => {
  it('keeps the path and drops the query string and fragment', () => {
    expect(
      pathOf(at('https://shop.test/cart?key=SECRET&q=jane+doe&zip=90210#x')),
    ).toBe('/cart');
    expect(pathOf(at('https://shop.test/checkout-steps?step=delivery'))).toBe(
      '/checkout-steps',
    );
  });

  it('cuts a very long path', () => {
    expect(
      pathOf(at(`https://shop.test/${'a'.repeat(5_000)}`)).length,
    ).toBeLessThanOrEqual(100);
  });

  it('answers with a marker for a request whose URL cannot be parsed', () => {
    expect(pathOf({url: 'not a url'} as unknown as Request)).toBe(
      '[invalid-url]',
    );
  });
});

describe('requestLogFields', () => {
  it('uses the host request id when it is a plain token', () => {
    expect(
      requestLogFields(
        at('https://shop.test/cart', {'x-request-id': 'req-1234abcd'}),
      ),
    ).toEqual({path: '/cart', requestId: 'req-1234abcd'});
    expect(
      requestLogFields(
        at('https://shop.test/cart', {'cf-ray': '8a1b2c3d4e5f6a7b-IAD'}),
      ).requestId,
    ).toBe('8a1b2c3d4e5f6a7b-IAD');
  });

  it('generates an id when the host sends none, a different one per request', () => {
    const first = requestLogFields(at('https://shop.test/cart'));
    const second = requestLogFields(at('https://shop.test/cart'));
    expect(first.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(first.requestId).not.toBe(second.requestId);
  });

  it.each([
    'short',
    'has space in it 123',
    'jane@example.com-0000',
    'a'.repeat(200),
    'id\u0000with-control-0001',
    '"; DROP TABLE logs; --',
    '<script>alert(1)</script>',
    'ok-but-ünïcode-123',
  ])(
    'ignores a hostile or malformed id header and generates its own: %j',
    (value) => {
      let request: Request;
      try {
        request = at('https://shop.test/cart', {'x-request-id': value});
      } catch {
        // The platform refused the header value itself; nothing to test.
        return;
      }
      const {requestId} = requestLogFields(request);
      expect(requestId).not.toBe(value);
      expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    },
  );

  it('produces a log line with the path and id and no query, cookie or key', () => {
    const request = at(
      'https://shop.test/cart?key=SECRET&email=jane@example.com',
      {
        'x-request-id': 'req-1234abcd',
        cookie: 'cart=gid://shopify/Cart/c1?key=SECRET',
      },
    );
    const line = formatLogEvent('error', 'cart.revalidation_failed', {
      errorName: 'Error',
      ...requestLogFields(request),
    });
    expect(JSON.parse(line)).toEqual({
      level: 'error',
      event: 'cart.revalidation_failed',
      errorName: 'Error',
      path: '/cart',
      requestId: 'req-1234abcd',
    });
    expect(line).not.toMatch(/SECRET|jane|cookie/);
  });
});
