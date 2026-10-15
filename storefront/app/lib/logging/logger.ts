// Structured, redacted server logging (P7-08, NFR-010, T-05). Every `console` call in `app/` goes through here.
//
// One event is one JSON line: `{"level":"warn","event":"search.failed","errorName":"Error"}`. The event name is a
// short dotted identifier from a closed vocabulary (docs/handover/RUNBOOKS.md, alert definitions); the other
// fields are ids, codes and counts, run through the redaction layer before they are written. The host decides
// where the lines go and when they alert (Q-003); this module only guarantees what they contain.
//
// The project lint allows `console.warn` and `console.error` only, so `info` events travel on `warn` with their
// own `level` field intact (the same convention the Extend logger already used).

import {redactValue} from '~/lib/logging/redact';

export type LogLevel = 'info' | 'warn' | 'error';
export type LogFields = Readonly<Record<string, unknown>>;

export type LogSink = {
  readonly warn: (line: string) => void;
  readonly error: (line: string) => void;
};

const consoleSink: LogSink = {
  warn: (line) => console.warn(line),
  error: (line) => console.error(line),
};

// Lower-case dotted identifiers only, so an event name can never carry free text (and so personal data).
const EVENT_NAME = /^[a-z][a-z0-9_]{0,40}(?:\.[a-z0-9_]{1,40}){0,3}$/;
export const INVALID_EVENT_NAME = 'logging.invalid_event_name';

// These two are set by the logger; a field of the same name cannot overwrite them.
const RESERVED_FIELDS: ReadonlySet<string> = new Set(['level', 'event']);

/**
 * The JSON line for one event. Total: if anything unexpected happens the line says so instead of throwing,
 * because a logging failure must never break a request.
 */
export function formatLogEvent(
  level: LogLevel,
  event: string,
  fields: LogFields = {},
): string {
  try {
    const safe = redactValue(fields);
    const body: Record<string, unknown> = {};
    if (safe !== null && typeof safe === 'object' && !Array.isArray(safe)) {
      for (const [key, value] of Object.entries(safe)) {
        if (!RESERVED_FIELDS.has(key)) body[key] = value;
      }
    }
    return JSON.stringify({
      level,
      event: EVENT_NAME.test(event) ? event : INVALID_EVENT_NAME,
      ...body,
    });
  } catch {
    return JSON.stringify({level: 'error', event: 'logging.format_failed'});
  }
}

export function logEvent(
  level: LogLevel,
  event: string,
  fields: LogFields = {},
  sink: LogSink = consoleSink,
): void {
  const line = formatLogEvent(level, event, fields);
  try {
    if (level === 'error') sink.error(line);
    else sink.warn(line);
  } catch {
    // A broken sink must not break the request.
  }
}

export const logInfo = (event: string, fields?: LogFields): void =>
  logEvent('info', event, fields);
export const logWarn = (event: string, fields?: LogFields): void =>
  logEvent('warn', event, fields);
export const logError = (event: string, fields?: LogFields): void =>
  logEvent('error', event, fields);

/**
 * The only thing logged about a caught error: its class name, in the `errorName` field. A message or cause of a
 * failed Storefront call can hold the query, its variables and a cart id with its access key (N-L4, T-05).
 */
export function errorFields(error: unknown): LogFields {
  return {
    errorName:
      error instanceof Error && error.name !== ''
        ? error.name
        : 'non-error value thrown',
  };
}
