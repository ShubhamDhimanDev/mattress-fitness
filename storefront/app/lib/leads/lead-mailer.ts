// SERVER ONLY. Emails one visit request to the store team over SMTP (CR-33, DEC-145). Glue between the pure pieces
// (smtp-config, visit-request, smtp-message) and the SMTP client, with the client injectable for tests.

import {sendMail, type SmtpFailureReason} from '~/lib/leads/smtp-client';
import {readSmtpConfig, type SmtpConfig} from '~/lib/leads/smtp-config';
import {buildMessage} from '~/lib/leads/smtp-message';
import {
  VISIT_EMAIL_SUBJECT,
  visitEmailText,
  type VisitRequest,
} from '~/lib/leads/visit-request';

export type SendVisitResult =
  | {readonly status: 'sent'}
  | {readonly status: 'failed'; readonly reason: SmtpFailureReason};

export type VisitMailer = {
  send(request: VisitRequest): Promise<SendVisitResult>;
};

type Send = (config: SmtpConfig, raw: string) => ReturnType<typeof sendMail>;

/** Null when the SMTP settings or the recipient are missing or malformed: nothing is faked. */
export function createVisitMailer(options: {
  readonly env: object;
  readonly send?: Send;
  readonly now?: () => Date;
  readonly newId?: () => string;
}): VisitMailer | null {
  const read = readSmtpConfig(options.env);
  if (read.status !== 'ready') return null;
  const {config} = read;
  const send = options.send ?? sendMail;
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? (() => crypto.randomUUID());

  return {
    async send(request) {
      const date = now();
      const raw = buildMessage({
        from: config.from,
        to: config.to,
        cc: config.cc,
        subject: VISIT_EMAIL_SUBJECT,
        text: visitEmailText(request, date),
        date,
        id: newId(),
      });
      const result = await send(config, raw);
      return result.status === 'sent'
        ? {status: 'sent'}
        : {status: 'failed', reason: result.reason};
    },
  };
}

/** Names of the settings that are missing or malformed, for the log. Never values. */
export function missingMailSettings(env: object): readonly string[] {
  const read = readSmtpConfig(env);
  return read.status === 'ready' ? [] : read.missing;
}
