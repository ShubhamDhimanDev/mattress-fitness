import {describe, expect, it} from 'vitest';
import {parseExtendConfig, type ExtendConfig} from '~/lib/extend/config';
import {callExtend} from '~/lib/extend/http';
import type {FetchInit, FetchLike} from '~/lib/extend/types';

const TOKEN = 'tok_fixture_http_0001';

function config(host = 'https://api-demo.helloextend.com'): ExtendConfig {
  const result = parseExtendConfig(
    {
      PUBLIC_EXTEND_ENABLED: 'true',
      EXTEND_API_HOST: host,
      EXTEND_STORE_ID: 'store-fixture-1',
      EXTEND_ACCESS_TOKEN: TOKEN,
    },
    {production: false},
  );
  if (result.status !== 'enabled') throw new Error('fixture config invalid');
  return result.config;
}

function respond(body: string, init: ResponseInit = {status: 200}): FetchLike {
  return () => Promise.resolve(new Response(body, init));
}

const request = {
  method: 'POST',
  path: '/offers',
  body: {a: 1},
  timeoutMs: 1000,
  expectJson: true,
} as const;

describe('callExtend: bounded HTTP (REQ-EXT-001, NFR-013, T-13)', () => {
  it('sends exactly the documented request and returns the parsed JSON', async () => {
    const seen: Array<{url: string; init: FetchInit}> = [];
    const result = await callExtend(
      config(),
      (url, init) => {
        seen.push({url, init});
        return Promise.resolve(new Response('{"ok":true}', {status: 200}));
      },
      {...request, query: {storeId: 's 1'}},
    );
    expect(result).toEqual({status: 'ok', httpStatus: 200, body: {ok: true}});
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe(
      'https://api-demo.helloextend.com/offers?storeId=s+1',
    );
    expect(seen[0]?.init.method).toBe('POST');
    expect(seen[0]?.init.redirect).toBe('error'); // the token must not follow a redirect to another host
    expect(seen[0]?.init.body).toBe('{"a":1}');
    expect(seen[0]?.init.headers).toEqual({
      'X-Extend-Access-Token': TOKEN,
      Accept: 'application/json;version=2022-02-01',
      'Content-Type': 'application/json',
    });
    expect(seen[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });

  it('sends no body or content type for a GET', async () => {
    let captured: FetchInit | undefined;
    await callExtend(
      config(),
      (_url, init) => {
        captured = init;
        return Promise.resolve(new Response('{}', {status: 200}));
      },
      {method: 'GET', path: '/offers', timeoutMs: 1000, expectJson: true},
    );
    expect(captured?.body).toBeUndefined();
    expect(captured?.headers).not.toHaveProperty('Content-Type');
  });

  it.each([
    [500, undefined],
    [503, '2'],
    [429, '3'],
    [401, undefined],
    [400, undefined],
  ])('maps HTTP %i to a typed http error', async (status, retryAfter) => {
    const result = await callExtend(
      config(),
      respond('{"message":"secret-looking text we never read"}', {
        status,
        headers: retryAfter === undefined ? {} : {'Retry-After': retryAfter},
      }),
      request,
    );
    expect(result).toEqual({
      status: 'error',
      reason: 'http',
      httpStatus: status,
      ...(retryAfter === undefined
        ? {}
        : {retryAfterMs: Number(retryAfter) * 1000}),
    });
  });

  it.each([['Wed, 21 Oct 2026 07:28:00 GMT'], ['-5'], ['abc'], ['1e9']])(
    'ignores an unparseable Retry-After %j',
    async (value) => {
      const result = await callExtend(
        config(),
        respond('', {status: 503, headers: {'Retry-After': value}}),
        request,
      );
      expect(result).toEqual({
        status: 'error',
        reason: 'http',
        httpStatus: 503,
      });
    },
  );

  it('caps a huge Retry-After', async () => {
    const result = await callExtend(
      config(),
      respond('', {status: 429, headers: {'Retry-After': '99999'}}),
      request,
    );
    expect(result).toMatchObject({retryAfterMs: 60_000});
  });

  it('reports a rejected fetch as a network error', async () => {
    const result = await callExtend(
      config(),
      () => Promise.reject(new TypeError('fetch failed')),
      request,
    );
    expect(result).toEqual({status: 'error', reason: 'network'});
  });

  it('times out a fetch that ignores the abort signal', async () => {
    const started = Date.now();
    const result = await callExtend(
      config(),
      () => new Promise<Response>(() => {}),
      {...request, timeoutMs: 30},
    );
    expect(result).toEqual({status: 'error', reason: 'timeout'});
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('times out a fetch that honours the abort signal', async () => {
    const result = await callExtend(
      config(),
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
      {...request, timeoutMs: 30},
    );
    expect(result).toEqual({status: 'error', reason: 'timeout'});
  });

  it('times out when the headers arrive but the body never finishes', async () => {
    const stalled = new ReadableStream<Uint8Array>({start() {}});
    const result = await callExtend(
      config(),
      () => Promise.resolve(new Response(stalled, {status: 200})),
      {...request, timeoutMs: 30},
    );
    expect(result).toEqual({status: 'error', reason: 'timeout'});
  });

  it.each([['not json'], ['<html>gateway</html>'], ['']])(
    'treats a non-JSON 200 body %j as malformed when JSON is expected',
    async (body) => {
      const result = await callExtend(config(), respond(body), request);
      expect(result).toEqual({status: 'error', reason: 'malformed'});
    },
  );

  it('tolerates a non-JSON success body when JSON is not expected (PUT /orders body is undocumented)', async () => {
    const result = await callExtend(config(), respond(''), {
      ...request,
      method: 'PUT',
      path: '/orders',
      expectJson: false,
    });
    expect(result).toEqual({status: 'ok', httpStatus: 200, body: null});
  });

  it('rejects an oversized declared or actual body', async () => {
    const declared = await callExtend(
      config(),
      respond('{}', {status: 200, headers: {'Content-Length': '5000000'}}),
      request,
    );
    expect(declared).toEqual({status: 'error', reason: 'malformed'});
    const actual = await callExtend(
      config(),
      respond(JSON.stringify({pad: 'x'.repeat(1_100_000)})),
      request,
    );
    expect(actual).toEqual({status: 'error', reason: 'malformed'});
  });

  it('never rejects: every failure is a value', async () => {
    const failing: FetchLike[] = [
      () => Promise.reject(new Error('boom')),
      () => Promise.reject('a string'),
      () => {
        throw new Error('synchronous throw');
      },
    ];
    for (const fetchFn of failing) {
      await expect(
        callExtend(config(), fetchFn, request),
      ).resolves.toMatchObject({
        status: 'error',
      });
    }
  });
});
