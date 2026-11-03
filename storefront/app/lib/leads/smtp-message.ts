// SERVER ONLY. Builds the raw text of one plain-text email (RFC 5322 / MIME) for the SMTP client (CR-33, DEC-145). Pure.
//
// The body is base64 (UTF-8), so a name with accents, or a stray line break in a field, can never change the headers or
// the SMTP conversation. The subject is fixed ASCII text; addresses were validated in smtp-config.ts. Every header value
// is checked once more here for line breaks, as the last guard.

export type MailMessage = {
  readonly from: string;
  readonly to: string;
  readonly cc: readonly string[];
  readonly subject: string;
  readonly text: string;
  readonly date: Date;
  /** A random unique part for the Message-ID. */
  readonly id: string;
};

function header(name: string, value: string): string {
  if (/[\r\n]/.test(value)) throw new Error(`Line break in header ${name}`);
  return `${name}: ${value}`;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function wrap76(text: string): string {
  return (text.match(/.{1,76}/g) ?? []).join('\r\n');
}

/** RFC 5322 date with a numeric zone ("Tue, 03 Nov 2026 10:00:00 +0000"). */
function rfcDate(date: Date): string {
  return date.toUTCString().replace('GMT', '+0000');
}

export function buildMessage(message: MailMessage): string {
  const domain = message.from.split('@')[1] ?? 'localhost';
  const headers = [
    header('From', message.from),
    header('To', message.to),
    ...(message.cc.length > 0 ? [header('Cc', message.cc.join(', '))] : []),
    header('Subject', message.subject),
    header('Date', rfcDate(message.date)),
    header('Message-ID', `<${message.id}@${domain}>`),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
  ];
  const body = wrap76(toBase64(new TextEncoder().encode(message.text)));
  return `${headers.join('\r\n')}\r\n\r\n${body}\r\n`;
}
