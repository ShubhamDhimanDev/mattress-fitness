import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  createInMemoryRateLimitStore,
  type KeyHasher,
} from '~/lib/orders/guest-lookup-limiter';
import {publicSignupConfig} from '~/lib/signup/config';
import {EMAIL_CONSENT} from '~/lib/signup/consent';
import {
  handleSignup,
  resetSignupStateForTests,
  signupDepsFromEnv,
} from '~/lib/signup/handler';
import {createSignupGate} from '~/lib/signup/limiter';
import {SIGNUP_FIELDS, SIGNUP_SURFACES} from '~/lib/signup/shared';
import {
  SIGNUP_EMAIL_SUBJECT,
  createSmtpSubscriber,
  signupEmailText,
  smtpSignupAvailable,
} from '~/lib/signup/smtp-subscriber';

// REQ-ANL-003 / CR-34: newsletter signups emailed to the store team over SMTP while there is no Klaviyo account. Same
// handler, same checks; only the destination differs. No network: the SMTP send is injected. Addresses are fictional.

afterEach(() => resetSignupStateForTests());

const SMTP_ENV = {
  SMTP_HOST: 'mail.example.com',
  SMTP_FROM: 'website@example.com',
  LEAD_EMAIL_TO: 'sales@example.com',
};
const NOW = new Date('2026-11-05T10:00:00Z');
const REQUEST = {
  email: 'shopper@example.com',
  phone: null,
  source: 'Storefront modal signup form (email-v1)',
};

describe('smtp subscriber (CR-34)', () => {
  it('is off without SMTP settings and on with them', () => {
    expect(createSmtpSubscriber({env: {}})).toBeNull();
    expect(smtpSignupAvailable({})).toBe(false);
    expect(smtpSignupAvailable({SMTP_HOST: 'mail.example.com'})).toBe(false);
    expect(smtpSignupAvailable(SMTP_ENV)).toBe(true);
  });

  it('emails the team one message with the address and the consent record', async () => {
    const send = vi.fn().mockResolvedValue({status: 'sent'});
    const client = createSmtpSubscriber({
      env: SMTP_ENV,
      send,
      now: () => NOW,
      newId: () => 'id1',
    });
    expect(await client?.subscribe(REQUEST)).toEqual({status: 'accepted'});
    expect(send).toHaveBeenCalledTimes(1);
    const raw: string = send.mock.calls[0][1];
    expect(raw).toContain('To: sales@example.com');
    expect(raw).toContain(`Subject: ${SIGNUP_EMAIL_SUBJECT}`);
    const text = signupEmailText(REQUEST, NOW);
    expect(text).toContain('Email: shopper@example.com');
    expect(text).toContain(EMAIL_CONSENT.version);
    expect(text).toContain('2026-11-05T10:00:00.000Z');
  });

  it.each([
    ['timeout', 'timeout'],
    ['connect', 'network'],
    ['auth', 'auth'],
    // Our own mail refusal is our configuration to fix, never the shopper's address.
    ['rejected', 'config'],
    ['tls_required', 'config'],
    ['protocol', 'server'],
  ] as const)('maps the SMTP failure %s to %s', async (reason, expected) => {
    const client = createSmtpSubscriber({
      env: SMTP_ENV,
      send: () => Promise.resolve({status: 'failed', reason}),
    });
    expect(await client?.subscribe(REQUEST)).toEqual({
      status: 'failed',
      reason: expected,
    });
  });

  it('never throws: a send that throws is a network failure', async () => {
    const client = createSmtpSubscriber({
      env: SMTP_ENV,
      send: () => Promise.reject(new Error('boom')),
    });
    expect(await client?.subscribe(REQUEST)).toEqual({
      status: 'failed',
      reason: 'network',
    });
  });
});

describe('the signup is on with SMTP alone (CR-34)', () => {
  it('shows the form config without text messages, and nothing when neither is set', () => {
    expect(publicSignupConfig({}, null, {allowUnapprovedSms: true})).toBeNull();
    expect(
      publicSignupConfig(SMTP_ENV, '/policies/privacy-policy', {
        allowUnapprovedSms: true,
      }),
      // SMTP also turns the welcome email (promo code) on, so the form may promise the code.
    ).toEqual({
      sms: false,
      promo: true,
      privacyHref: '/policies/privacy-policy',
    });
  });

  it('gives the handler a client only when something is configured, and no SMS', () => {
    const off = signupDepsFromEnv({}, {allowUnapprovedSms: true});
    expect(off.client).toBeNull();
    const smtp = signupDepsFromEnv(SMTP_ENV, {allowUnapprovedSms: true});
    expect(smtp.client).not.toBeNull();
    expect(smtp.sms).toBe(false);
  });

  it('accepts the modal surface, and still refuses one it does not know', async () => {
    expect(SIGNUP_SURFACES).toContain('modal');
    const hash: KeyHasher = (scope, value) =>
      Promise.resolve(`${scope}#${value}`);
    const calls: string[] = [];
    const deps = {
      client: {
        subscribe(request: {source: string}) {
          calls.push(request.source);
          return Promise.resolve({status: 'accepted' as const});
        },
      },
      sms: false,
      gate: createSignupGate({
        store: createInMemoryRateLimitStore({now: () => 1_000}),
        hash,
      }),
      addressHeader: null,
    };
    const send = (surface: string, ip: string) =>
      handleSignup(
        new Request('https://shop.example/signup', {
          method: 'POST',
          headers: {Origin: 'https://shop.example', 'x-real-ip': ip},
          body: new URLSearchParams({
            [SIGNUP_FIELDS.email]: 'shopper@example.com',
            [SIGNUP_FIELDS.emailConsent]: 'yes',
            [SIGNUP_FIELDS.emailConsentVersion]: EMAIL_CONSENT.version,
            [SIGNUP_FIELDS.surface]: surface,
          }),
        }),
        deps,
      );
    expect((await send('modal', '198.51.100.1')).status).toBe(200);
    expect(calls[0]).toContain('modal');
    expect((await send('popup', '198.51.100.2')).status).toBe(422);
    expect(calls).toHaveLength(1);
  });
});
