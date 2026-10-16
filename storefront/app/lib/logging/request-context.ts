// What identifies one request in a log line, without personal data (P7-08, T-05): the path (never the query string,
// which can carry search text, a ZIP or a cart key) and a request id to line up the events of one request.
//
// The id is the host's own when it sends one in a header the client cannot choose and the value is a plain token;
// otherwise a random UUID made here, so a line is always correlatable with the other lines of the same request even
// on a host that sends nothing (Q-003: which header, if any, the final host sets is not verified, so none is
// assumed). `cf-ray` is written by Cloudflare at the edge and overwrites any client value; `x-request-id` and
// `request-id` are whatever the caller sent, so a client could pick an id that collides with or imitates another
// request (S-L2). They are logged only as a separate `clientRequestId` field, never as `requestId`.

const HOST_REQUEST_ID_HEADER = 'cf-ray';
const CLIENT_REQUEST_ID_HEADERS: readonly string[] = [
  'x-request-id',
  'request-id',
];
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{7,63}$/;
const MAX_PATH_CHARS = 100;

// Route patterns whose next segment is a secret or an identifier of one shopper's data: a discount code, a cart id,
// an order id. The segment is replaced, not cut, so the route stays recognisable in a log (S-L2, T-05).
const SENSITIVE_SEGMENTS: readonly RegExp[] = [
  /^(\/+discount\/)[^/]+/i,
  /^(\/+cart\/c\/)[^/]+/i,
  /^(\/+account\/orders\/)[^/]+/i,
];
const REDACTED_SEGMENT = '[redacted]';

export type RequestLogFields = {
  readonly path: string;
  readonly requestId: string;
  /** What the caller said its id was: a label to search by, never an identity. Absent when none or malformed. */
  readonly clientRequestId?: string;
};

/** The path with the secret segment of the routes listed above replaced. */
export function redactPath(pathname: string): string {
  for (const pattern of SENSITIVE_SEGMENTS) {
    if (pattern.test(pathname)) {
      return pathname.replace(pattern, `$1${REDACTED_SEGMENT}`);
    }
  }
  return pathname;
}

/** The pathname only, with secret segments replaced and cut to a log-line size; an unparsable URL gives a fixed marker. */
export function pathOf(request: Request): string {
  try {
    return redactPath(new URL(request.url).pathname).slice(0, MAX_PATH_CHARS);
  } catch {
    return '[invalid-url]';
  }
}

function plainToken(request: Request, name: string): string | null {
  const value = request.headers.get(name)?.trim();
  return value !== undefined && REQUEST_ID.test(value) ? value : null;
}

function clientRequestId(request: Request): string | null {
  for (const name of CLIENT_REQUEST_ID_HEADERS) {
    const value = plainToken(request, name);
    if (value !== null) return value;
  }
  return null;
}

/** Path and request id for an event about this request. Total: it never throws. */
export function requestLogFields(request: Request): RequestLogFields {
  const fields = {
    path: pathOf(request),
    requestId:
      plainToken(request, HOST_REQUEST_ID_HEADER) ?? crypto.randomUUID(),
  };
  const client = clientRequestId(request);
  return client === null ? fields : {...fields, clientRequestId: client};
}
