import {afterEach, describe, expect, it} from 'vitest';
import {createVisitMailer} from '~/lib/leads/lead-mailer';
import type {SmtpSendResult} from '~/lib/leads/smtp-client';
import type {SmtpConfig} from '~/lib/leads/smtp-config';
import {
  handleVisitRequest,
  resetVisitStateForTests,
  visitDepsFromEnv,
  type VisitDeps,
} from '~/lib/leads/visit-handler';
import {
  parseVisitForm,
  visitEmailText,
  type VisitRequest,
} from '~/lib/leads/visit-request';

// CR-33 / DEC-145 / T-05 / T-13: the visit request flow with a fake mail sender. No network. Every identity is fictional
// (555 numbers, example.* domains).

afterEach(() => resetVisitStateForTests());

const GOOD = {
  budget: '1500-2499',
  visitWindow: 'within-7-days',
  name: 'Sam Rivers Jr',
  phone: '(212) 555-0100',
  zip: '10001',
};

function formOf(fields: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return form;
}

const ENV = {
  SMTP_HOST: 'mail.example.com',
  SMTP_FROM: 'website@example.com',
  LEAD_EMAIL_TO: 'sales@example.com',
  LEAD_EMAIL_CC: 'owner@example.com, manager@example.com',
};

const REQUEST: VisitRequest = {
  budget: '1500-2499',
  visitWindow: 'within-7-days',
  firstName: 'Sam',
  lastName: 'Rivers Jr',
  phone: '+12125550100',
  zip: '10001',
};

type Call = {config: SmtpConfig; raw: string};

function fakeSend(answer: SmtpSendResult = {status: 'sent'}) {
  const calls: Call[] = [];
  const send = (config: SmtpConfig, raw: string): Promise<SmtpSendResult> => {
    calls.push({config, raw});
    return Promise.resolve(answer);
  };
  return {send, calls};
}

describe('parseVisitForm', () => {
  it('accepts a good form and splits the name', () => {
    expect(parseVisitForm(formOf(GOOD))).toEqual({
      status: 'ok',
      request: REQUEST,
    });
  });

  it('rejects unknown options, a bad phone and a bad ZIP with field messages', () => {
    const parsed = parseVisitForm(
      formOf({...GOOD, budget: 'free', phone: '123', zip: 'abc'}),
    );
    expect(parsed.status).toBe('invalid');
    if (parsed.status === 'invalid') {
      expect(Object.keys(parsed.errors).sort()).toEqual([
        'budget',
        'phone',
        'zip',
      ]);
    }
  });

  it('treats a filled honeypot as a bot', () => {
    expect(parseVisitForm(formOf({...GOOD, website: 'x'}))).toEqual({
      status: 'honeypot',
    });
  });

  it('writes the answers in words into the email text', () => {
    const text = visitEmailText(REQUEST, new Date('2026-11-03T10:05:00Z'));
    expect(text).toContain('Name: Sam Rivers Jr');
    expect(text).toContain('Phone: (212) 555-0100');
    expect(text).toContain('Budget: $1,500–$2,499');
    expect(text).toContain('Can visit: Within 7 days');
    expect(text).toContain('Received: 2026-11-03 10:05 UTC');
  });
});

describe('createVisitMailer', () => {
  it('is null without the settings or with an invalid recipient', () => {
    expect(createVisitMailer({env: {}})).toBeNull();
    expect(
      createVisitMailer({env: {...ENV, LEAD_EMAIL_TO: 'not an address'}}),
    ).toBeNull();
    expect(
      createVisitMailer({env: {...ENV, LEAD_EMAIL_CC: 'ok@example.com, bad'}}),
    ).toBeNull();
  });

  it('sends one message to the recipient with the cc list and a base64 body', async () => {
    const {send, calls} = fakeSend();
    const mailer = createVisitMailer({
      env: ENV,
      send,
      now: () => new Date('2026-11-03T10:05:00Z'),
      newId: () => 'abc123',
    });
    expect(await mailer?.send(REQUEST)).toEqual({status: 'sent'});
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.config.to).toBe('sales@example.com');
    expect(call?.config.cc).toEqual([
      'owner@example.com',
      'manager@example.com',
    ]);
    expect(call?.raw).toContain('To: sales@example.com');
    expect(call?.raw).toContain('Cc: owner@example.com, manager@example.com');
    expect(call?.raw).toContain('Message-ID: <abc123@example.com>');
    expect(call?.raw).toContain('Content-Transfer-Encoding: base64');
    expect(call?.raw).not.toContain('Sam Rivers');
    const body = (call?.raw ?? '').split('\r\n\r\n')[1] ?? '';
    expect(atob(body.replace(/\r\n/g, ''))).toContain('Name: Sam Rivers Jr');
  });

  it('passes a failure reason through', async () => {
    const mailer = createVisitMailer({
      env: ENV,
      send: fakeSend({status: 'failed', reason: 'auth', code: 535}).send,
    });
    expect(await mailer?.send(REQUEST)).toEqual({
      status: 'failed',
      reason: 'auth',
    });
  });
});

describe('handleVisitRequest', () => {
  function post(
    fields: Record<string, string>,
    headers: Record<string, string> = {},
  ): Request {
    return new Request('https://shop.example/visit-request', {
      method: 'POST',
      headers: {Origin: 'https://shop.example', ...headers},
      body: new URLSearchParams(fields),
    });
  }

  function deps(
    answer: SmtpSendResult = {status: 'sent'},
    env: object = ENV,
  ): {deps: VisitDeps; calls: Call[]} {
    const {send, calls} = fakeSend(answer);
    return {deps: visitDepsFromEnv(env, {send}), calls};
  }

  it('is unavailable (503) when the mail settings are missing, and sends nothing', async () => {
    const {deps: d, calls} = deps(undefined, {});
    const result = await handleVisitRequest(post(GOOD), d);
    expect(result.status).toBe(503);
    expect(result.response.status).toBe('unavailable');
    expect(calls).toHaveLength(0);
  });

  it('refuses GET and cross-origin posts', async () => {
    const get = await handleVisitRequest(
      new Request('https://shop.example/visit-request'),
      deps().deps,
    );
    expect(get.status).toBe(405);
    const cross = await handleVisitRequest(
      post(GOOD, {Origin: 'https://evil.example'}),
      deps().deps,
    );
    expect(cross.status).toBe(403);
  });

  it('answers 422 with field errors for invalid input, and sends nothing', async () => {
    const {deps: d, calls} = deps();
    const result = await handleVisitRequest(post({...GOOD, phone: 'nope'}), d);
    expect(result.status).toBe(422);
    expect(result.response.status).toBe('invalid');
    expect(calls).toHaveLength(0);
  });

  it('thanks a honeypot post without sending an email', async () => {
    const {deps: d, calls} = deps();
    const result = await handleVisitRequest(
      post({...GOOD, website: 'spam'}),
      d,
    );
    expect(result.status).toBe(200);
    expect(calls).toHaveLength(0);
  });

  it('emails a valid request and answers ok; a failed send is a friendly 503', async () => {
    const ok = deps();
    const sent = await handleVisitRequest(post(GOOD), ok.deps);
    expect(sent.status).toBe(200);
    expect(sent.response.status).toBe('ok');
    expect(ok.calls).toHaveLength(1);

    const failed = await handleVisitRequest(
      post(GOOD),
      deps({status: 'failed', reason: 'connect'}).deps,
    );
    expect(failed.status).toBe(503);
  });

  it('rate limits one phone number after two requests a day', async () => {
    const {deps: d} = deps();
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) {
      statuses.push((await handleVisitRequest(post(GOOD), d)).status);
    }
    expect(statuses).toEqual([200, 200, 429]);
  });
});
