// SERVER ONLY. Newsletter signups emailed to the store team over SMTP, for a store with no Klaviyo account yet
// (REQ-ANL-003, CR-34). It is the same `subscribe` contract as the Klaviyo client, so every check in handler.ts (same
// origin, rate limit, honeypot, explicit consent, no personal data in logs) runs unchanged. The team receives one email
// per signup with the address and the consent wording version, and sends the discount coupon from there; a Klaviyo list
// replaces this when the account exists (Klaviyo wins whenever it is configured).
//
// Uses the SMTP settings of the "plan your visit" email (SMTP_*, LEAD_EMAIL_TO, LEAD_EMAIL_CC). Nothing is faked: without
// them there is no client and the signup stays off.

import {sendMail, type SmtpFailureReason} from '~/lib/leads/smtp-client';
import {readSmtpConfig, type SmtpConfig} from '~/lib/leads/smtp-config';
import {buildMessage} from '~/lib/leads/smtp-message';
import {EMAIL_CONSENT} from '~/lib/signup/consent';
import type {
  KlaviyoClient,
  SubscribeFailure,
  SubscribeRequest,
} from '~/lib/signup/klaviyo-client';

/** Fixed ASCII subject, so a shopper's input never reaches a header. */
export const SIGNUP_EMAIL_SUBJECT =
  'New newsletter signup (send the discount coupon)';

type Send = (config: SmtpConfig, raw: string) => ReturnType<typeof sendMail>;

/** True when the SMTP settings and the recipient are present and well formed. Used to decide if the signup is on. */
export function smtpSignupAvailable(env: object): boolean {
  return readSmtpConfig(env).status === 'ready';
}

/** What the team reads. The address was validated by the signup form handler before it gets here. */
export function signupEmailText(request: SubscribeRequest, date: Date): string {
  return [
    'A shopper asked for discount coupons and marketing emails.',
    '',
    `Email: ${request.email}`,
    `Received: ${date.toISOString()}`,
    `Where: ${request.source}`,
    '',
    'Consent given (unticked box the shopper ticked):',
    EMAIL_CONSENT.text,
    `Wording version: ${EMAIL_CONSENT.version}`,
    '',
    'Send the coupon from your mail tool and keep this email as the consent record.',
  ].join('\n');
}

// An SMTP refusal of OUR message is our configuration to fix, not the shopper's address, so it is never "rejected".
const REASONS: Record<SmtpFailureReason, SubscribeFailure> = {
  unsupported_runtime: 'config',
  connect: 'network',
  timeout: 'timeout',
  protocol: 'server',
  tls_required: 'config',
  auth: 'auth',
  rejected: 'config',
};

/** Null when SMTP is not configured: nothing is faked. */
export function createSmtpSubscriber(options: {
  readonly env: object;
  readonly send?: Send;
  readonly now?: () => Date;
  readonly newId?: () => string;
}): KlaviyoClient | null {
  const read = readSmtpConfig(options.env);
  if (read.status !== 'ready') return null;
  const {config} = read;
  const send = options.send ?? sendMail;
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? (() => crypto.randomUUID());

  return {
    async subscribe(request) {
      try {
        const date = now();
        const raw = buildMessage({
          from: config.from,
          to: config.to,
          cc: config.cc,
          subject: SIGNUP_EMAIL_SUBJECT,
          text: signupEmailText(request, date),
          date,
          id: newId(),
        });
        const result = await send(config, raw);
        return result.status === 'sent'
          ? {status: 'accepted'}
          : {status: 'failed', reason: REASONS[result.reason]};
      } catch {
        return {status: 'failed', reason: 'network'};
      }
    },
  };
}
