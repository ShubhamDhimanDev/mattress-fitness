import {afterEach, describe, expect, it, vi} from 'vitest';
import type {FetchInit, FetchLike} from '~/lib/extend/types';
import {
  KLAVIYO_ALLOWED_HOSTS,
  KLAVIYO_API_ORIGIN,
  KLAVIYO_REVISION,
  KLAVIYO_SUBSCRIBE_PATH,
  buildSubscribeBody,
  createKlaviyoClient,
  isAllowedKlaviyoUrl,
} from '~/lib/signup/klaviyo-client';

// REQ-ANL-003 / NFR-013 / T-10: the one Klaviyo call. The request shape follows Klaviyo's reference for Subscribe
// Profiles at revision 2026-10-15 (docs/integrations/KLAVIYO.md); the network is a fake, so nothing here proves Klaviyo
// accepts it (UNVERIFIED until a sandbox account exists, CLR-004).

afterEach(() => {
  vi.useRealTimers();
});

const KEY = 'fixture-private-key-not-real-0000';
const REQUEST = {
  email: 'shopper@example.com',
  phone: null,
  source: 'Storefront footer signup form (email-v1)',
};

type Call = {url: string; init: FetchInit};

function recorder(respond: () => Promise<Response>) {
  const calls: Call[] = [];
  const fetchFn: FetchLike = (url, init) => {
    calls.push({url, init});
    return respond();
  };
  return {calls, fetchFn};
}

function clientWith(fetchFn: FetchLike, timeoutMs?: number) {
  return createKlaviyoClient({
    apiKey: KEY,
    listId: 'AbC123',
    fetch: fetchFn,
    ...(timeoutMs === undefined ? {} : {timeoutMs}),
  });
}

describe('the request body (Klaviyo "Subscribe Profiles")', () => {
  it('subscribes the email to the list with no timestamp and no historical import', () => {
    expect(buildSubscribeBody(REQUEST, 'AbC123')).toEqual({
      data: {
        type: 'profile-subscription-bulk-create-job',
        attributes: {
          custom_source: 'Storefront footer signup form (email-v1)',
          historical_import: false,
          profiles: {
            data: [
              {
                type: 'profile',
                attributes: {
                  email: 'shopper@example.com',
                  subscriptions: {
                    email: {marketing: {consent: 'SUBSCRIBED'}},
                  },
                },
              },
            ],
          },
        },
        relationships: {list: {data: {type: 'list', id: 'AbC123'}}},
      },
    });
  });

  it('NEVER sends consented_at: Klaviyo documents it as an error unless historical_import is true', () => {
    const text = JSON.stringify(
      buildSubscribeBody({...REQUEST, phone: '+12125550100'}, 'AbC123'),
    );
    expect(text).not.toContain('consented_at');
    expect(text).toContain('"historical_import":false');
  });

  it('adds the phone and the SMS subscription together, only when a phone is given', () => {
    const body = JSON.stringify(
      buildSubscribeBody({...REQUEST, phone: '+12125550100'}, 'AbC123'),
    );
    expect(body).toContain('"phone_number":"+12125550100"');
    expect(body).toContain('"sms":{"marketing":{"consent":"SUBSCRIBED"}}');
    const emailOnly = JSON.stringify(buildSubscribeBody(REQUEST, 'AbC123'));
    expect(emailOnly).not.toContain('phone_number');
    expect(emailOnly).not.toContain('"sms"');
  });

  it('carries the address as a JSON string, so hostile characters cannot change the structure', () => {
    const hostile = 'a"},{"x":"y@example.com';
    const text = JSON.stringify(
      buildSubscribeBody({...REQUEST, email: hostile}, 'AbC123'),
    );
    const parsed: unknown = JSON.parse(text);
    expect(JSON.stringify(parsed)).toBe(text);
    expect(text).toContain('"email":"a\\"},{\\"x\\":\\"y@example.com"');
  });
});

describe('the call (host allow-list, headers, one attempt, typed failures)', () => {
  it('posts once to the allow-listed host with the private key, the revision and the documented media type', async () => {
    const {calls, fetchFn} = recorder(() =>
      Promise.resolve(new Response(null, {status: 202})),
    );
    const result = await clientWith(fetchFn).subscribe(REQUEST);
    expect(result).toEqual({status: 'accepted'});
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe(`${KLAVIYO_API_ORIGIN}${KLAVIYO_SUBSCRIBE_PATH}`);
    expect(call?.url).toBe(
      'https://a.klaviyo.com/api/profile-subscription-bulk-create-jobs',
    );
    expect(call?.init.method).toBe('POST');
    expect(call?.init.redirect).toBe('error');
    expect(call?.init.headers).toEqual({
      Authorization: `Klaviyo-API-Key ${KEY}`,
      revision: '2026-10-15',
      'Content-Type': 'application/vnd.api+json',
    });
    expect(KLAVIYO_REVISION).toBe('2026-10-15');
    expect(JSON.parse(call?.init.body ?? '{}')).toEqual(
      buildSubscribeBody(REQUEST, 'AbC123'),
    );
  });

  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [429, 'rate_limited'],
    // Our own request is wrong (list id, revision, media type, method): a configuration fault, not the shopper's.
    [400, 'config'],
    [404, 'config'],
    [405, 'config'],
    [415, 'config'],
    // Other 4xx: Klaviyo refused this one request.
    [409, 'rejected'],
    [422, 'rejected'],
    [418, 'rejected'],
    [500, 'server'],
    [502, 'server'],
    [503, 'server'],
    // Klaviyo documents 202 as the only success. Anything else is not claimed as one.
    [200, 'unexpected_2xx'],
    [201, 'unexpected_2xx'],
    [204, 'unexpected_2xx'],
    [226, 'unexpected_2xx'],
  ])(
    'maps status %i to %s without reading the body',
    async (status, reason) => {
      const {fetchFn} = recorder(() =>
        Promise.resolve(
          new Response(
            status === 204
              ? null
              : JSON.stringify({
                  errors: [{detail: 'shopper@example.com is bad'}],
                }),
            {status},
          ),
        ),
      );
      const result = await clientWith(fetchFn).subscribe(REQUEST);
      expect(result).toEqual({status: 'failed', reason, httpStatus: status});
      // The result is a code: nothing Klaviyo said, and so no address, can travel with it.
      expect(JSON.stringify(result)).not.toContain('shopper@');
    },
  );

  it('makes exactly one attempt on a failure: no retry', async () => {
    const {calls, fetchFn} = recorder(() =>
      Promise.resolve(new Response(null, {status: 503})),
    );
    await clientWith(fetchFn).subscribe(REQUEST);
    expect(calls).toHaveLength(1);
  });

  it('reports a network failure and does not throw', async () => {
    const {fetchFn} = recorder(() =>
      Promise.reject(new TypeError('connect ECONNREFUSED shopper@example.com')),
    );
    const result = await clientWith(fetchFn).subscribe(REQUEST);
    expect(result).toEqual({status: 'failed', reason: 'network'});
    expect(JSON.stringify(result)).not.toContain('shopper@');
  });

  it('times out: aborts the request and reports a timeout', async () => {
    vi.useFakeTimers();
    let aborted = false;
    const fetchFn: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          aborted = true;
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    const pending = clientWith(fetchFn, 1500).subscribe(REQUEST);
    await vi.advanceTimersByTimeAsync(1499);
    expect(aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(await pending).toEqual({status: 'failed', reason: 'timeout'});
    expect(aborted).toBe(true);
  });

  it('refuses a redirect (the key must never be forwarded to another host)', async () => {
    const {calls, fetchFn} = recorder(() =>
      Promise.reject(new TypeError('redirect mode is set to error')),
    );
    expect(await clientWith(fetchFn).subscribe(REQUEST)).toEqual({
      status: 'failed',
      reason: 'network',
    });
    expect(calls[0]?.init.redirect).toBe('error');
  });
});

describe('the host allow-list (T-10)', () => {
  it('allows exactly a.klaviyo.com over https', () => {
    expect(KLAVIYO_ALLOWED_HOSTS).toEqual(['a.klaviyo.com']);
    expect(isAllowedKlaviyoUrl('https://a.klaviyo.com/api/x')).toBe(true);
  });

  it.each([
    'http://a.klaviyo.com/api/x',
    'https://klaviyo.com/api/x',
    'https://a.klaviyo.com.evil.example/api/x',
    'https://evil-a.klaviyo.com/api/x',
    'https://a.klaviyo.com@evil.example/api/x',
    'https://user:pass@a.klaviyo.com/api/x',
    'https://a.klaviyo.com:8443/api/x',
    'https://static.klaviyo.com/api/x',
    'https://a.klaviyo.co/api/x',
    'ftp://a.klaviyo.com/x',
    'not a url',
    '',
  ])('refuses %j', (url) => {
    expect(isAllowedKlaviyoUrl(url)).toBe(false);
  });
});
