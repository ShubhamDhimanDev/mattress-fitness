// What the server logs about a failed request (security re-review RR-M1, T-05). React Router's default, used when the
// server entry exports no `handleError`, is `console.error(error)`. For a failed Storefront call that prints the query
// and its variables (a cart id with its access key, a search term), and an error message can quote request data. This
// replaces it: the error's class name and the request path, through the redacting logger, nothing else.

import {errorFields, logError} from '~/lib/logging/logger';

/** The path of a request URL, without the query string or fragment; empty when the URL cannot be read. */
function requestPath(request: Request): string {
  try {
    return new URL(request.url).pathname;
  } catch {
    return '';
  }
}

/**
 * Logs a request error as one structured line: event `request.failed`, the class name of the error and the path.
 * An aborted request (the visitor went away) is not an error of ours and logs nothing. The message, the cause, the
 * stack, the query string and the variables are never read.
 */
export function logRequestError(error: unknown, request: Request): void {
  if (request.signal.aborted) return;
  logError('request.failed', {
    ...errorFields(error),
    path: requestPath(request),
  });
}
