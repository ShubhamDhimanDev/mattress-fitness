import {createServer, type Server, type Socket} from 'node:net';
import {afterEach, describe, expect, it} from 'vitest';
import {sendMail} from '~/lib/leads/smtp-client';
import {readSmtpConfig, type SmtpConfig} from '~/lib/leads/smtp-config';
import {buildMessage} from '~/lib/leads/smtp-message';

// CR-33 / DEC-145: the SMTP client against a fake server on localhost, and the settings parser. Only the plain
// (no TLS) path can be run here; the STARTTLS and TLS paths are UNVERIFIED against a real server.

const ENV = {
  SMTP_HOST: 'mail.example.com',
  SMTP_FROM: 'website@example.com',
  LEAD_EMAIL_TO: 'sales@example.com',
};

describe('readSmtpConfig', () => {
  it('needs host, sender and recipient', () => {
    const result = readSmtpConfig({});
    expect(result.status).toBe('not_configured');
    if (result.status === 'not_configured') {
      expect(result.missing).toEqual([
        'SMTP_HOST',
        'SMTP_FROM',
        'LEAD_EMAIL_TO',
      ]);
    }
  });

  it('defaults to STARTTLS on 587 and parses the cc list without duplicates', () => {
    const result = readSmtpConfig({
      ...ENV,
      LEAD_EMAIL_CC:
        ' a@example.com , b@example.com,a@example.com,sales@example.com',
    });
    expect(result.status).toBe('ready');
    if (result.status === 'ready') {
      expect(result.config.security).toBe('starttls');
      expect(result.config.port).toBe(587);
      expect(result.config.cc).toEqual(['a@example.com', 'b@example.com']);
      expect(result.config.auth).toBeNull();
    }
  });

  it('uses implicit TLS defaults and requires a user and password together', () => {
    const tls = readSmtpConfig({...ENV, SMTP_SECURITY: 'TLS'});
    expect(tls.status === 'ready' && tls.config.port).toBe(465);
    expect(readSmtpConfig({...ENV, SMTP_USER: 'u'}).status).toBe(
      'not_configured',
    );
    const both = readSmtpConfig({...ENV, SMTP_USER: 'u', SMTP_PASSWORD: 'p'});
    expect(both.status === 'ready' && both.config.auth).toEqual({
      user: 'u',
      password: 'p',
    });
  });

  it('refuses a login without encryption, bad ports and unsafe addresses', () => {
    const bad = (extra: Record<string, string>) =>
      readSmtpConfig({...ENV, ...extra}).status;
    expect(
      bad({SMTP_SECURITY: 'none', SMTP_USER: 'u', SMTP_PASSWORD: 'p'}),
    ).toBe('not_configured');
    expect(bad({SMTP_PORT: '99999'})).toBe('not_configured');
    expect(bad({SMTP_SECURITY: 'ssl'})).toBe('not_configured');
    expect(bad({LEAD_EMAIL_TO: 'a@example.com\r\nBcc: x@example.com'})).toBe(
      'not_configured',
    );
    expect(bad({SMTP_HOST: 'mail.example.com\r\nQUIT'})).toBe('not_configured');
  });

  it('never puts a value in the missing list', () => {
    const result = readSmtpConfig({...ENV, SMTP_PORT: 'secret-looking'});
    expect(JSON.stringify(result)).not.toContain('secret-looking');
  });
});

describe('buildMessage', () => {
  const base = {
    from: 'website@example.com',
    to: 'sales@example.com',
    cc: [],
    subject: 'Hello',
    text: 'Zoë wants a visit',
    date: new Date('2026-11-03T10:05:00Z'),
    id: 'id1',
  };

  it('builds headers and a base64 UTF-8 body', () => {
    const raw = buildMessage(base);
    expect(raw).toContain('Date: Tue, 03 Nov 2026 10:05:00 +0000');
    expect(raw).not.toContain('Cc:');
    const body = raw.split('\r\n\r\n')[1] ?? '';
    const bytes = Uint8Array.from(atob(body.replace(/\r\n/g, '')), (c) =>
      c.charCodeAt(0),
    );
    expect(new TextDecoder().decode(bytes)).toBe('Zoë wants a visit');
  });

  it('refuses a line break in a header', () => {
    expect(() =>
      buildMessage({...base, subject: 'Hi\r\nBcc: x@example.com'}),
    ).toThrow();
  });
});

type Script = {
  /** Replies the server gives to a command, by prefix. */
  readonly replies: Record<string, string>;
  readonly ehlo?: string;
};

type Seen = {commands: string[]; data: string};

function fakeServer(script: Script): Promise<{
  server: Server;
  port: number;
  seen: Seen;
}> {
  const seen: Seen = {commands: [], data: ''};
  const server = createServer((socket: Socket) => {
    socket.setEncoding('utf8');
    let inData = false;
    let buffer = '';
    socket.write('220 fake ready\r\n');
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      if (inData) {
        if (buffer.endsWith('\r\n.\r\n')) {
          seen.data = buffer;
          buffer = '';
          inData = false;
          socket.write('250 queued\r\n');
        }
        return;
      }
      for (;;) {
        const end = buffer.indexOf('\r\n');
        if (end === -1) return;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        seen.commands.push(line);
        if (line.startsWith('EHLO')) {
          socket.write(script.ehlo ?? '250-fake\r\n250 8BITMIME\r\n');
        } else if (line === 'DATA') {
          socket.write('354 go\r\n');
          inData = true;
          if (buffer !== '') {
            // Data arrived in the same chunk as the command.
            socket.emit('data', '');
          }
          return;
        } else if (line === 'QUIT') {
          socket.end('221 bye\r\n');
          return;
        } else {
          const key = Object.keys(script.replies).find((prefix) =>
            line.startsWith(prefix),
          );
          socket.write(
            key === undefined ? '250 ok\r\n' : (script.replies[key] ?? ''),
          );
        }
      }
    });
    socket.on('error', () => undefined);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        server,
        port: typeof address === 'object' && address ? address.port : 0,
        seen,
      });
    });
  });
}

let running: Server | null = null;
afterEach(() => {
  running?.close();
  running = null;
});

function configFor(port: number, extra: Partial<SmtpConfig> = {}): SmtpConfig {
  return {
    host: '127.0.0.1',
    port,
    security: 'none',
    auth: null,
    from: 'website@example.com',
    to: 'sales@example.com',
    cc: ['owner@example.com'],
    ...extra,
  };
}

describe('sendMail (plain, against a fake server)', () => {
  it('runs the conversation: every recipient, then the dot-stuffed message', async () => {
    const {server, port, seen} = await fakeServer({replies: {}});
    running = server;
    const raw = 'Subject: Hi\r\n\r\n.starts with a dot\r\n';
    expect(await sendMail(configFor(port), raw)).toEqual({status: 'sent'});
    expect(seen.commands).toEqual([
      'EHLO example.com',
      'MAIL FROM:<website@example.com>',
      'RCPT TO:<sales@example.com>',
      'RCPT TO:<owner@example.com>',
      'DATA',
    ]);
    expect(seen.data).toContain('\r\n..starts with a dot\r\n');
    expect(seen.data.endsWith('\r\n.\r\n')).toBe(true);
  });

  it('fails when a recipient is refused', async () => {
    const {server, port} = await fakeServer({
      replies: {'RCPT TO:<owner@': '550 no such user\r\n'},
    });
    running = server;
    expect(await sendMail(configFor(port), 'Subject: Hi\r\n\r\nx\r\n')).toEqual(
      {
        status: 'failed',
        reason: 'rejected',
        code: 550,
      },
    );
  });

  it('logs in with AUTH PLAIN when offered', async () => {
    const {server, port, seen} = await fakeServer({
      replies: {'AUTH PLAIN': '235 welcome\r\n'},
      ehlo: '250-fake\r\n250 AUTH PLAIN LOGIN\r\n',
    });
    running = server;
    const config = configFor(port, {auth: {user: 'u', password: 'p'}});
    expect(await sendMail(config, 'Subject: Hi\r\n\r\nx\r\n')).toEqual({
      status: 'sent',
    });
    const auth = seen.commands.find((line) => line.startsWith('AUTH PLAIN'));
    expect(atob((auth ?? '').slice('AUTH PLAIN '.length))).toBe(
      '\u0000u\u0000p',
    );
  });

  it('reports a refused login as auth', async () => {
    const {server, port} = await fakeServer({
      replies: {'AUTH PLAIN': '535 bad credentials\r\n'},
      ehlo: '250-fake\r\n250 AUTH PLAIN\r\n',
    });
    running = server;
    const config = configFor(port, {auth: {user: 'u', password: 'p'}});
    expect(await sendMail(config, 'x')).toEqual({
      status: 'failed',
      reason: 'auth',
      code: 535,
    });
  });

  it('refuses to continue when STARTTLS is required but not offered', async () => {
    const {server, port, seen} = await fakeServer({replies: {}});
    running = server;
    const result = await sendMail(configFor(port, {security: 'starttls'}), 'x');
    expect(result).toEqual({status: 'failed', reason: 'tls_required'});
    expect(seen.commands).not.toContain('DATA');
  });

  it('reports an unreachable server as connect', async () => {
    const {server, port} = await fakeServer({replies: {}});
    await new Promise((resolve) => server.close(resolve));
    const result = await sendMail(configFor(port), 'x');
    expect(result).toEqual({status: 'failed', reason: 'connect'});
  });
});
