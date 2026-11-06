import {afterEach, describe, expect, it, vi} from 'vitest';
import {publicSignupConfig} from '~/lib/signup/config';
import {combineSubscribers} from '~/lib/signup/combined-subscriber';
import {resetSignupStateForTests} from '~/lib/signup/handler';
import {
  SIGNUP_EMAIL_SUBJECT,
  SIGNUP_EMAIL_SUBJECT_AUTOMATIC,
  createSmtpSubscriber,
  signupEmailText,
} from '~/lib/signup/smtp-subscriber';
import {
  WELCOME_EMAIL_SUBJECT,
  createWelcomeEmailSubscriber,
  welcomeEmailAvailable,
  welcomeEmailText,
} from '~/lib/signup/welcome-email';

// REQ-ANL-003 / CR-34: every signup is emailed its own promo code (owner request 2026-11-06). No network: the SMTP send is
// injected. Addresses are fictional.

afterEach(() => resetSignupStateForTests());

const SMTP_ENV = {
  SMTP_HOST: 'mail.example.com',
  SMTP_FROM: 'website@example.com',
  LEAD_EMAIL_TO: 'sales@example.com',
};
const ENV = SMTP_ENV;
const REQUEST = {
  email: 'shopper@example.com',
  phone: null,
  source: 'Storefront modal signup form (email-v1)',
};

function decoded(raw: string): string {
  return atob(raw.split('\r\n\r\n')[1]?.replace(/\r\n/g, '') ?? '');
}

describe('welcome email (promo code)', () => {
  it('is off without SMTP settings and on with them', () => {
    expect(createWelcomeEmailSubscriber({env: {}})).toBeNull();
    expect(welcomeEmailAvailable({})).toBe(false);
    expect(welcomeEmailAvailable({SMTP_HOST: 'mail.example.com'})).toBe(false);
    expect(welcomeEmailAvailable(SMTP_ENV)).toBe(true);
    expect(createWelcomeEmailSubscriber({env: SMTP_ENV})).not.toBeNull();
  });

  it('emails the code to the shopper, and only to the shopper', async () => {
    const send = vi.fn().mockResolvedValue({status: 'sent'});
    const client = createWelcomeEmailSubscriber({
      env: {...ENV, LEAD_EMAIL_CC: 'boss@example.com'},
      send,
      now: () => new Date('2026-11-06T10:00:00Z'),
      newId: () => 'id1',
    });
    expect(await client?.subscribe(REQUEST)).toEqual({status: 'accepted'});
    expect(send).toHaveBeenCalledTimes(1);
    const [config, raw] = send.mock.calls[0] as [
      {to: string; cc: string[]},
      string,
    ];
    expect(config.to).toBe('shopper@example.com');
    expect(config.cc).toEqual([]);
    expect(raw).toContain('To: shopper@example.com');
    expect(raw).not.toContain('sales@example.com');
    expect(raw).not.toContain('boss@example.com');
    expect(raw).toContain(`Subject: ${WELCOME_EMAIL_SUBJECT}`);
    expect(decoded(raw)).toBe(welcomeEmailText('WELCOME15'));
    expect(welcomeEmailText('WELCOME15')).toContain('WELCOME15');
    expect(welcomeEmailText('WELCOME15')).toMatch(/up to 15% off/);
  });

  it('refuses an address that could carry a header or SMTP injection', async () => {
    const send = vi.fn();
    const client = createWelcomeEmailSubscriber({env: ENV, send});
    for (const email of [
      'a@b.com\r\nBcc: x@y.com',
      'a b@example.com',
      '<a@b.com>',
    ]) {
      const result = await client?.subscribe({...REQUEST, email});
      expect(result?.status).toBe('failed');
    }
    expect(send).not.toHaveBeenCalled();
  });

  it('reports a mail failure as a failure, not as accepted', async () => {
    const send = vi.fn().mockResolvedValue({status: 'failed', reason: 'auth'});
    const client = createWelcomeEmailSubscriber({env: ENV, send});
    expect(await client?.subscribe(REQUEST)).toEqual({
      status: 'failed',
      reason: 'auth',
    });
  });
});

describe('team email when the code is sent automatically', () => {
  it('stops asking the team to send the coupon by hand', async () => {
    expect(signupEmailText(REQUEST, new Date())).toMatch(/Send the coupon/);
    expect(signupEmailText(REQUEST, new Date(), true)).not.toMatch(
      /Send the coupon/,
    );
    const send = vi.fn().mockResolvedValue({status: 'sent'});
    const client = createSmtpSubscriber({
      env: SMTP_ENV,
      send,
      couponSentAutomatically: true,
    });
    await client?.subscribe(REQUEST);
    const raw: string = send.mock.calls[0][1];
    expect(raw).toContain(`Subject: ${SIGNUP_EMAIL_SUBJECT_AUTOMATIC}`);
    expect(raw).not.toContain(SIGNUP_EMAIL_SUBJECT);
  });
});

describe('combineSubscribers with three destinations', () => {
  const accepted = {subscribe: async () => ({status: 'accepted'}) as const};
  const failed = {
    subscribe: async () => ({status: 'failed', reason: 'auth'}) as const,
  };

  it('is accepted when any one destination takes the signup, and fails only when all fail', async () => {
    expect(combineSubscribers(null, null, null)).toBeNull();
    expect(
      await combineSubscribers(failed, failed, accepted)?.subscribe(REQUEST),
    ).toEqual({status: 'accepted'});
    expect(
      await combineSubscribers(failed, null, failed)?.subscribe(REQUEST),
    ).toEqual({status: 'failed', reason: 'auth'});
  });

  it('runs every destination even when an earlier one fails', async () => {
    const spy = vi.fn().mockResolvedValue({status: 'accepted'});
    await combineSubscribers(
      failed,
      {subscribe: spy},
      {subscribe: spy},
    )?.subscribe(REQUEST);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe('public config', () => {
  it('tells the form it may promise a code when the welcome email is on', () => {
    const options = {allowUnapprovedSms: false};
    expect(publicSignupConfig({}, null, options)).toBeNull();
    expect(publicSignupConfig(SMTP_ENV, null, options)?.promo).toBe(true);
  });
});
