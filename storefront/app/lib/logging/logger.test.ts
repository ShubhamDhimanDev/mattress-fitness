import {describe, expect, it, vi} from 'vitest';
import {
  INVALID_EVENT_NAME,
  errorFields,
  formatLogEvent,
  logError,
  logEvent,
  logInfo,
  logWarn,
  type LogSink,
} from '~/lib/logging/logger';

// NFR-010, T-05 (P7-08): structured events, redacted by construction.

function parse(line: string): Record<string, unknown> {
  const value: unknown = JSON.parse(line);
  return typeof value === 'object' && value !== null
    ? Object.fromEntries(Object.entries(value))
    : {};
}

function sink() {
  const lines: Array<{channel: 'warn' | 'error'; line: string}> = [];
  const target: LogSink = {
    warn: (line) => lines.push({channel: 'warn', line}),
    error: (line) => lines.push({channel: 'error', line}),
  };
  return {lines, target};
}

describe('formatLogEvent', () => {
  it('writes one JSON object with level, event and the fields', () => {
    const line = formatLogEvent('warn', 'sync.attempt_failed', {
      orderId: 'gid://shopify/Order/5123456789012',
      attempt: 2,
      httpStatus: 503,
    });
    expect(parse(line)).toEqual({
      level: 'warn',
      event: 'sync.attempt_failed',
      orderId: 'gid://shopify/Order/5123456789012',
      attempt: 2,
      httpStatus: 503,
    });
    expect(line).not.toContain('\n');
  });

  it('redacts personal data in fields, by key and by content', () => {
    const line = formatLogEvent('error', 'webhook.background_failed', {
      email: 'jane@example.com',
      zip: '60601',
      reason: 'timeout for jane@example.com at 312-555-0142',
      cartId: 'gid://shopify/Cart/c1-abc?key=0123456789abcdef0123456789abcdef',
    });
    expect(line).not.toMatch(/jane@|60601|312-555|c1-abc|0123456789abcdef/);
    expect(parse(line)).toMatchObject({
      email: '[redacted]',
      zip: '[redacted]',
      cartId: '[redacted]',
    });
  });

  it('does not let a field overwrite the level or the event', () => {
    const parsed = parse(
      formatLogEvent('info', 'a.b', {level: 'debug', event: 'evil', n: 1}),
    );
    expect(parsed).toEqual({level: 'info', event: 'a.b', n: 1});
  });

  it.each([
    '',
    'Has Spaces',
    'UPPER.case',
    'bearer abcdefgh12345678',
    'jane@example.com',
    'a'.repeat(200),
    'two..dots',
    '.leading',
    'a.b.c.d.e',
    '{"x":1}',
    'new\nline',
  ])('replaces the free-text event name %j', (name) => {
    const parsed = parse(formatLogEvent('warn', name));
    expect(parsed.event).toBe(INVALID_EVENT_NAME);
  });

  it.each([
    'search.failed',
    'detective.violation',
    'webhook.background_failed',
    'offers.circuit_open',
    'root.store_read_failed',
    'render.failed',
  ])('accepts the event name %s', (name) => {
    expect(parse(formatLogEvent('info', name)).event).toBe(name);
  });

  it('never throws, even for a field that cannot be serialised', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.me = cyclic;
    const trap = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('boom');
        },
      },
    );
    expect(() => formatLogEvent('error', 'x.y', cyclic)).not.toThrow();
    expect(() => formatLogEvent('error', 'x.y', trap)).not.toThrow();
    expect(parse(formatLogEvent('error', 'x.y', {big: 10n}))).toEqual({
      level: 'error',
      event: 'x.y',
      big: '10',
    });
  });
});

describe('logEvent', () => {
  it('sends errors to the error channel and everything else to warn (the lint allows only those two)', () => {
    const {lines, target} = sink();
    logEvent('info', 'a.info', {}, target);
    logEvent('warn', 'a.warn', {}, target);
    logEvent('error', 'a.error', {}, target);
    expect(lines.map((l) => [l.channel, parse(l.line).level])).toEqual([
      ['warn', 'info'],
      ['warn', 'warn'],
      ['error', 'error'],
    ]);
  });

  it('survives a sink that throws', () => {
    const broken: LogSink = {
      warn: () => {
        throw new Error('disk full');
      },
      error: () => {
        throw new Error('disk full');
      },
    };
    expect(() => logEvent('error', 'a.b', {}, broken)).not.toThrow();
  });

  it('the default helpers write one redacted JSON line through the console', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    logInfo('a.info', {count: 1});
    logWarn('a.warn', {phone: '312-555-0142'});
    logError('a.error', {note: 'x'});
    expect(warn).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledTimes(1);
    const all = [...warn.mock.calls, ...error.mock.calls]
      .map((call) => String(call[0]))
      .join('\n');
    expect(all).not.toContain('312-555');
    expect(all).toContain('"event":"a.info"');
  });
});

describe('errorFields', () => {
  it('reports the class name only', () => {
    class UpstreamError extends Error {}
    const error = new UpstreamError('cart c1-abc?key=SECRET failed');
    error.name = 'UpstreamError';
    expect(errorFields(error)).toEqual({errorName: 'UpstreamError'});
    expect(JSON.stringify(errorFields(error))).not.toContain('SECRET');
  });

  it('says so for a value that is not an error', () => {
    expect(errorFields('jane@example.com')).toEqual({
      errorName: 'non-error value thrown',
    });
    expect(errorFields(null)).toEqual({errorName: 'non-error value thrown'});
    const nameless = new Error('x');
    nameless.name = '';
    expect(errorFields(nameless)).toEqual({
      errorName: 'non-error value thrown',
    });
  });
});
