import {describe, expect, it} from 'vitest';
import {
  ACCOUNT_ERROR_MESSAGES,
  NEW_ADDRESS_FORM_ID,
  accountErrorStatus,
  accountErrorView,
  accountFailure,
  decodeOrderRouteId,
  hasOversizedField,
  parseAddressId,
  withAccountNoStore,
  type AccountErrorCode,
} from '~/lib/account/results';

// P6-07 carry-over P-L8 and T-11: fixed shopper-safe messages, id parsing for the account routes, cache headers.

const CODES = Object.keys(ACCOUNT_ERROR_MESSAGES) as AccountErrorCode[];

describe('account results', () => {
  it('has a fixed message and an error status for every code', () => {
    for (const code of CODES) {
      const failure = accountFailure(code);
      expect(failure).toEqual({
        status: 'error',
        code,
        message: ACCOUNT_ERROR_MESSAGES[code],
      });
      expect(failure.message.length).toBeGreaterThan(10);
      expect(accountErrorStatus(code)).toBeGreaterThanOrEqual(400);
    }
  });

  it('uses a distinct status for sign-out, forbidden and unsupported methods', () => {
    expect(accountErrorStatus('signed-out')).toBe(401);
    expect(accountErrorStatus('forbidden')).toBe(403);
    expect(accountErrorStatus('method-not-allowed')).toBe(405);
  });
});

describe('parseAddressId', () => {
  const GID = 'gid://shopify/CustomerAddress/123?model_name=CustomerAddress';

  it('accepts a customer address id, plain or percent-encoded, and returns it decoded', () => {
    expect(parseAddressId(GID)).toBe(GID);
    expect(parseAddressId(encodeURIComponent(GID))).toBe(GID);
  });

  it.each([
    ['empty', ''],
    ['a placeholder', NEW_ADDRESS_FORM_ID],
    ['another resource', 'gid://shopify/Customer/123'],
    ['a script URL', 'javascript:alert(1)'],
    ['a bare prefix', 'gid://shopify/CustomerAddress/'],
    ['a malformed escape', '%E0%A4%A'],
    ['a control character', 'gid://shopify/CustomerAddress/1\n2'],
    ['an oversized value', `gid://shopify/CustomerAddress/${'1'.repeat(400)}`],
  ])('rejects %s', (_name, value) => {
    expect(parseAddressId(value)).toBeNull();
  });

  it('rejects anything that is not text', () => {
    expect(parseAddressId(null)).toBeNull();
    expect(parseAddressId(42)).toBeNull();
    expect(parseAddressId(new File([], 'x'))).toBeNull();
  });
});

describe('decodeOrderRouteId', () => {
  const ORDER = 'gid://shopify/Order/5555?key=abc123';

  it('decodes the route segment the orders list links to', () => {
    expect(decodeOrderRouteId(btoa(ORDER))).toBe(ORDER);
    expect(decodeOrderRouteId(btoa('gid://shopify/Order/77'))).toBe(
      'gid://shopify/Order/77',
    );
  });

  it.each([
    ['undefined', undefined],
    ['empty', ''],
    ['not base64', 'not base64!!'],
    ['a customer id', btoa('gid://shopify/Customer/1')],
    ['an order id with a path', btoa('gid://shopify/Order/1/../../x')],
    ['a graphql fragment', btoa('gid://shopify/Order/1") { id }')],
    ['too long', 'A'.repeat(500)],
  ])('rejects %s', (_name, value) => {
    expect(decodeOrderRouteId(value)).toBeNull();
  });
});

describe('hasOversizedField', () => {
  it('flags only a text value over the field limit', () => {
    const form = new FormData();
    form.set('city', 'x'.repeat(255));
    expect(hasOversizedField(form, ['city'])).toBe(false);
    form.set('city', 'x'.repeat(256));
    expect(hasOversizedField(form, ['city'])).toBe(true);
    expect(hasOversizedField(form, ['zip'])).toBe(false);
  });
});

describe('withAccountNoStore', () => {
  it('adds private, no-store and keeps status, location and cookies', () => {
    const upstream = new Response(null, {status: 302});
    upstream.headers.set('Location', 'https://shopify.example/auth');
    upstream.headers.append('Set-Cookie', 'a=1; Path=/; HttpOnly');
    upstream.headers.append('Set-Cookie', 'b=2; Path=/; HttpOnly');
    upstream.headers.set('Cache-Control', 'public, max-age=600');

    const wrapped = withAccountNoStore(upstream);

    expect(wrapped.status).toBe(302);
    expect(wrapped.headers.get('Location')).toBe(
      'https://shopify.example/auth',
    );
    expect(wrapped.headers.get('Cache-Control')).toBe('private, no-store');
    expect(wrapped.headers.get('Vary')).toBe('Cookie');
    expect(wrapped.headers.getSetCookie()).toEqual([
      'a=1; Path=/; HttpOnly',
      'b=2; Path=/; HttpOnly',
    ]);
  });
});

describe('accountErrorView', () => {
  it('maps a status to fixed text and a recovery', () => {
    expect(accountErrorView(401).recovery).toBe('sign-in');
    expect(accountErrorView(403).recovery).toBe('sign-in');
    expect(accountErrorView(404).recovery).toBe('account');
    expect(accountErrorView(500).recovery).toBe('retry');
    expect(accountErrorView(null).recovery).toBe('retry');
  });
});
