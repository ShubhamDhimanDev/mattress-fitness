// SERVER ONLY. The welcome email: every newsletter signup is emailed its own promo code (owner request 2026-11-06,
// REQ-ANL-003, CR-34). It has the same `subscribe` contract as the other destinations, so every check in handler.ts (same
// origin, rate limit, honeypot, explicit unticked consent) has already run.
//
// The code is ONE shared Shopify discount code (scripts/setup/newsletter-promo-code.mjs creates it, 15% off, once per
// customer); the email only carries its name, the constant PROMO_CODE in shared.ts (not an environment variable).
// Without the SMTP settings there is no client and no email (nothing is faked).
//
// Sent over the same SMTP settings as the team email, but TO THE SHOPPER: the recipient is rewritten here, never read
// from the form beyond the address the signup already validated. Logs carry reason codes only, never an address.

import {BRAND_NAME} from '~/lib/brand';
import {sendMail, type SmtpFailureReason} from '~/lib/leads/smtp-client';
import {
  isMailAddress,
  readSmtpConfig,
  type SmtpConfig,
} from '~/lib/leads/smtp-config';
import {buildMessage} from '~/lib/leads/smtp-message';
import {PROMO_CODE, PROMO_PERCENT} from '~/lib/signup/shared';
import type {
  KlaviyoClient,
  SubscribeFailure,
} from '~/lib/signup/klaviyo-client';

/** Fixed ASCII subject, so a shopper's input never reaches a header. */
export const WELCOME_EMAIL_SUBJECT = `Your ${PROMO_PERCENT}% off promo code`;

type Send = (config: SmtpConfig, raw: string) => ReturnType<typeof sendMail>;

/** True when the SMTP settings are present: the form may then promise the code. */
export function welcomeEmailAvailable(env: object): boolean {
  return readSmtpConfig(env).status === 'ready';
}

export function welcomeEmailText(code: string): string {
  return [
    `Thank you for joining the ${BRAND_NAME} email list.`,
    '',
    `Here is your promo code: ${code}`,
    '',
    `Save up to ${PROMO_PERCENT}% off. Enter the code in the discount box at checkout.`,
    'The code works once per customer, and some products or offers may be excluded.',
    '',
    'You can unsubscribe at any time.',
  ].join('\n');
}

const REASONS: Record<SmtpFailureReason, SubscribeFailure> = {
  unsupported_runtime: 'config',
  connect: 'network',
  timeout: 'timeout',
  protocol: 'server',
  tls_required: 'config',
  auth: 'auth',
  rejected: 'config',
};

/** Null when SMTP or the code is not configured: nothing is faked. */
export function createWelcomeEmailSubscriber(options: {
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
      // The handler validated the address already; this is the last guard before it reaches an SMTP command.
      if (!isMailAddress(request.email)) {
        return {status: 'failed', reason: 'rejected'};
      }
      try {
        const date = now();
        const raw = buildMessage({
          from: config.from,
          to: request.email,
          cc: [],
          subject: WELCOME_EMAIL_SUBJECT,
          text: welcomeEmailText(PROMO_CODE),
          date,
          id: newId(),
        });
        const result = await send({...config, to: request.email, cc: []}, raw);
        return result.status === 'sent'
          ? {status: 'accepted'}
          : {status: 'failed', reason: REASONS[result.reason]};
      } catch {
        return {status: 'failed', reason: 'network'};
      }
    },
  };
}
