import {afterEach, describe, expect, it, vi} from 'vitest';
import {EMAIL_CONSENT} from '~/lib/signup/consent';
import {resetSignupStateForTests} from '~/lib/signup/handler';
import {SIGNUP_FIELDS, SIGNUP_MESSAGES} from '~/lib/signup/shared';
import {action, headers, loader, meta} from '~/routes/signup';

// REQ-ANL-003 / P7-02: the real loader and action against a stubbed network layer (the global fetch), so the handler,
// the Klaviyo client, the limiter and the route wiring all run. Nothing here proves Klaviyo accepts the request
// (UNVERIFIED, CLR-004). All identities are fictional.

const ORIGIN = 'https://shop.example';
const KEY = 'fixture-private-key-not-real-0000';
const CONFIGURED = {
  KLAVIYO_PRIVATE_API_KEY: KEY,
  KLAVIYO_LIST_ID: 'AbC123',
  TRUSTED_CLIENT_IP_HEADER: 'x-real-ip',
};
const FORM = {
  [SIGNUP_FIELDS.email]: 'shopper@example.com',
  [SIGNUP_FIELDS.emailConsent]: 'yes',
  [SIGNUP_FIELDS.emailConsentVersion]: EMAIL_CONSENT.version,
  [SIGNUP_FIELDS.surface]: 'home',
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetSignupStateForTests();
});

type KlaviyoCall = {url: string; headers: Headers; body: unknown};

function stubKlaviyo(status = 202): KlaviyoCall[] {
  const calls: KlaviyoCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit) => {
      calls.push({
        url,
        headers: new Headers(init.headers),
        body: JSON.parse(String(init.body)) as unknown,
      });
      return Promise.resolve(new Response(null, {status}));
    }),
  );
  return calls;
}

let ipCounter = 0;
function post(fields: Record<string, string> = FORM): Request {
  ipCounter += 1;
  return new Request(`${ORIGIN}/signup`, {
    method: 'POST',
    headers: {Origin: ORIGIN, 'x-real-ip': `198.51.100.${ipCounter % 250}`},
    body: new URLSearchParams(fields),
  });
}

function args(request: Request, env: object) {
  return {request, context: {env}, params: {}} as never;
}

type Wrapped = {data: unknown; status: number; headers: Headers};

function unwrap(result: unknown): Wrapped {
  if (
    typeof result === 'object' &&
    result !== null &&
    'data' in result &&
    'init' in result
  ) {
    const {data, init} = result;
    const record = typeof init === 'object' && init !== null ? init : {};
    return {
      data,
      status: 'status' in record ? Number(record.status) : 200,
      headers: new Headers(
        'headers' in record ? (record.headers as HeadersInit) : undefined,
      ),
    };
  }
  throw new Error('Not a data() result');
}

describe('GET /signup', () => {
  it('is 405 with Allow: POST, private, uncached and not indexable, and reads nothing from the URL', () => {
    const result = unwrap(loader());
    expect(result.status).toBe(405);
    expect(result.headers.get('Allow')).toBe('POST');
    expect(result.headers.get('Cache-Control')).toBe('private, no-store');
    expect(result.data).toBeNull();
    const documentHeaders = headers({
      actionHeaders: new Headers({'Retry-After': '30'}),
      loaderHeaders: result.headers,
    } as never) as Headers;
    expect(documentHeaders.get('Cache-Control')).toBe('private, no-store');
    expect(documentHeaders.get('X-Robots-Tag')).toBe('noindex, nofollow');
    expect(documentHeaders.get('Retry-After')).toBe('30');
    expect(documentHeaders.get('Allow')).toBe('POST');
    expect(meta({} as never)).toContainEqual({
      name: 'robots',
      content: 'noindex, nofollow',
    });
  });
});

describe('POST /signup through the real wiring', () => {
  it('subscribes once at Klaviyo with the private key, answers with the generic thank-you and never echoes the address', async () => {
    const calls = stubKlaviyo();
    const result = unwrap(await action(args(post(), CONFIGURED)));
    expect(result.status).toBe(200);
    expect(result.data).toEqual({status: 'ok', message: SIGNUP_MESSAGES.ok});
    expect(JSON.stringify(result.data)).not.toContain('shopper');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      'https://a.klaviyo.com/api/profile-subscription-bulk-create-jobs',
    );
    expect(calls[0]?.headers.get('Authorization')).toBe(
      `Klaviyo-API-Key ${KEY}`,
    );
    expect(calls[0]?.headers.get('revision')).toBe('2026-10-15');
    // The key is in the request to Klaviyo and nowhere in what the browser gets back.
    expect(JSON.stringify(result.data)).not.toContain(KEY);
    expect([...result.headers.values()].join(' ')).not.toContain(KEY);
  });

  it('is unavailable, and calls nothing, when the key or the list is missing', async () => {
    const calls = stubKlaviyo();
    for (const env of [
      {},
      {KLAVIYO_LIST_ID: 'AbC123'},
      {KLAVIYO_PRIVATE_API_KEY: KEY},
    ]) {
      const result = unwrap(await action(args(post(), env)));
      expect(result.status).toBe(503);
      expect(result.data).toEqual({
        status: 'unavailable',
        message: SIGNUP_MESSAGES.unavailable,
      });
    }
    expect(calls).toHaveLength(0);
  });

  it('a Klaviyo outage answers 503 with the friendly message and no leak of the upstream status', async () => {
    stubKlaviyo(500);
    const result = unwrap(await action(args(post(), CONFIGURED)));
    expect(result.status).toBe(503);
    expect(JSON.stringify(result.data)).not.toMatch(/500|klaviyo/i);
  });

  it('a network failure at Klaviyo is the same friendly message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('network down'))),
    );
    const result = unwrap(await action(args(post(), CONFIGURED)));
    expect(result.status).toBe(503);
    expect(result.data).toEqual({
      status: 'unavailable',
      message: SIGNUP_MESSAGES.unavailable,
    });
  });

  it('a cross-origin POST is refused before anything is read', async () => {
    const calls = stubKlaviyo();
    const request = new Request(`${ORIGIN}/signup`, {
      method: 'POST',
      headers: {Origin: 'https://evil.example'},
      body: new URLSearchParams(FORM),
    });
    const result = unwrap(await action(args(request, CONFIGURED)));
    expect(result.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it('ignores a posted phone number and SMS consent while the SMS flag is not set (default off)', async () => {
    const calls = stubKlaviyo();
    const result = unwrap(
      await action(
        args(
          post({
            ...FORM,
            [SIGNUP_FIELDS.phone]: '212-555-0100',
            [SIGNUP_FIELDS.smsConsent]: 'yes',
            [SIGNUP_FIELDS.smsConsentVersion]: 'sms-placeholder-v0',
          }),
          CONFIGURED,
        ),
      ),
    );
    expect(result.status).toBe(200);
    expect(JSON.stringify(calls[0]?.body)).not.toContain('phone_number');
  });
});
