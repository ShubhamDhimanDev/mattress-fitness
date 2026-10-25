import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  createInMemoryRateLimitStore,
  type KeyHasher,
  type RateLimitStore,
} from '~/lib/orders/guest-lookup-limiter';
import {EMAIL_CONSENT, SMS_CONSENT} from '~/lib/signup/consent';
import {
  consentSource,
  handleSignup,
  resetSignupStateForTests,
  signupDepsFromEnv,
  type SignupDeps,
  type SignupHttpResult,
} from '~/lib/signup/handler';
import {createSignupGate, type SignupGateLimits} from '~/lib/signup/limiter';
import {SIGNUP_FIELDS, SIGNUP_MESSAGES} from '~/lib/signup/shared';
import {failing, fakeKlaviyo, type FakeKlaviyo} from './fake-klaviyo';

// REQ-ANL-003 / NFR-011 / NFR-013 / T-05 / T-13: the request flow with a typed fake Klaviyo client. No network, no
// real timers. UNVERIFIED against Klaviyo itself (CLR-004). Every identity is fictional (example.* domains, 555 numbers).

afterEach(() => {
  vi.restoreAllMocks();
  resetSignupStateForTests();
});

const ORIGIN = 'https://shop.example';
const ADDRESS_HEADER = 'x-real-ip';
const GENEROUS: SignupGateLimits = {
  perAddress: {limit: 1000, windowMs: 60_000},
  perAddressDaily: {limit: 1000, windowMs: 86_400_000},
  sharedAddressDaily: {limit: 1000, windowMs: 86_400_000},
  perEmailDaily: {limit: 1000, windowMs: 86_400_000},
  perPhoneDaily: {limit: 1000, windowMs: 86_400_000},
  sharedAddress: {limit: 1000, windowMs: 60_000},
  perEmail: {limit: 1000, windowMs: 60_000},
  overall: {limit: 1000, windowMs: 60_000},
};
const plainHash: KeyHasher = (scope, value) =>
  Promise.resolve(`${scope}#${value}`);

const GOOD_FORM = {
  [SIGNUP_FIELDS.email]: 'Shopper@Example.com',
  [SIGNUP_FIELDS.emailConsent]: 'yes',
  [SIGNUP_FIELDS.emailConsentVersion]: EMAIL_CONSENT.version,
  [SIGNUP_FIELDS.surface]: 'footer',
};

type Harness = {deps: SignupDeps; klaviyo: FakeKlaviyo; store: RateLimitStore};

function harness(
  options: {
    respond?: Parameters<typeof fakeKlaviyo>[0];
    limits?: SignupGateLimits;
    sms?: boolean;
    noClient?: boolean;
    addressHeader?: string | null;
    store?: RateLimitStore;
  } = {},
): Harness {
  const klaviyo = fakeKlaviyo(options.respond);
  const store =
    options.store ?? createInMemoryRateLimitStore({now: () => 1_000});
  return {
    klaviyo,
    store,
    deps: {
      client: options.noClient ? null : klaviyo,
      sms: options.sms ?? false,
      gate: createSignupGate({
        store,
        hash: plainHash,
        limits: options.limits ?? GENEROUS,
      }),
      addressHeader:
        options.addressHeader === undefined
          ? ADDRESS_HEADER
          : options.addressHeader,
    },
  };
}

let ipCounter = 0;
function nextIp(): string {
  ipCounter += 1;
  return `198.51.100.${ipCounter % 250}`;
}

function post(
  fields: Record<string, string>,
  headers: Record<string, string> = {},
  init: {method?: string; body?: BodyInit; contentType?: string} = {},
): Request {
  return new Request(`${ORIGIN}/signup`, {
    method: init.method ?? 'POST',
    headers: {
      Origin: ORIGIN,
      [ADDRESS_HEADER]: nextIp(),
      ...(init.contentType ? {'Content-Type': init.contentType} : {}),
      ...headers,
    },
    body: init.body ?? new URLSearchParams(fields),
  });
}

/** Everything the code wrote to the console, as one string per line. */
function captureLogs(): string[] {
  const lines: string[] = [];
  vi.spyOn(console, 'warn').mockImplementation((line: unknown) => {
    lines.push(String(line));
  });
  vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
    lines.push(String(line));
  });
  return lines;
}

function snapshot(result: SignupHttpResult) {
  return {
    status: result.status,
    body: result.response,
    headers: Object.fromEntries(result.headers.entries()),
  };
}

describe('a good signup (REQ-ANL-003, NFR-011)', () => {
  it('subscribes the lower-cased address once, with the consent version and surface as the stored source', async () => {
    const {deps, klaviyo} = harness();
    const result = await handleSignup(post(GOOD_FORM), deps);
    expect(result.status).toBe(200);
    expect(result.response).toEqual({
      status: 'ok',
      message: SIGNUP_MESSAGES.ok,
    });
    expect(klaviyo.calls).toEqual([
      {
        email: 'shopper@example.com',
        phone: null,
        source: 'Storefront footer signup form (email-v1)',
      },
    ]);
  });

  it('records WHERE and WHICH WORDING: the home surface and the SMS version appear in the source', async () => {
    const {deps, klaviyo} = harness({sms: true});
    await handleSignup(
      post({
        ...GOOD_FORM,
        [SIGNUP_FIELDS.surface]: 'home',
        [SIGNUP_FIELDS.phone]: '212-555-0100',
        [SIGNUP_FIELDS.smsConsent]: 'yes',
        [SIGNUP_FIELDS.smsConsentVersion]: SMS_CONSENT.version,
      }),
      deps,
    );
    expect(klaviyo.calls).toEqual([
      {
        email: 'shopper@example.com',
        phone: '+12125550100',
        source: `Storefront home signup form (email-v1, ${SMS_CONSENT.version})`,
      },
    ]);
  });

  it('consentSource is fixed text from allow-listed values only', () => {
    expect(
      consentSource({
        email: 'a@example.com',
        surface: 'footer',
        emailConsentVersion: 'email-v1',
        strayFill: false,
        sms: null,
      }),
    ).toBe('Storefront footer signup form (email-v1)');
  });

  it('answers with private, uncacheable, noindex headers', async () => {
    const {deps} = harness();
    const {headers} = await handleSignup(post(GOOD_FORM), deps);
    expect(headers.get('Cache-Control')).toBe('private, no-store');
    expect(headers.get('Vary')).toBe('Cookie');
    expect(headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
  });

  it('does not depend on the analytics consent banner: no cookie or consent state is read', async () => {
    const {deps, klaviyo} = harness();
    // A request that says it has declined analytics (the banner's cookie) still signs up: marketing email is its own act.
    const result = await handleSignup(
      post(GOOD_FORM, {Cookie: 'mf_consent=declined'}),
      deps,
    );
    expect(result.response.status).toBe('ok');
    expect(klaviyo.calls).toHaveLength(1);
  });
});

describe('consent is explicit, never assumed (NFR-011, T-16)', () => {
  it.each([
    ['unticked (field absent)', undefined],
    ['empty', ''],
    ['"on"', 'on'],
    ['"true"', 'true'],
  ])(
    'a form with the box %s is refused and nothing is sent',
    async (_label, value) => {
      const {deps, klaviyo} = harness();
      const fields: Record<string, string> = {...GOOD_FORM};
      if (value === undefined) delete fields[SIGNUP_FIELDS.emailConsent];
      else fields[SIGNUP_FIELDS.emailConsent] = value;
      const result = await handleSignup(post(fields), deps);
      expect(result.status).toBe(422);
      expect(result.response).toMatchObject({
        status: 'invalid',
        errors: {consent: expect.stringContaining('Tick the box')},
      });
      expect(klaviyo.calls).toHaveLength(0);
    },
  );

  it('a form built for other wording is refused as out of date, not recorded as consent', async () => {
    const {deps, klaviyo} = harness();
    const result = await handleSignup(
      post({...GOOD_FORM, [SIGNUP_FIELDS.emailConsentVersion]: 'email-v0'}),
      deps,
    );
    expect(result.status).toBe(422);
    expect(result.response).toMatchObject({
      status: 'invalid',
      errors: {form: expect.stringContaining('out of date')},
    });
    expect(klaviyo.calls).toHaveLength(0);
  });

  it('SMS fields are ignored when SMS is off, so a stray phone never reaches Klaviyo', async () => {
    const {deps, klaviyo} = harness({sms: false});
    await handleSignup(
      post({
        ...GOOD_FORM,
        [SIGNUP_FIELDS.phone]: '212-555-0100',
        [SIGNUP_FIELDS.smsConsent]: 'yes',
        [SIGNUP_FIELDS.smsConsentVersion]: SMS_CONSENT.version,
      }),
      deps,
    );
    expect(klaviyo.calls).toHaveLength(1);
    expect(klaviyo.calls[0]?.phone).toBeNull();
  });

  it('a number without its own SMS consent is refused: email consent does not cover text messages', async () => {
    const {deps, klaviyo} = harness({sms: true});
    const result = await handleSignup(
      post({...GOOD_FORM, [SIGNUP_FIELDS.phone]: '212-555-0100'}),
      deps,
    );
    expect(result.status).toBe(422);
    expect(klaviyo.calls).toHaveLength(0);
  });
});

describe('the answer never reveals what Klaviyo already knows (no enumeration)', () => {
  it('gives the same status, body and headers whichever address is sent', async () => {
    const {deps} = harness();
    const a = await handleSignup(
      post({...GOOD_FORM, [SIGNUP_FIELDS.email]: 'new.person@example.com'}),
      deps,
    );
    const b = await handleSignup(
      post({
        ...GOOD_FORM,
        [SIGNUP_FIELDS.email]: 'already.on.list@example.org',
      }),
      deps,
    );
    expect(snapshot(a)).toEqual(snapshot(b));
    expect(JSON.stringify(a.response)).not.toMatch(
      /already|new|subscribed|exists/i,
    );
  });

  it('answers a bot (filled honeypot) exactly like a real signup, and calls nothing', async () => {
    const {deps, klaviyo} = harness();
    const real = await handleSignup(post(GOOD_FORM), deps);
    const bot = await handleSignup(
      post({...GOOD_FORM, [SIGNUP_FIELDS.honeypot]: 'http://spam.example'}),
      deps,
    );
    expect(snapshot(bot)).toEqual(snapshot(real));
    expect(klaviyo.calls).toHaveLength(1);
  });

  it('a honeypot bot with no valid address or consent still gets the thank-you', async () => {
    const {deps, klaviyo} = harness();
    const bot = await handleSignup(
      post({
        [SIGNUP_FIELDS.honeypot]: 'x',
        [SIGNUP_FIELDS.email]: 'nope',
      }),
      deps,
    );
    expect(bot.response).toEqual({status: 'ok', message: SIGNUP_MESSAGES.ok});
    expect(klaviyo.calls).toHaveLength(0);
  });

  it('the thank-you message is true for a new, a known and a pending-confirmation address', () => {
    expect(SIGNUP_MESSAGES.ok).toMatch(/received your request/);
    expect(SIGNUP_MESSAGES.ok).toMatch(/If we need you to confirm/);
    expect(SIGNUP_MESSAGES.ok).not.toMatch(/subscribed|added|welcome back/i);
  });
});

describe('hostile input is refused at the boundary and never echoed', () => {
  const HOSTILE = [
    'a@example.com\r\nBcc: victim@example.com',
    '<script>alert(1)</script>@example.com',
    '"><img src=x onerror=alert(1)>@example.com',
    "x'; DROP TABLE profiles;--@example.com",
    'a@example.com, b@example.com',
    `${'a'.repeat(300)}@example.com`,
    '{"email":"x@example.com"}',
    '../../etc/passwd',
  ];

  it.each(HOSTILE)(
    'refuses the address %j without calling Klaviyo or echoing it',
    async (value) => {
      const {deps, klaviyo} = harness();
      const result = await handleSignup(
        post({...GOOD_FORM, [SIGNUP_FIELDS.email]: value}),
        deps,
      );
      expect(result.status).toBe(422);
      expect(klaviyo.calls).toHaveLength(0);
      const text = JSON.stringify(result.response);
      expect(text).not.toContain('script');
      expect(text).not.toContain('DROP');
      expect(text).not.toContain('passwd');
      expect(text).not.toContain('Bcc');
    },
  );

  it('refuses a tampered surface and consent version', async () => {
    const {deps, klaviyo} = harness();
    for (const patch of [
      {[SIGNUP_FIELDS.surface]: 'admin'},
      {[SIGNUP_FIELDS.surface]: '<script>'},
      {[SIGNUP_FIELDS.emailConsentVersion]: '../x'},
    ]) {
      const result = await handleSignup(post({...GOOD_FORM, ...patch}), deps);
      expect(result.status).toBe(422);
    }
    expect(klaviyo.calls).toHaveLength(0);
  });

  it('refuses a JSON body, a body without a content type, and an oversized body', async () => {
    const {deps, klaviyo} = harness();
    const json = await handleSignup(
      post(
        {},
        {},
        {
          body: JSON.stringify(GOOD_FORM),
          contentType: 'application/json',
        },
      ),
      deps,
    );
    const bare = await handleSignup(
      post({}, {}, {body: 'email=a%40example.com'}),
      deps,
    );
    const big = await handleSignup(
      post(
        {...GOOD_FORM, filler: 'x'.repeat(6000)},
        {'Content-Type': 'application/x-www-form-urlencoded'},
      ),
      deps,
    );
    for (const result of [json, bare, big]) {
      expect(result.status).toBe(400);
      expect(result.response.status).toBe('invalid');
    }
    expect(klaviyo.calls).toHaveLength(0);
  });
});

describe('request guards: method, origin, configuration', () => {
  it.each(['GET', 'PUT', 'DELETE', 'PATCH'])(
    'answers %s with 405 and Allow: POST, and does nothing',
    async (method) => {
      const {deps, klaviyo} = harness();
      const request = new Request(`${ORIGIN}/signup`, {
        method,
        headers: {Origin: ORIGIN},
      });
      const result = await handleSignup(request, deps);
      expect(result.status).toBe(405);
      expect(result.headers.get('Allow')).toBe('POST');
      expect(klaviyo.calls).toHaveLength(0);
    },
  );

  it.each([
    ['a foreign Origin', {Origin: 'https://evil.example'}],
    ['a null Origin', {Origin: 'null'}],
    [
      'cross-site fetch metadata and no Origin',
      {Origin: '', 'Sec-Fetch-Site': 'cross-site'},
    ],
  ])(
    'refuses %s with 403, nothing sent and nothing counted',
    async (_label, headers) => {
      const {deps, klaviyo} = harness({
        limits: {
          ...GENEROUS,
          perAddress: {limit: 1, windowMs: 60_000},
        },
      });
      const address = '203.0.113.50';
      const cleaned = Object.fromEntries(
        Object.entries(headers).filter(([, v]) => v !== ''),
      );
      const request = new Request(`${ORIGIN}/signup`, {
        method: 'POST',
        headers: {[ADDRESS_HEADER]: address, ...cleaned},
        body: new URLSearchParams(GOOD_FORM),
      });
      const result = await handleSignup(request, deps);
      expect(result.status).toBe(403);
      expect(klaviyo.calls).toHaveLength(0);
      // The refused request did not use up the allowance of that address.
      const next = await handleSignup(
        post(GOOD_FORM, {[ADDRESS_HEADER]: address}),
        deps,
      );
      expect(next.status).toBe(200);
    },
  );

  it('fails closed when Klaviyo is not configured: unavailable, nothing faked, no gate use', async () => {
    const base = createInMemoryRateLimitStore({now: () => 1_000});
    const reserve = vi.fn(() => ({allowed: true as const}));
    const {deps, klaviyo} = harness({
      noClient: true,
      store: {...base, reserve},
    });
    const result = await handleSignup(post(GOOD_FORM), deps);
    expect(result.status).toBe(503);
    expect(result.response).toEqual({
      status: 'unavailable',
      message: SIGNUP_MESSAGES.unavailable,
    });
    expect(klaviyo.calls).toHaveLength(0);
    expect(reserve).not.toHaveBeenCalled();
  });
});

describe('Klaviyo failures never break the page (NFR-013)', () => {
  it.each([
    'timeout',
    'network',
    'server',
    'auth',
    'rate_limited',
    'config',
    'unexpected_2xx',
    'unexpected',
  ] as const)(
    'a %s failure is a friendly retry message, status 503, one attempt',
    async (reason) => {
      const {deps, klaviyo} = harness({respond: failing(reason)});
      const result = await handleSignup(post(GOOD_FORM), deps);
      expect(result.status).toBe(503);
      expect(result.response).toEqual({
        status: 'unavailable',
        message: SIGNUP_MESSAGES.unavailable,
      });
      expect(klaviyo.calls).toHaveLength(1);
    },
  );

  it('a refusal of this one request tells the shopper to check the details, without naming Klaviyo or a field', async () => {
    const {deps} = harness({respond: failing('rejected')});
    const result = await handleSignup(post(GOOD_FORM), deps);
    expect(result.status).toBe(422);
    expect(result.response).toMatchObject({status: 'invalid'});
    expect(JSON.stringify(result.response)).not.toMatch(/klaviyo/i);
  });

  it('a Klaviyo client that throws (against its contract) still gives "try again later", not an error page', async () => {
    const lines = captureLogs();
    const {deps} = harness();
    const throwing: SignupDeps = {
      ...deps,
      client: {
        subscribe: () => Promise.reject(new Error('boom shopper@example.com')),
      },
    };
    const result = await handleSignup(post(GOOD_FORM), throwing);
    expect(result.status).toBe(503);
    expect(result.response.status).toBe('unavailable');
    expect(lines.join('\n')).not.toContain('shopper@');
  });
});

describe('rate limiting (T-13, R-27)', () => {
  const TIGHT: SignupGateLimits = {
    perAddress: {limit: 2, windowMs: 60_000},
    perAddressDaily: {limit: 1000, windowMs: 86_400_000},
    sharedAddressDaily: {limit: 1000, windowMs: 86_400_000},
    perEmailDaily: {limit: 1000, windowMs: 86_400_000},
    perPhoneDaily: {limit: 1000, windowMs: 86_400_000},
    sharedAddress: {limit: 3, windowMs: 60_000},
    perEmail: {limit: 2, windowMs: 60_000},
    overall: {limit: 100, windowMs: 60_000},
  };

  it('refuses the attempt after the per-address limit with 429, a Retry-After and a fixed message', async () => {
    const {deps, klaviyo} = harness({limits: TIGHT});
    const address = '203.0.113.9';
    const statuses: number[] = [];
    let last: SignupHttpResult | null = null;
    for (let i = 0; i < 3; i += 1) {
      last = await handleSignup(
        post(
          {...GOOD_FORM, [SIGNUP_FIELDS.email]: `user${i}@example.com`},
          {[ADDRESS_HEADER]: address},
        ),
        deps,
      );
      statuses.push(last.status);
    }
    expect(statuses).toEqual([200, 200, 429]);
    expect(last?.response).toEqual({
      status: 'rate_limited',
      message: SIGNUP_MESSAGES.rateLimited,
    });
    expect(Number(last?.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1);
    expect(last?.headers.get('Cache-Control')).toBe('private, no-store');
    expect(klaviyo.calls).toHaveLength(2);
  });

  it('refuses the third request for one mailbox from three different clients, "+tag" included (email-bombing guard)', async () => {
    const {deps, klaviyo} = harness({limits: TIGHT});
    const tags = [
      'victim+a@example.com',
      'victim+b@example.com',
      'victim@example.com',
    ];
    const statuses: number[] = [];
    for (const email of tags) {
      const result = await handleSignup(
        post({...GOOD_FORM, [SIGNUP_FIELDS.email]: email}),
        deps,
      );
      statuses.push(result.status);
    }
    expect(statuses).toEqual([200, 200, 429]);
    expect(klaviyo.calls).toHaveLength(2);
  });

  it('counts a honeypot hit and an invalid form against the address, so a bot is slowed down too', async () => {
    const {deps, klaviyo} = harness({limits: TIGHT});
    const address = '203.0.113.10';
    const statuses: number[] = [];
    for (const fields of [
      {...GOOD_FORM, [SIGNUP_FIELDS.honeypot]: 'x'},
      {...GOOD_FORM, [SIGNUP_FIELDS.email]: 'bad'},
      GOOD_FORM,
    ]) {
      statuses.push(
        (await handleSignup(post(fields, {[ADDRESS_HEADER]: address}), deps))
          .status,
      );
    }
    expect(statuses).toEqual([200, 422, 429]);
    expect(klaviyo.calls).toHaveLength(0);
  });

  it('with no trusted address header all callers share one bucket and a client-sent address header is ignored', async () => {
    const {deps} = harness({limits: TIGHT, addressHeader: null});
    const statuses: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      const result = await handleSignup(
        post(
          {...GOOD_FORM, [SIGNUP_FIELDS.email]: `user${i}@example.com`},
          {
            'x-real-ip': `203.0.113.${i + 1}`,
            'x-forwarded-for': `203.0.113.${i + 100}`,
          },
        ),
        deps,
      );
      statuses.push(result.status);
    }
    // sharedAddress allows 3, then refuses, whatever address headers the client rotates.
    expect(statuses).toEqual([200, 200, 200, 429]);
  });

  it('a limiter that fails is "unavailable", never "allowed"', async () => {
    const base = createInMemoryRateLimitStore({now: () => 0});
    const store: RateLimitStore = {
      kind: base.kind,
      peek: base.peek,
      hit: base.hit,
      reserve() {
        throw new Error('store down');
      },
    };
    const {deps, klaviyo} = harness({store});
    const result = await handleSignup(post(GOOD_FORM), deps);
    expect(result.status).toBe(503);
    expect(klaviyo.calls).toHaveLength(0);
  });
});

describe('logs hold event names, codes and counts only (T-05)', () => {
  it('writes no address, phone, key, consent text or Klaviyo message for any outcome', async () => {
    const lines = captureLogs();
    const secrets = [
      'shopper',
      'example.com',
      '5550100',
      '212',
      'secret-key-value',
      'victim',
      EMAIL_CONSENT.text.slice(0, 20),
    ];
    const outcomes: Harness[] = [
      harness({sms: true}),
      harness({respond: failing('server')}),
      harness({respond: failing('rejected')}),
      harness({respond: failing('timeout')}),
      harness({noClient: true}),
      harness({
        limits: {...GENEROUS, perAddress: {limit: 1, windowMs: 60_000}},
      }),
    ];
    const address = '203.0.113.77';
    for (const {deps} of outcomes) {
      const send = (fields: Record<string, string>) =>
        handleSignup(post(fields, {[ADDRESS_HEADER]: address}), deps);
      await send({
        ...GOOD_FORM,
        [SIGNUP_FIELDS.email]: 'victim.shopper@example.com',
        [SIGNUP_FIELDS.phone]: '212-555-0100',
        [SIGNUP_FIELDS.smsConsent]: 'yes',
        [SIGNUP_FIELDS.smsConsentVersion]: SMS_CONSENT.version,
      });
      await send({
        ...GOOD_FORM,
        [SIGNUP_FIELDS.honeypot]: 'victim.shopper@example.com',
      });
      await send({...GOOD_FORM, [SIGNUP_FIELDS.email]: 'victim shopper'});
      await send(GOOD_FORM);
    }
    await handleSignup(
      new Request(`${ORIGIN}/signup`, {
        method: 'GET',
        headers: {Origin: ORIGIN},
      }),
      outcomes[0]?.deps ?? harness().deps,
    );
    expect(lines.length).toBeGreaterThan(5);
    for (const line of lines) {
      const parsed: unknown = JSON.parse(line);
      expect(typeof parsed).toBe('object');
      for (const secret of secrets) {
        expect(line).not.toContain(secret);
      }
      expect(line).toMatch(/"event":"signup\.[a-z_]+"/);
    }
  });

  it('names each outcome with a code a runbook can match', async () => {
    const lines = captureLogs();
    await handleSignup(post(GOOD_FORM), harness().deps);
    await handleSignup(
      post(GOOD_FORM),
      harness({respond: failing('auth')}).deps,
    );
    const events = lines.map(
      (line) => (JSON.parse(line) as {event: string}).event,
    );
    expect(events).toContain('signup.completed');
    expect(events).toContain('signup.upstream_failed');
  });
});

describe('signupDepsFromEnv: wiring from the request-context env', () => {
  const ENV = {
    KLAVIYO_PRIVATE_API_KEY: 'fixture-private-key-not-real-0000',
    KLAVIYO_LIST_ID: 'AbC123',
    TRUSTED_CLIENT_IP_HEADER: 'x-real-ip',
  };

  it('builds a client, reads the trusted address header name, and shares one counter set per instance', () => {
    const a = signupDepsFromEnv(ENV, {allowUnapprovedSms: false});
    const b = signupDepsFromEnv(ENV, {allowUnapprovedSms: false});
    expect(a.client).not.toBeNull();
    expect(a.addressHeader).toBe('x-real-ip');
    expect(a.sms).toBe(false);
    expect(a.gate).toBe(b.gate);
  });

  it('has no client and no SMS when the signup is not configured', () => {
    const deps = signupDepsFromEnv({}, {allowUnapprovedSms: true});
    expect(deps.client).toBeNull();
    expect(deps.sms).toBe(false);
  });

  it('calls Klaviyo only on the allow-listed host, with the key, through the injected fetch', async () => {
    const calls: string[] = [];
    const deps = signupDepsFromEnv(
      {...ENV, TRUSTED_CLIENT_IP_HEADER: 'x-real-ip'},
      {allowUnapprovedSms: false},
      (url, init) => {
        calls.push(`${url}|${init.headers.revision ?? ''}`);
        return Promise.resolve(new Response(null, {status: 202}));
      },
    );
    const result = await handleSignup(post(GOOD_FORM), deps);
    expect(result.status).toBe(200);
    expect(calls).toEqual([
      'https://a.klaviyo.com/api/profile-subscription-bulk-create-jobs|2026-10-15',
    ]);
  });
});

describe('one phone number cannot be enrolled over and over (SU-M3, T-16)', () => {
  const SMS_FORM = {
    ...GOOD_FORM,
    [SIGNUP_FIELDS.phone]: '212-555-0100',
    [SIGNUP_FIELDS.smsConsent]: 'yes',
    [SIGNUP_FIELDS.smsConsentVersion]: SMS_CONSENT.version,
  };

  it('refuses the third enrolment of one number in a day, whatever the email or address, and sends nothing for it', async () => {
    const {deps, klaviyo} = harness({
      sms: true,
      limits: {...GENEROUS, perPhoneDaily: {limit: 2, windowMs: 86_400_000}},
    });
    const statuses: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const result = await handleSignup(
        post({...SMS_FORM, [SIGNUP_FIELDS.email]: `user${i}@example.com`}),
        deps,
      );
      statuses.push(result.status);
    }
    expect(statuses).toEqual([200, 200, 429]);
    expect(klaviyo.calls).toHaveLength(2);
  });

  it('counts the same number written differently as one number', async () => {
    const {deps} = harness({
      sms: true,
      limits: {...GENEROUS, perPhoneDaily: {limit: 1, windowMs: 86_400_000}},
    });
    const first = await handleSignup(post(SMS_FORM), deps);
    const second = await handleSignup(
      post({
        ...SMS_FORM,
        [SIGNUP_FIELDS.email]: 'other@example.com',
        [SIGNUP_FIELDS.phone]: '+1 (212) 555 0100',
      }),
      deps,
    );
    expect([first.status, second.status]).toEqual([200, 429]);
  });

  it('does not count a number that would not be enrolled (no SMS consent, or SMS off)', async () => {
    const limits = {
      ...GENEROUS,
      perPhoneDaily: {limit: 1, windowMs: 86_400_000},
    };
    const withoutConsent = harness({sms: true, limits});
    const off = harness({sms: false, limits});
    for (const {deps} of [withoutConsent, off]) {
      for (let i = 0; i < 3; i += 1) {
        const result = await handleSignup(
          post({
            ...GOOD_FORM,
            [SIGNUP_FIELDS.email]: `user${i}@example.com`,
            ...(deps.sms ? {} : SMS_FORM),
            [SIGNUP_FIELDS.phone]: '212-555-0100',
          }),
          deps,
        );
        // With SMS on and no consent the form is refused (422); with SMS off the number is ignored (200).
        expect(result.status).not.toBe(429);
      }
    }
  });
});
