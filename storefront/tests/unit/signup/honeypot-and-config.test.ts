import {afterEach, describe, expect, it, vi} from 'vitest';
import {EMAIL_CONSENT} from '~/lib/signup/consent';
import {
  handleSignup,
  resetSignupStateForTests,
  type SignupDeps,
} from '~/lib/signup/handler';
import {createSignupGate, SIGNUP_GATE_LIMITS} from '~/lib/signup/limiter';
import {parseSignupForm} from '~/lib/signup/request';
import {SIGNUP_FIELDS, SIGNUP_MESSAGES} from '~/lib/signup/shared';
import {createInMemoryRateLimitStore} from '~/lib/orders/guest-lookup-limiter';
import {failing, fakeKlaviyo, type FakeKlaviyo} from './fake-klaviyo';

// REQ-ANL-003 / NFR-013, code review m4 (the honeypot must not silently lose a real signup) and m5 (a configuration
// fault is not blamed on the shopper). Fictional identities only; the network is a typed fake.

afterEach(() => {
  vi.restoreAllMocks();
  resetSignupStateForTests();
});

const ORIGIN = 'https://shop.example';
const GOOD = {
  [SIGNUP_FIELDS.email]: 'shopper@example.com',
  [SIGNUP_FIELDS.emailConsent]: 'yes',
  [SIGNUP_FIELDS.emailConsentVersion]: EMAIL_CONSENT.version,
  [SIGNUP_FIELDS.surface]: 'footer',
};

let ip = 0;
function post(fields: Record<string, string>): Request {
  ip += 1;
  return new Request(`${ORIGIN}/signup`, {
    method: 'POST',
    headers: {Origin: ORIGIN, 'x-real-ip': `198.51.100.${ip % 250}`},
    body: new URLSearchParams(fields),
  });
}

function harness(respond?: Parameters<typeof fakeKlaviyo>[0]): {
  deps: SignupDeps;
  klaviyo: FakeKlaviyo;
} {
  const klaviyo = fakeKlaviyo(respond);
  return {
    klaviyo,
    deps: {
      client: klaviyo,
      sms: false,
      gate: createSignupGate({
        store: createInMemoryRateLimitStore({now: () => 1000}),
        hash: (scope, value) => Promise.resolve(`${scope}#${value}`),
        limits: {
          ...SIGNUP_GATE_LIMITS,
          overall: {limit: 1000, windowMs: 60_000},
          perAddress: {limit: 1000, windowMs: 60_000},
          perAddressDaily: {limit: 1000, windowMs: 60_000},
          perEmail: {limit: 1000, windowMs: 60_000},
          perEmailDaily: {limit: 1000, windowMs: 60_000},
        },
      }),
      addressHeader: 'x-real-ip',
    },
  };
}

function captureLogs(): string[] {
  const lines: string[] = [];
  vi.spyOn(console, 'warn').mockImplementation((line: unknown) => {
    lines.push(String(line));
  });
  return lines;
}

const trapped = (age: string | undefined, value = 'autofilled') => ({
  ...GOOD,
  [SIGNUP_FIELDS.honeypot]: value,
  ...(age === undefined ? {} : {[SIGNUP_FIELDS.formAge]: age}),
});

describe('the honeypot field name and the form age (m4)', () => {
  it('uses a name no browser autofills', () => {
    expect(SIGNUP_FIELDS.honeypot).toBe('contact_me_by_fax_only');
    expect(SIGNUP_FIELDS.honeypot).not.toMatch(
      /website|url|company|email|phone|name|address|zip|city|org/i,
    );
  });

  it('parses a stray autofill (open for 2 s or more) as a signup, flagged', () => {
    for (const age of ['2000', '60000']) {
      const form = new FormData();
      for (const [k, v] of Object.entries(trapped(age))) form.append(k, v);
      expect(parseSignupForm(form, {sms: false})).toMatchObject({
        status: 'ok',
        input: {strayFill: true},
      });
    }
  });

  it('an ordinary signup is not flagged', () => {
    const form = new FormData();
    for (const [k, v] of Object.entries(GOOD)) form.append(k, v);
    expect(parseSignupForm(form, {sms: false})).toMatchObject({
      status: 'ok',
      input: {strayFill: false},
    });
  });
});

describe('the honeypot at the handler (m4)', () => {
  it.each([
    [
      'no age at all (no JavaScript, or a script that skips the page)',
      undefined,
    ],
    ['0 ms', '0'],
    ['500 ms', '500'],
    ['1999 ms', '1999'],
    ['an age that is not a number', 'soon'],
    ['a negative age', '-5'],
    ['a decimal age', '2500.5'],
    ['an over-long age string', '9'.repeat(30)],
  ])(
    'a filled honeypot with %s is a bot: the usual thank-you, nothing sent, logged as signup.honeypot',
    async (_label, age) => {
      const lines = captureLogs();
      const {deps, klaviyo} = harness();
      const result = await handleSignup(post(trapped(age)), deps);
      expect(result.response).toEqual({
        status: 'ok',
        message: SIGNUP_MESSAGES.ok,
      });
      expect(klaviyo.calls).toHaveLength(0);
      const text = lines.join('\n');
      expect(text).toContain('"event":"signup.honeypot"');
      expect(text).toContain('"outcome":"dropped"');
    },
  );

  it.each(['2000', '5000', '86400000'])(
    'a filled honeypot on a form that was open %s ms is an autofill: the signup goes ahead and the hit is logged',
    async (age) => {
      const lines = captureLogs();
      const {deps, klaviyo} = harness();
      const result = await handleSignup(post(trapped(age)), deps);
      expect(result.status).toBe(200);
      expect(klaviyo.calls).toHaveLength(1);
      const text = lines.join('\n');
      expect(text).toContain('"event":"signup.honeypot"');
      expect(text).toContain('"outcome":"ignored_autofill"');
      // The autofilled text and the address are never logged.
      expect(text).not.toContain('autofilled');
      expect(text).not.toContain('shopper');
    },
  );

  it('a file in the honeypot is a bot whatever the age', async () => {
    const {deps, klaviyo} = harness();
    const body = new FormData();
    for (const [name, value] of Object.entries(trapped('5000'))) {
      body.append(name, value);
    }
    body.set(SIGNUP_FIELDS.honeypot, new File(['x'], 'x.txt'));
    const result = await handleSignup(
      new Request(`${ORIGIN}/signup`, {
        method: 'POST',
        headers: {Origin: ORIGIN, 'x-real-ip': '198.51.100.250'},
        body,
      }),
      deps,
    );
    expect(result.response.status).toBe('ok');
    expect(klaviyo.calls).toHaveLength(0);
  });

  it('an empty honeypot with a form age is an ordinary signup and logs no honeypot event', async () => {
    const lines = captureLogs();
    const {deps, klaviyo} = harness();
    await handleSignup(post({...GOOD, [SIGNUP_FIELDS.formAge]: '8000'}), deps);
    expect(klaviyo.calls).toHaveLength(1);
    expect(lines.join('\n')).not.toContain('signup.honeypot');
  });
});

describe('configuration faults are not blamed on the shopper (m5)', () => {
  it('a configuration fault is a friendly retry (503) and the log carries the reason and the status number only', async () => {
    const lines = captureLogs();
    const {deps} = harness(() => ({
      status: 'failed',
      reason: 'config',
      httpStatus: 404,
    }));
    const result = await handleSignup(post(GOOD), deps);
    expect(result.status).toBe(503);
    expect(result.response).toEqual({
      status: 'unavailable',
      message: SIGNUP_MESSAGES.unavailable,
    });
    expect(JSON.stringify(result.response)).not.toMatch(
      /check your email|404/i,
    );
    const text = lines.join('\n');
    expect(text).toContain('"event":"signup.upstream_failed"');
    expect(text).toContain('"reason":"config"');
    expect(text).toContain('"httpStatus":404');
    expect(text).not.toContain('shopper');
  });

  it('only a refusal of this one request (other 4xx) asks the shopper to check the details', async () => {
    const {deps} = harness(failing('rejected'));
    const result = await handleSignup(post(GOOD), deps);
    expect(result.status).toBe(422);
    expect(result.response).toMatchObject({status: 'invalid'});
  });

  it('a 2xx other than 202 is not a success: friendly retry, reason unexpected_2xx', async () => {
    const lines = captureLogs();
    const {deps} = harness(() => ({
      status: 'failed',
      reason: 'unexpected_2xx',
      httpStatus: 200,
    }));
    const result = await handleSignup(post(GOOD), deps);
    expect(result.status).toBe(503);
    expect(result.response.status).toBe('unavailable');
    expect(lines.join('\n')).toContain('"reason":"unexpected_2xx"');
  });
});
