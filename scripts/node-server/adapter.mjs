// Adapter between Node's http server and the storefront's Web-standard `fetch(request, env, ctx)` handler
// (ADR-0010). It owns what Oxygen provides for free: turning a Node request into a Web Request (with the right scheme
// and host behind a TLS proxy), writing a Web Response back (several Set-Cookie headers, streamed bodies), serving the
// built client assets, `waitUntil`, a request-size limit, a health check and graceful shutdown.
//
// It adds no behaviour of its own to a storefront response: the security headers are applied by the storefront's own
// server.ts inside the built bundle (DEC-045), on every response that the bundle produces. The only responses made
// here are static assets, the health check and the 400/413/500 answers below, and they carry the few headers that
// make sense without the storefront code; the reverse proxy adds the rest for those (VPS_RUNBOOK.md).

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

// Only types the build actually emits. `.map` is deliberately absent: source maps are not served (they would
// publish the source), and neither are `.html` files or anything unknown.
const CONTENT_TYPES = Object.freeze({
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
});

const HOST_PATTERN = /^(?:[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?|\[[0-9A-Fa-f:.]{2,45}\])(?::\d{1,5})?$/;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

/** Name of an error, never its message (a message can carry a query or a cart id, N-L4, T-05). */
export function errorName(error) {
  return error instanceof Error && error.name !== '' ? error.name : 'non-error value thrown';
}

/**
 * The scheme the application should see. Session and cart cookies are `Secure` only when the request URL is https
 * (app/lib/session.ts), and HSTS follows the scheme, so behind a TLS-terminating proxy the entry must report https.
 * The forwarded header is believed only when the operator says a proxy sets it (TRUST_PROXY) and only the first
 * value counts, as in the application.
 *
 * @param {{trustProxy: boolean, forwardedProto: string | undefined, encrypted: boolean}} input
 * @returns {'http' | 'https'}
 */
export function resolveScheme({ trustProxy, forwardedProto, encrypted }) {
  if (trustProxy && forwardedProto !== undefined) {
    const first = forwardedProto.split(',')[0]?.trim().toLowerCase();
    if (first === 'https' || first === 'http') return first;
  }
  return encrypted ? 'https' : 'http';
}

/** @param {string | undefined} hostHeader */
export function isValidHost(hostHeader) {
  return typeof hostHeader === 'string' && HOST_PATTERN.test(hostHeader);
}

/**
 * Absolute path of a static file for a URL path, or null when the path must not be served from disk: anything with a
 * dot-prefixed segment (this also rejects `..` and `.gitkeep`), a backslash or NUL, an extension that is not in the
 * table, or a result outside `clientDir`.
 *
 * @param {string} clientDir absolute
 * @param {string} pathname a URL pathname (percent-encoded)
 * @returns {string | null}
 */
export function resolveStaticPath(clientDir, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const segments = decoded.split('/').filter((segment) => segment !== '');
  if (segments.length === 0) return null;
  if (segments.some((segment) => segment.startsWith('.'))) return null;
  const extension = path.extname(segments[segments.length - 1] ?? '').toLowerCase();
  if (!Object.hasOwn(CONTENT_TYPES, extension)) return null;
  const file = path.join(clientDir, ...segments);
  return file.startsWith(clientDir + path.sep) ? file : null;
}

/** Hashed build output never changes under its name; everything else may be replaced by a later release. */
export function staticCacheControl(pathname) {
  return pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600';
}

// The conditional header (HSTS) is left to the reverse proxy; the rest do not depend on the request. Keep in step with
// storefront/app/lib/security-headers.ts. Only answers made here carry these; everything the storefront makes has its own.
const PLAIN_RESPONSE_HEADERS = Object.freeze({
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'cross-origin-opener-policy': 'same-origin-allow-popups',
});

function plain(res, status, text, extra = {}) {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
    ...PLAIN_RESPONSE_HEADERS,
    ...extra,
  });
  res.end(text);
}

async function serveStatic(req, res, file, pathname) {
  let stat;
  try {
    stat = await fs.promises.stat(file);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;
  const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  const headers = {
    'content-type': CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    'cache-control': staticCacheControl(pathname),
    'x-content-type-options': 'nosniff',
    etag,
    'last-modified': stat.mtime.toUTCString(),
  };
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    res.end();
    return true;
  }
  res.writeHead(200, { ...headers, 'content-length': stat.size });
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  try {
    await pipeline(fs.createReadStream(file), res);
  } catch {
    // The client went away mid-file; nothing to send.
    res.destroy();
  }
  return true;
}

async function* limitBytes(source, maxBytes) {
  let seen = 0;
  for await (const chunk of source) {
    seen += chunk.length;
    if (seen > maxBytes) throw new HttpError(413, 'Request body too large');
    yield chunk;
  }
}

function toHeaders(req) {
  const headers = new Headers();
  for (let i = 0; i + 1 < req.rawHeaders.length; i += 2) {
    const name = req.rawHeaders[i];
    const value = req.rawHeaders[i + 1];
    if (name === undefined || value === undefined || HOP_BY_HOP.has(name.toLowerCase())) continue;
    headers.append(name, value);
  }
  return headers;
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {{trustProxy: boolean, maxBodyBytes: number}} settings
 * @param {AbortSignal} signal
 */
function toWebRequest(req, settings, signal) {
  const rawUrl = req.url ?? '';
  // Origin-form only. String concatenation, not `new URL(rawUrl, base)`: `//evil.example/x` would otherwise replace the host.
  if (!rawUrl.startsWith('/')) throw new HttpError(400, 'Bad request');
  const hostHeader = req.headers.host;
  if (!isValidHost(hostHeader)) throw new HttpError(400, 'Bad request');
  const forwarded = req.headers['x-forwarded-proto'];
  const scheme = resolveScheme({
    trustProxy: settings.trustProxy,
    forwardedProto: Array.isArray(forwarded) ? forwarded[0] : forwarded,
    encrypted: Boolean(req.socket && 'encrypted' in req.socket && req.socket.encrypted),
  });
  let url;
  try {
    url = new URL(`${scheme}://${hostHeader}${rawUrl}`);
  } catch {
    throw new HttpError(400, 'Bad request');
  }

  const method = req.method ?? 'GET';
  const init = { method, headers: toHeaders(req), signal };
  if (method !== 'GET' && method !== 'HEAD') {
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > settings.maxBodyBytes) throw new HttpError(413, 'Request body too large');
    init.body = Readable.toWeb(Readable.from(limitBytes(req, settings.maxBodyBytes)));
    init.duplex = 'half';
  }
  return new Request(url, init);
}

async function writeWebResponse(res, response, method) {
  res.statusCode = response.status;
  for (const [name, value] of response.headers) {
    const lower = name.toLowerCase();
    if (lower === 'set-cookie' || HOP_BY_HOP.has(lower)) continue;
    res.setHeader(name, value);
  }
  // Several cookies (cart, delivery ZIP, session) must stay separate header lines.
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) res.setHeader('set-cookie', cookies);

  if (response.body === null || method === 'HEAD') {
    await response.body?.cancel();
    res.end();
    return;
  }
  try {
    await pipeline(Readable.fromWeb(response.body), res);
  } catch {
    res.destroy();
  }
}

/**
 * @param {{
 *   handler: {fetch: (request: Request, env: Record<string, string | undefined>, ctx: object) => Promise<Response>},
 *   env: Record<string, string | undefined>,
 *   clientDir: string,
 *   settings: {trustProxy: boolean, maxBodyBytes: number, shutdownTimeoutMs: number},
 *   log: (level: 'warn' | 'error', event: string, fields?: Record<string, unknown>) => void,
 * }} deps
 */
export function createNodeServer({ handler, env, clientDir, settings, log }) {
  const pending = new Set();
  const ctx = {
    waitUntil(task) {
      // A stateful process needs no platform help to finish background work; this only remembers it so shutdown can wait.
      const tracked = Promise.resolve(task).catch((error) => {
        log('error', 'node_server.background_failed', { error: errorName(error) });
      });
      pending.add(tracked);
      void tracked.finally(() => pending.delete(tracked));
    },
    passThroughOnException() {},
  };

  const server = http.createServer(async (req, res) => {
    const method = req.method ?? 'GET';
    const aborter = new AbortController();
    // A client that leaves while loaders are still running cancels them. After the first byte the signal is left alone:
    // React's stream abort handler throws "Controller is already closed" on a finished stream, which would log a false
    // render.failed for every shopper who navigates away mid-page. The body stream is cancelled by the pipeline instead.
    res.on('close', () => {
      if (!res.writableFinished && !res.headersSent) aborter.abort();
    });
    try {
      const pathname = (req.url ?? '').split('?')[0] ?? '';
      const readOnly = method === 'GET' || method === 'HEAD';
      if (readOnly && pathname === '/healthz') {
        plain(res, 200, '{"status":"ok"}', { 'content-type': 'application/json; charset=utf-8' });
        return;
      }
      if (readOnly) {
        const file = resolveStaticPath(clientDir, pathname);
        if (file !== null && (await serveStatic(req, res, file, pathname))) return;
      }
      const response = await handler.fetch(toWebRequest(req, settings, aborter.signal), env, ctx);
      await writeWebResponse(res, response, method);
    } catch (error) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (error instanceof HttpError) {
        plain(res, error.status, error.message, error.status === 413 ? { connection: 'close' } : {});
        return;
      }
      // Name only (N-L4): the storefront already logs `request.unhandled` for what it catches itself.
      log('error', 'node_server.request_failed', { error: errorName(error) });
      plain(res, 500, 'An unexpected error occurred');
    }
  });

  // Slow-client limits. keepAliveTimeout is above the reverse proxy's upstream keepalive (60 s) so the proxy, not this
  // process, closes idle connections and no request is sent into a connection that is just closing.
  server.requestTimeout = 60_000;
  server.headersTimeout = 30_000;
  server.keepAliveTimeout = 65_000;

  const closed = new Promise((resolve) => server.once('close', resolve));

  async function close() {
    server.close();
    server.closeIdleConnections();
    let timer;
    const deadline = new Promise((resolve) => {
      timer = setTimeout(resolve, settings.shutdownTimeoutMs);
    });
    await Promise.race([Promise.all([closed, Promise.allSettled([...pending])]), deadline]);
    clearTimeout(timer);
    server.closeAllConnections();
  }

  return { server, close, pendingCount: () => pending.size };
}
