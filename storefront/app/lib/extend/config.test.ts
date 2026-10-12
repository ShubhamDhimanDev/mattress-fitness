import {inspect} from 'node:util';
import {describe, expect, it} from 'vitest';
import {parseExtendConfig, parseExtendHost} from '~/lib/extend/config';

const SECRET_TOKEN = 'tok_fixture_0123456789abcdef';

function env(overrides: Record<string, unknown> = {}) {
  return {
    PUBLIC_EXTEND_ENABLED: 'true',
    EXTEND_API_HOST: 'https://api-demo.helloextend.com',
    EXTEND_STORE_ID: 'store-fixture-1',
    EXTEND_ACCESS_TOKEN: SECRET_TOKEN,
    ...overrides,
  };
}

describe('Extend config (REQ-EXT-001, NFR-013, T-04)', () => {
  it('is enabled with the flag exactly "true" and all credentials', () => {
    const result = parseExtendConfig(env());
    expect(result.status).toBe('enabled');
    if (result.status !== 'enabled') return;
    expect(result.config.apiHost).toBe('https://api-demo.helloextend.com');
    expect(result.config.storeId).toBe('store-fixture-1');
    expect(result.config.orderSync).toBe('self');
  });

  it.each([
    [undefined],
    [''],
    ['false'],
    ['TRUE'],
    ['True'],
    ['1'],
    ['yes'],
    [' true'],
    ['true '],
    [true],
    [1],
  ])('is disabled when PUBLIC_EXTEND_ENABLED is %j', (flag) => {
    expect(parseExtendConfig(env({PUBLIC_EXTEND_ENABLED: flag}))).toEqual({
      status: 'disabled',
      reason: 'flag_off',
      missing: [],
    });
  });

  it.each([['EXTEND_API_HOST'], ['EXTEND_STORE_ID'], ['EXTEND_ACCESS_TOKEN']])(
    'is disabled and names %s when it is missing',
    (name) => {
      for (const blank of [undefined, '', '   ', 42]) {
        const result = parseExtendConfig(env({[name]: blank}));
        expect(result).toEqual({
          status: 'disabled',
          reason: 'missing_credentials',
          missing: [name],
        });
      }
    },
  );

  it('lists every missing credential, names only', () => {
    const result = parseExtendConfig({PUBLIC_EXTEND_ENABLED: 'true'});
    expect(result).toEqual({
      status: 'disabled',
      reason: 'missing_credentials',
      missing: ['EXTEND_API_HOST', 'EXTEND_STORE_ID', 'EXTEND_ACCESS_TOKEN'],
    });
  });

  it('can ignore the UI flag so order sync keeps running when offers are hidden', () => {
    const result = parseExtendConfig(env({PUBLIC_EXTEND_ENABLED: 'false'}), {
      requireFlag: false,
    });
    expect(result.status).toBe('enabled');
  });

  describe('outbound host allow-list (SSRF safety)', () => {
    it.each([
      ['https://api-demo.helloextend.com', 'https://api-demo.helloextend.com'],
      ['https://api.helloextend.com', 'https://api.helloextend.com'],
      ['https://api.helloextend.com/', 'https://api.helloextend.com'],
      ['  https://api.helloextend.com  ', 'https://api.helloextend.com'],
      ['http://127.0.0.1:4010', 'http://127.0.0.1:4010'],
      ['http://localhost:4010', 'http://localhost:4010'],
      ['http://[::1]:4010', 'http://[::1]:4010'],
    ])('accepts %j', (raw, origin) => {
      expect(parseExtendHost(raw.trim())).toBe(origin);
    });

    it.each([
      ['http://api.helloextend.com'],
      ['http://api-demo.helloextend.com'],
      ['https://evil.example.com'],
      ['https://api.helloextend.com.evil.example.com'],
      ['https://evil.example.com/api.helloextend.com'],
      ['https://api.helloextend.com@evil.example.com'],
      ['https://user:pw@api.helloextend.com'],
      ['https://api.helloextend.com:8443'],
      ['https://api.helloextend.com/v1'],
      ['https://api.helloextend.com/?next=evil'],
      ['https://api.helloextend.com/#frag'],
      ['ftp://127.0.0.1'],
      ['file:///etc/passwd'],
      ['javascript:alert(1)'],
      ['https://169.254.169.254'],
      ['not a url'],
      [''],
    ])('rejects %j', (raw) => {
      expect(parseExtendHost(raw)).toBeNull();
      expect(parseExtendConfig(env({EXTEND_API_HOST: raw}))).toMatchObject({
        status: 'disabled',
      });
    });
  });

  it.each([
    ['store with space', 'EXTEND_STORE_ID', 'bad store', 'invalid_store_id'],
    ['store with slash', 'EXTEND_STORE_ID', 'a/b', 'invalid_store_id'],
    [
      'token with newline',
      'EXTEND_ACCESS_TOKEN',
      'abc\r\nX-Evil: 1',
      'invalid_token',
    ],
    ['token with space', 'EXTEND_ACCESS_TOKEN', 'abc def', 'invalid_token'],
    ['token with unicode', 'EXTEND_ACCESS_TOKEN', 'tökën', 'invalid_token'],
  ])('rejects a malformed value: %s', (_label, name, value, reason) => {
    expect(parseExtendConfig(env({[name]: value}))).toMatchObject({
      status: 'disabled',
      reason,
    });
  });

  describe('EXTEND_ORDER_SYNC (ADR-0009)', () => {
    it.each([
      [undefined, 'self'],
      ['', 'self'],
      ['  ', 'self'],
      ['self', 'self'],
      ['extend-app', 'extend-app'],
      ['off', 'off'],
    ])('%j -> %s', (raw, expected) => {
      const result = parseExtendConfig(env({EXTEND_ORDER_SYNC: raw}));
      expect(result.status).toBe('enabled');
      if (result.status === 'enabled')
        expect(result.config.orderSync).toBe(expected);
    });

    it.each([['SELF'], ['both'], ['true'], ['extend_app'], ['0']])(
      'fails closed on %j instead of guessing (a wrong guess double-reports or drops orders)',
      (raw) => {
        expect(parseExtendConfig(env({EXTEND_ORDER_SYNC: raw}))).toMatchObject({
          status: 'disabled',
          reason: 'invalid_order_sync',
        });
      },
    );
  });

  describe('the access token never leaks', () => {
    it('is absent from JSON, string and inspect output of the config and of a disabled result', () => {
      const enabled = parseExtendConfig(env());
      const disabled = parseExtendConfig(
        env({EXTEND_API_HOST: 'https://evil.example.com'}),
      );
      for (const result of [enabled, disabled]) {
        expect(JSON.stringify(result)).not.toContain(SECRET_TOKEN);
        expect(inspect(result, {depth: 6})).not.toContain(SECRET_TOKEN);
        expect(String(result)).not.toContain(SECRET_TOKEN);
      }
    });

    it('is reachable only through the documented request headers', () => {
      const result = parseExtendConfig(env());
      if (result.status !== 'enabled') throw new Error('expected enabled');
      expect(Object.keys(result.config).sort()).toEqual([
        'apiHost',
        'orderSync',
        'requestHeaders',
        'storeId',
      ]);
      expect(result.config.requestHeaders({json: false})).toEqual({
        'X-Extend-Access-Token': SECRET_TOKEN,
        Accept: 'application/json;version=2022-02-01',
      });
      expect(result.config.requestHeaders({json: true})).toEqual({
        'X-Extend-Access-Token': SECRET_TOKEN,
        Accept: 'application/json;version=2022-02-01',
        'Content-Type': 'application/json',
      });
    });
  });
});
