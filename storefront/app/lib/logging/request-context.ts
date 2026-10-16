// What identifies one request in a log line, without personal data (P7-08, T-05): the path (never the query string,
// which can carry search text, a ZIP or a cart key) and a request id to line up the events of one request.
//
// The id is the host's own when it sends one in a header and the value is a plain token; otherwise a random UUID made
// here, so a line is always correlatable with the other lines of the same request even on a host that sends nothing
// (Q-003: which header, if any, the final host sets is not verified, so none is assumed). A client can send any of
// these headers, so the value is accepted only in a narrow shape and is never trusted for anything but this label.

const REQUEST_ID_HEADERS: readonly string[] = [
  'x-request-id',
  'request-id',
  'cf-ray',
];
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{7,63}$/;
const MAX_PATH_CHARS = 100;

export type RequestLogFields = {
  readonly path: string;
  readonly requestId: string;
};

/** The pathname only, cut to a log-line size; a URL that cannot be parsed gives a fixed marker. */
export function pathOf(request: Request): string {
  try {
    return new URL(request.url).pathname.slice(0, MAX_PATH_CHARS);
  } catch {
    return '[invalid-url]';
  }
}

function headerRequestId(request: Request): string | null {
  for (const name of REQUEST_ID_HEADERS) {
    const value = request.headers.get(name)?.trim();
    if (value !== undefined && REQUEST_ID.test(value)) return value;
  }
  return null;
}

/** Path and request id for an event about this request. Total: it never throws. */
export function requestLogFields(request: Request): RequestLogFields {
  return {
    path: pathOf(request),
    requestId: headerRequestId(request) ?? crypto.randomUUID(),
  };
}
