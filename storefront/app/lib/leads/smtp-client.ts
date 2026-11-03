// SERVER ONLY. A small SMTP client: one connection, one message (CR-33, DEC-145, T-05).
//
// Why hand-written: the server bundle is one self-contained file (ADR-0011) and a mail library would bring in the Node
// network modules at load time. Here `node:net` and `node:tls` are imported only when a message is sent, so a host
// without them (Shopify Oxygen, the local `vite dev` worker) loads the app normally and the send answers
// `unsupported_runtime`. The form then says it cannot send; nothing is faked. Plain Node (the VPS, ADR-0011) is the
// supported host.
//
// Conversation: greeting, EHLO, STARTTLS (when SMTP_SECURITY=starttls; refused if the server does not offer it, so
// the login and the message are never sent unencrypted by accident), AUTH PLAIN or LOGIN, MAIL FROM, one RCPT TO per
// recipient (any refusal fails the send), DATA, QUIT. Certificates are always verified. Reply TEXT is never kept or
// logged (it can echo an address); only the failure reason and the numeric code are returned.
//
// UNVERIFIED against a real mail server; the plain (no TLS) path is covered by a fake server in tests, the TLS paths are not.

import type {Socket} from 'node:net';
import type {TLSSocket} from 'node:tls';
import type {SmtpConfig} from '~/lib/leads/smtp-config';
import {toBase64} from '~/lib/leads/smtp-message';

export type SmtpFailureReason =
  | 'unsupported_runtime'
  | 'connect'
  | 'timeout'
  | 'protocol'
  | 'tls_required'
  | 'auth'
  | 'rejected';

export type SmtpSendResult =
  | {readonly status: 'sent'}
  | {
      readonly status: 'failed';
      readonly reason: SmtpFailureReason;
      /** The server's numeric reply code when there was one. */
      readonly code?: number;
    };

const STEP_TIMEOUT_MS = 10_000;

class SmtpFailure extends Error {
  constructor(
    readonly reason: SmtpFailureReason,
    readonly code?: number,
  ) {
    super(reason);
  }
}

type Reply = {readonly code: number; readonly lines: readonly string[]};
type Waiter = {
  readonly resolve: (reply: Reply) => void;
  readonly reject: (error: SmtpFailure) => void;
  readonly timer: ReturnType<typeof setTimeout>;
};

/** Reads server replies off a socket, one complete (possibly multi-line) reply at a time. */
class Conversation {
  private socket: Socket;
  private buffer = '';
  private partial: string[] = [];
  private readonly queue: Reply[] = [];
  private failure: SmtpFailure | null = null;
  private waiter: Waiter | null = null;

  constructor(socket: Socket) {
    this.socket = socket;
    this.listen(socket);
  }

  private readonly onData = (chunk: string | Uint8Array): void => {
    this.buffer +=
      typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
    for (;;) {
      const end = this.buffer.indexOf('\n');
      if (end === -1) break;
      const line = this.buffer.slice(0, end).replace(/\r$/, '');
      this.buffer = this.buffer.slice(end + 1);
      this.partial.push(line);
      // "250-more" continues; "250 done" (or a bare "250") ends the reply.
      if (/^\d{3}( |$)/.test(line)) {
        const code = Number(line.slice(0, 3));
        this.queue.push({
          code,
          lines: this.partial.map((entry) => entry.slice(4)),
        });
        this.partial = [];
      }
    }
    this.deliver();
  };

  private readonly onFail = (): void => {
    this.failure ??= new SmtpFailure('connect');
    this.deliver();
  };

  // No setEncoding here: a plain socket is handed to the TLS layer on STARTTLS and must still carry raw bytes.
  private listen(socket: Socket): void {
    socket.on('data', this.onData);
    socket.on('error', this.onFail);
    socket.on('close', this.onFail);
  }

  /** Before STARTTLS: the TLS layer reads the raw socket itself, so our reader must stop. Errors stay handled. */
  stopReading(): void {
    this.socket.off('data', this.onData);
  }

  /** Moves to the encrypted socket after STARTTLS. */
  switchTo(socket: TLSSocket): void {
    this.socket.off('error', this.onFail);
    this.socket.off('close', this.onFail);
    this.socket = socket;
    this.buffer = '';
    this.partial = [];
    this.listen(socket);
  }

  private deliver(): void {
    const waiter = this.waiter;
    if (waiter === null) return;
    const reply = this.queue.shift();
    if (reply !== undefined) {
      this.waiter = null;
      clearTimeout(waiter.timer);
      waiter.resolve(reply);
    } else if (this.failure !== null) {
      this.waiter = null;
      clearTimeout(waiter.timer);
      waiter.reject(this.failure);
    }
  }

  read(): Promise<Reply> {
    return new Promise<Reply>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = null;
        reject(new SmtpFailure('timeout'));
      }, STEP_TIMEOUT_MS);
      this.waiter = {resolve, reject, timer};
      this.deliver();
    });
  }

  write(text: string): void {
    this.socket.write(text);
  }

  destroy(): void {
    this.socket.destroy();
  }
}

async function expectCode(
  conversation: Conversation,
  allowed: readonly number[],
  failWith: SmtpFailureReason = 'protocol',
): Promise<Reply> {
  const reply = await conversation.read();
  if (!allowed.includes(reply.code))
    throw new SmtpFailure(failWith, reply.code);
  return reply;
}

async function command(
  conversation: Conversation,
  line: string,
  allowed: readonly number[],
  failWith?: SmtpFailureReason,
): Promise<Reply> {
  conversation.write(`${line}\r\n`);
  return expectCode(conversation, allowed, failWith);
}

type Modules = {
  readonly net: typeof import('node:net');
  readonly tls: typeof import('node:tls');
};

async function loadModules(): Promise<Modules | null> {
  try {
    const [net, tls] = await Promise.all([
      import('node:net'),
      import('node:tls'),
    ]);
    return {net, tls};
  } catch {
    return null;
  }
}

function open(modules: Modules, config: SmtpConfig): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const implicit = config.security === 'tls';
    const socket = implicit
      ? modules.tls.connect({
          host: config.host,
          port: config.port,
          servername: config.host,
        })
      : modules.net.connect({host: config.host, port: config.port});
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new SmtpFailure('timeout'));
    }, STEP_TIMEOUT_MS);
    socket.once(implicit ? 'secureConnect' : 'connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('error', () => {
      clearTimeout(timer);
      reject(new SmtpFailure('connect'));
    });
  });
}

function upgrade(
  modules: Modules,
  socket: Socket,
  host: string,
): Promise<TLSSocket> {
  return new Promise((resolve, reject) => {
    const secure = modules.tls.connect({socket, servername: host});
    const timer = setTimeout(() => {
      secure.destroy();
      reject(new SmtpFailure('timeout'));
    }, STEP_TIMEOUT_MS);
    secure.once('secureConnect', () => {
      clearTimeout(timer);
      resolve(secure);
    });
    secure.once('error', () => {
      clearTimeout(timer);
      reject(new SmtpFailure('tls_required'));
    });
  });
}

function capabilities(reply: Reply): string[] {
  return reply.lines.map((line) => line.toUpperCase());
}

async function authenticate(
  conversation: Conversation,
  offered: readonly string[],
  auth: NonNullable<SmtpConfig['auth']>,
): Promise<void> {
  const mechanisms = offered
    .filter((line) => line.startsWith('AUTH'))
    .flatMap((line) => line.split(/[ =]/));
  const encode = (text: string): string =>
    toBase64(new TextEncoder().encode(text));
  if (mechanisms.includes('PLAIN')) {
    await command(
      conversation,
      `AUTH PLAIN ${encode(`\u0000${auth.user}\u0000${auth.password}`)}`,
      [235],
      'auth',
    );
    return;
  }
  if (mechanisms.includes('LOGIN')) {
    await command(conversation, 'AUTH LOGIN', [334], 'auth');
    await command(conversation, encode(auth.user), [334], 'auth');
    await command(conversation, encode(auth.password), [235], 'auth');
    return;
  }
  throw new SmtpFailure('auth');
}

async function converse(
  modules: Modules,
  config: SmtpConfig,
  raw: string,
): Promise<void> {
  const socket = await open(modules, config);
  const conversation = new Conversation(socket);
  try {
    await expectCode(conversation, [220]);
    // The name we introduce ourselves with: the sender's own domain.
    const me = config.from.split('@')[1] ?? 'localhost';
    let hello = await command(conversation, `EHLO ${me}`, [250]);

    if (config.security === 'starttls') {
      if (!capabilities(hello).includes('STARTTLS')) {
        throw new SmtpFailure('tls_required');
      }
      await command(conversation, 'STARTTLS', [220], 'tls_required');
      conversation.stopReading();
      conversation.switchTo(await upgrade(modules, socket, config.host));
      hello = await command(conversation, `EHLO ${me}`, [250]);
    }

    if (config.auth !== null) {
      await authenticate(conversation, capabilities(hello), config.auth);
    }

    await command(conversation, `MAIL FROM:<${config.from}>`, [250]);
    for (const recipient of [config.to, ...config.cc]) {
      await command(
        conversation,
        `RCPT TO:<${recipient}>`,
        [250, 251],
        'rejected',
      );
    }
    await command(conversation, 'DATA', [354]);
    // Dot-stuffing: a line starting with "." would end the message early.
    const stuffed = raw.replace(/^\./gm, '..');
    await command(
      conversation,
      `${stuffed.endsWith('\r\n') ? stuffed : `${stuffed}\r\n`}.`,
      [250],
    );
    conversation.write('QUIT\r\n');
  } finally {
    conversation.destroy();
  }
}

/** Sends one prepared message (see smtp-message.ts). Never throws; the answer says what failed, without any reply text. */
export async function sendMail(
  config: SmtpConfig,
  raw: string,
): Promise<SmtpSendResult> {
  const modules = await loadModules();
  if (modules === null) {
    return {status: 'failed', reason: 'unsupported_runtime'};
  }
  try {
    await converse(modules, config, raw);
    return {status: 'sent'};
  } catch (error) {
    if (error instanceof SmtpFailure) {
      return error.code === undefined
        ? {status: 'failed', reason: error.reason}
        : {status: 'failed', reason: error.reason, code: error.code};
    }
    return {status: 'failed', reason: 'connect'};
  }
}
