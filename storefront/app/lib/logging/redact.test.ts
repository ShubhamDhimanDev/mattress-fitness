import {describe, expect, it} from 'vitest';
import {
  REDACTED,
  isSensitiveKey,
  redactString,
  redactValue,
} from '~/lib/logging/redact';

// NFR-010, T-04, T-05 (P7-08): the redaction layer, with hostile inputs. Every value here is made up.

describe('redactString: personal data (T-05)', () => {
  it.each([
    ['plain', 'failed for jane.doe@example.com today'],
    ['plus tag', 'jane+news@example.co.uk'],
    ['upper case', 'JANE@EXAMPLE.COM'],
    ['url-encoded at sign', 'user%40example.com'],
    ['inside a url', 'https://x.test/a?next=jane@example.com&x=1'],
    ['unicode local part', 'jörg.müller@beispiel.de'],
    ['subdomains', 'a.b@mail.eu.example.org'],
    ['inside json', '{"note":"call a@b.io please"}'],
  ])('removes an e-mail address: %s', (_label, text) => {
    const out = redactString(text);
    expect(out).not.toMatch(/@|%40/);
  });

  it.each([
    '(312) 555-0142',
    '312-555-0142',
    '312.555.0142',
    '312 555 0142',
    '+1 312 555 0142',
    '+1 (312) 555-0142',
    '1-312-555-0142',
    '+13125550142',
    '+442071838750',
  ])('removes the phone number %s', (phone) => {
    const out = redactString(`call ${phone} now`);
    expect(out).toContain('[phone]');
    expect(out).not.toMatch(/555|2071838750/);
  });

  it('does not mistake ids, timestamps and prices for phone numbers', () => {
    const text =
      'order 5123456789012 at 1728900000 total 1999.00 gid://shopify/Order/5123456789012 line 3';
    expect(redactString(text)).toBe(text);
  });

  it.each([
    ['4111 1111 1111 1111', true],
    ['4111-1111-1111-1111', true],
    ['3782 822463 10005', false], // not 4-digit groups: left to the other rules
    ['4111 1111 1111 1112', false], // fails the Luhn check: an id, not a card
  ])('card number %s redacted=%s', (card, redacted) => {
    const out = redactString(`pan ${card} end`);
    expect(out.includes('[card]')).toBe(redacted);
  });

  it.each([
    ['zip: 60601', '60601'],
    ['ZIP code 60601-1234', '60601'],
    ['postal_code=60601', '60601'],
    ['postcode: 60601', '60601'],
    ['?zip=60601&x=1', '60601'],
    ['{"zip":"60601"}', '60601'],
    ['shippingZip=60601', '60601'],
  ])('removes a ZIP written as %s', (text, digits) => {
    expect(redactString(text)).not.toContain(digits);
  });

  it('keeps a bare five-digit number that is not a ZIP', () => {
    expect(redactString('read 12345 items from cache')).toBe(
      'read 12345 items from cache',
    );
  });

  it.each([
    '221 Baker Street',
    '1600 Pennsylvania Avenue',
    '10 Downing St.',
    '742 Evergreen Terrace Rd',
    '4059 Mt Lee Dr',
  ])('removes a street address: %s', (address) => {
    expect(redactString(`ship to ${address}, Springfield`)).toContain(
      '[address]',
    );
  });

  it.each([
    'first_name=Jane',
    'lastName: Doe',
    '"address1":"12 Oak Lane"',
    'phone=3125550142',
    'email=jane@example.com',
  ])('removes the value of a personal key written as %s', (text) => {
    const out = redactString(text);
    expect(out).toContain(REDACTED);
    expect(out).not.toMatch(/Jane|Doe|Oak|3125550142|jane@/);
  });
});

describe('redactString: tokens, secrets and cart keys (T-04)', () => {
  it.each([
    [
      'access token in a query',
      'https://x.test/cb?access_token=abc123def456&x=1',
    ],
    ['token key', 'token=sk-abcdefghijklmnop'],
    ['signature', 'X-Shopify-Hmac-Sha256: dGVzdHNpZ25hdHVyZQ=='],
    ['password in json', '{"password":"hunter2hunter2"}'],
    ['client secret', 'client_secret=zzz999'],
    ['api key header text', 'x-api-key: abcd1234efgh5678'],
    ['cookie style', 'session=abcdef; Path=/'],
  ])('removes %s', (_label, text) => {
    const out = redactString(text);
    expect(out).toContain(REDACTED);
    expect(out).not.toMatch(
      /abc123def456|sk-abcdef|dGVzdHNp|hunter2|zzz999|abcd1234efgh|abcdef;/,
    );
  });

  it('removes a cart key wherever it appears (plain, URL-encoded, in a cookie value)', () => {
    const cartId = 'gid://shopify/Cart/c1-9f8e7d6c5b4a39281706f5e4d3c2b1a0';
    const key = '0a1b2c3d4e5f60718293a4b5c6d7e8f90';
    const samples = [
      `${cartId}?key=${key}`,
      `cart=c1-9f8e7d6c5b4a39281706f5e4d3c2b1a0%3Fkey%3D${key}; Path=/`,
      `https://shop.example/cart/c/c1-9f8e7d6c5b4a39281706f5e4d3c2b1a0?key=${key}`,
      `https://shop.example/checkouts/cn/${key}?key=${key}`,
      `{"cartKey":"${key}"}`,
    ];
    for (const sample of samples) {
      const out = redactString(sample);
      expect(out, sample).not.toContain(key);
      expect(out, sample).not.toContain('9f8e7d6c5b4a39281706f5e4d3c2b1a0');
    }
  });

  it('removes a customer id and the user-info part of a URL', () => {
    expect(redactString('gid://shopify/Customer/7654321098765')).toBe(
      `gid://shopify/Customer/${REDACTED}`,
    );
    expect(redactString('https://user:pa55w0rd@host.test/x')).toBe(
      `https://${REDACTED}@host.test/x`,
    );
  });

  it.each([
    ['bearer', `Authorization: ${'Bear'}er abcdefghijklmnop1234567890`],
    ['basic', 'Basic dXNlcjpwYXNzd29yZDEyMw=='],
    [
      'jwt',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk',
    ],
    ['shopify admin token', `${'shp'}at_0123456789abcdef0123456789abcdef`],
    ['shopify storefront secret', `${'shp'}ss_abcdefabcdefabcdefabcdef`],
    ['stripe style key', 'sk_live_abcdefghijklmnop0123'],
    ['github token', 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'],
    ['aws key id', `${'AKI'}AIOSFODNN7EXAMPLE`],
    ['32+ character random token', 'a8F3k2Lq9ZxW7mN4pR6tY1uV5bC0dE8g'],
    [
      'hex digest',
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    ],
  ])('removes a %s', (_label, secret) => {
    const out = redactString(`failed with ${secret} here`);
    expect(out).toMatch(/\[token\]|\[redacted\]/);
    expect(out).not.toContain(secret.slice(-16));
  });

  it('keeps hyphenated handles, event names and plain words readable', () => {
    const text =
      'product queen-hybrid-mattress-with-cooling-gel-layer-twelve-inch failed coverage.catalog_unavailable';
    expect(redactString(text)).toBe(text);
  });
});

describe('redactString: hostile and pathological input', () => {
  it('survives very long input quickly and bounds its output', () => {
    const inputs = [
      'a'.repeat(200_000),
      'a@'.repeat(100_000),
      '1 '.repeat(100_000),
      ('1' + ' '.repeat(50)).repeat(5_000),
      'zip='.repeat(50_000),
      '('.repeat(100_000),
      '+1'.repeat(100_000),
      '%40'.repeat(100_000),
      '1234 5678 '.repeat(50_000),
      `${'x'.repeat(100)}@${'y'.repeat(100)}.`.repeat(2_000),
      'Bearer '.repeat(50_000),
    ];
    const started = Date.now();
    for (const input of inputs) {
      const out = redactString(input);
      expect(out.length).toBeLessThanOrEqual(501);
    }
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('cuts a secret hidden past the scan limit rather than printing it', () => {
    const out = redactString(`${'x '.repeat(3_000)}token=supersecretvalue99`);
    expect(out).not.toContain('supersecretvalue99');
  });

  it('is idempotent', () => {
    const once = redactString(
      'mail a@b.io, zip=60601, key=abc123 call 312-555-0142',
    );
    expect(redactString(once)).toBe(once);
  });

  it('leaves unrelated text alone', () => {
    const text = 'Search failed: status 502 after 3 attempts in 120 ms';
    expect(redactString(text)).toBe(text);
  });
});

describe('isSensitiveKey', () => {
  it.each([
    'email',
    'Email',
    'customer_email',
    'contactEmail',
    'phone',
    'phoneNumber',
    'mobile',
    'zip',
    'zipCode',
    'shipping_zip',
    'postalCode',
    'postcode',
    'address',
    'address1',
    'shippingAddress',
    'streetAddress',
    'firstName',
    'last-name',
    'fullName',
    'name',
    'customerName',
    'token',
    'accessToken',
    'x-shopify-access-token',
    'api_key',
    'apiKey',
    'secret',
    'clientSecret',
    'password',
    'authorization',
    'cookie',
    'Set-Cookie',
    'cartId',
    'cart_key',
    'cartKey',
    'cart',
    'key',
    'checkoutUrl',
    'sessionId',
    'note',
    'card_number',
    'cvv',
    'hmac',
    'signature',
  ])('treats %s as sensitive', (key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });

  it.each([
    'event',
    'level',
    'orderId',
    'lineIds',
    'planIds',
    'reason',
    'httpStatus',
    'attempt',
    'count',
    'errorName',
    'variable',
    'handle',
    'keyword',
    'what',
    '',
  ])('treats %s as safe', (key) => {
    expect(isSensitiveKey(key)).toBe(false);
  });
});

describe('redactValue', () => {
  it('replaces a sensitive field whole, whatever its type', () => {
    expect(
      redactValue({
        email: 'a@b.io',
        phone: 3125550142,
        zip: '60601',
        shippingAddress: {line1: '1 Main St', city: 'X'},
        token: ['a', 'b'],
        orderId: 'gid://shopify/Order/5123456789012',
        count: 3,
      }),
    ).toEqual({
      email: REDACTED,
      phone: REDACTED,
      zip: REDACTED,
      shippingAddress: REDACTED,
      token: REDACTED,
      orderId: 'gid://shopify/Order/5123456789012',
      count: 3,
    });
  });

  it('keeps a boolean or null under a sensitive key (no information in it)', () => {
    expect(redactValue({hasEmail: true, phone: null, zip: undefined})).toEqual({
      hasEmail: true,
      phone: null,
      zip: undefined,
    });
  });

  it('scans string values and nested structures', () => {
    expect(
      redactValue({
        reason: 'bounced a@b.io',
        detail: {list: ['ok', 'zip=60601', {deep: 'key=abc'}]},
      }),
    ).toEqual({
      reason: 'bounced [email]',
      detail: {list: ['ok', `zip=${REDACTED}`, {deep: `key=${REDACTED}`}]},
    });
  });

  it('reduces an Error to its class name, never its message or cause', () => {
    class UpstreamError extends Error {}
    const error = new UpstreamError(
      'query { cart(id: "c1-abc?key=SECRET") } failed',
    );
    error.name = 'UpstreamError';
    (error as Error & {cause?: unknown}).cause = {
      token: `${'shp'}at_0123456789abcdef0123`,
    };
    const out = JSON.stringify(redactValue({error, nested: [error]}));
    expect(out).toContain('Error(UpstreamError)');
    expect(out).not.toMatch(/SECRET|shpat|query/);
  });

  it('survives circular, deep, wide and prototype-polluting values', () => {
    const circular: Record<string, unknown> = {a: 1};
    circular.self = circular;
    expect(JSON.stringify(redactValue(circular))).toContain('[circular]');

    let deep: unknown = 'leaf@example.com';
    for (let i = 0; i < 50; i += 1) deep = {next: deep};
    const deepOut = JSON.stringify(redactValue(deep));
    expect(deepOut).toContain('[truncated]');
    expect(deepOut).not.toContain('leaf@');

    const wide = Object.fromEntries(
      Array.from({length: 500}, (_, n) => [`k${n}`, n]),
    );
    expect(Object.keys(redactValue(wide) as object)).toHaveLength(40);
    expect(redactValue(Array.from({length: 500}, (_, n) => n))).toHaveLength(
      25,
    );

    const hostile: unknown = JSON.parse(
      '{"__proto__":{"polluted":true},"constructor":{"prototype":{"x":1}}}',
    );
    const polluted = redactValue(hostile);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(polluted)).toBe(Object.prototype);
  });

  it('never throws on a throwing getter, a proxy, a bigint, a symbol or a function', () => {
    const trap = {
      get boom(): string {
        throw new Error('getter exploded with a@b.io');
      },
      fine: 'ok',
    };
    const proxy = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('proxy trap');
        },
      },
    );
    expect(redactValue(trap)).toEqual({boom: '[unreadable]', fine: 'ok'});
    expect(redactValue(proxy)).toBe('[unredactable]');
    expect(redactValue(10n)).toBe('10');
    expect(redactValue(Symbol('x'))).toBe('[symbol]');
    expect(redactValue(() => 1)).toBe('[function]');
    expect(redactValue(Number.NaN)).toBe('NaN');
  });

  it('turns class instances, dates and urls into safe text', () => {
    class Customer {
      email = 'a@b.io';
    }
    expect(redactValue(new Customer())).toBe('[object]');
    expect(redactValue(new Date('2026-10-14T10:00:00Z'))).toBe(
      '2026-10-14T10:00:00.000Z',
    );
    expect(redactValue(new Date('nope'))).toBe('invalid-date');
    expect(
      redactValue(
        new URL('https://x.test/cb?email=a@b.io&access_token=abc123'),
      ),
    ).not.toMatch(/a@b|abc123/);
  });

  it('redacts a sensitive-looking key name itself when it carries data', () => {
    const out = JSON.stringify(redactValue({'jane@example.com': 1}));
    expect(out).not.toContain('jane@');
  });
});
