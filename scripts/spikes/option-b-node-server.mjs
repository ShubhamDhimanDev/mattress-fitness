// SPIKE (P1-08, 2026-10-12): runs the Hydrogen server build on a plain Node HTTP server to prove Option B is viable.
// Not production code and not wired into any script. See docs/deployment/OPTION_B_NODE.md for the build changes it needs.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {Readable} from 'node:stream';
import {createCookieSessionStorage} from 'react-router';
import {createRequestHandler, createHydrogenContext, InMemoryCache} from '@shopify/hydrogen';
import * as serverBuild from './dist/server/index.js';

const PORT = Number(process.env.PORT ?? 3300);
const env = {
  SESSION_SECRET: process.env.SESSION_SECRET ?? (() => { throw new Error('Set SESSION_SECRET'); })(),
  PUBLIC_STORE_DOMAIN: process.env.PUBLIC_STORE_DOMAIN ?? 'mock.shop',
};
const cache = new InMemoryCache(); // replaces Workers' caches.open('hydrogen')
const pending = new Set();
const waitUntil = (p) => {
  pending.add(p);
  p.finally(() => pending.delete(p));
}; // stateful Node server: fire-and-forget is fine

class AppSession {
  isPending = false;
  constructor(storage, session) { this.storage = storage; this.session = session; }
  static async init(request, secrets) {
    const storage = createCookieSessionStorage({cookie: {name: 'session', httpOnly: true, path: '/', sameSite: 'lax', secrets}});
    const session = await storage.getSession(request.headers.get('Cookie')).catch(() => storage.getSession());
    return new AppSession(storage, session);
  }
  get has() { return this.session.has; }
  get get() { return this.session.get; }
  get flash() { return this.session.flash; }
  get unset() { this.isPending = true; return this.session.unset; }
  get set() { this.isPending = true; return this.session.set; }
  destroy() { return this.storage.destroySession(this.session); }
  commit() { this.isPending = false; return this.storage.commitSession(this.session); }
}

const handle = createRequestHandler({build: serverBuild, mode: 'production', getLoadContext: undefined});

const types = {'.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.map': 'application/json'};
const clientDir = path.resolve('dist/client');

function toRequest(req) {
  const init = {method: req.method, headers: req.headers};
  if (!['GET', 'HEAD'].includes(req.method ?? 'GET')) { init.body = Readable.toWeb(req); init.duplex = 'half'; }
  return new Request(`http://${req.headers.host}${req.url}`, init);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const file = path.join(clientDir, path.normalize(url.pathname));
    if (file.startsWith(clientDir) && url.pathname !== '/' && fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, {'content-type': types[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'public, max-age=31536000, immutable'});
      fs.createReadStream(file).pipe(res);
      return;
    }
    const request = toRequest(req);
    const session = await AppSession.init(request, [env.SESSION_SECRET]);
    const hydrogenContext = createHydrogenContext({env, request, cache, waitUntil, session, i18n: {language: 'EN', country: 'US'}}, {});
    const response = await createRequestHandler({build: serverBuild, mode: 'production', getLoadContext: () => hydrogenContext})(request);
    if (session.isPending) response.headers.set('Set-Cookie', await session.commit());
    res.statusCode = response.status;
    for (const [k, v] of response.headers) if (k.toLowerCase() !== 'set-cookie') res.setHeader(k, v);
    const cookies = response.headers.getSetCookie?.() ?? [];
    if (cookies.length) res.setHeader('set-cookie', cookies);
    if (response.body) Readable.fromWeb(response.body).pipe(res); else res.end();
  } catch (error) {
    console.error('request failed:', error?.message ?? error);
    res.statusCode = 500;
    res.end('Internal error');
  }
});
server.listen(PORT, () => console.log(`node spike listening on http://localhost:${PORT}`));
void handle;
