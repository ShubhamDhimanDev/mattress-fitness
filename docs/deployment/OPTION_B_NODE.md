# Option B (own Node server): feasibility spike

Task P1-08, run 2026-10-12 on the committed scaffold (Hydrogen 2026.4.7, react-router 7.16.0, React 18). Purpose: prove that the same Hydrogen code can run on a plain Node.js server (SOW §3 Option B) and find out what must change. Code: [scripts/spikes/option-b-node-server.mjs](../../scripts/spikes/option-b-node-server.mjs) (a spike, not production code). The decision between Option A and B is still open (Q-003); this removes the biggest unknown about B.

## Result

**Works.** A scratch copy built with `react-router build` (no Oxygen plugin) and served by a 90-line Node HTTP adapter returned HTTP 200 for the home page (about 30 KB of HTML), a product page, the search route and a static asset, against mock.shop. No Hydrogen feature we need failed.

## What had to change (the Option B delta)

| #   | Change                                                                                                                                                                                                                    | Why                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Remove the `oxygen()` plugin from `vite.config.ts` and build with `react-router build` (output in `dist/server` and `dist/client`)                                                                                        | The Oxygen plugin shapes the build for Cloudflare-style workers                                                                                                 |
| 2   | Alias `react-dom/server` to `react-dom/server.browser` in the Vite config                                                                                                                                                 | The server bundle imports `renderToReadableStream`, which React 18's Node entry does not export (React 19's may; re-check after the Hydrogen 2026.10 migration) |
| 3   | A Node entry (`server.node.ts`) replacing `server.ts`: convert Node requests to Web `Request` and write the Web `Response` back, serve `dist/client` as static files, stream bodies, forward several `Set-Cookie` headers | Oxygen provides this; Node does not                                                                                                                             |
| 4   | Replace `caches.open('hydrogen')` with Hydrogen's `InMemoryCache` (or a shared cache such as Redis for several processes)                                                                                                 | `caches` is a Workers global, used in `app/lib/context.ts`                                                                                                      |
| 5   | `waitUntil`: a no-op that tracks pending promises                                                                                                                                                                         | Only serverless runtimes need it; a stateful Node server does not (Shopify's self-hosting guide says the same)                                                  |
| 6   | Session: the template's `AppSession` works unchanged (react-router cookie session)                                                                                                                                        | None needed beyond importing it from the compiled app                                                                                                           |
| 7   | Environment variables from `process.env` instead of Oxygen's secrets                                                                                                                                                      | Same names                                                                                                                                                      |

## What the spike did not cover

Cart and customer-account routes with a real store, HTTPS and reverse-proxy headers, caching behaviour under load, process management, Nginx, TLS, graceful shutdown, the Extend webhook and sync service, and Hydrogen 2026.10 (new template; re-run this spike after P1-12). Shopify's own guide warns that features added in Hydrogen 2025-05 and later may need adaptation (F-06); none broke here, but the spike did not exercise Hydrogen's analytics or consent features with a real store.

## What changed in the app since the spike (reviewed 2026-10-15, not re-run)

The spike was run on 2026-10-12 and has **not been re-run**. The spike script bypasses `server.ts` and `createHydrogenRouterContext` (it builds its own context from `SESSION_SECRET` and `PUBLIC_STORE_DOMAIN` only), so it proves the build and the adapter, not the app as it now stands. A production Node entry must account for:

- **Security headers.** `server.ts` passes every response through `withSecurityHeaders`; a Node entry must make the same call on every response (documents, `/api/*`, `/webhooks/*`, redirects, the 500 page), and read the first `X-Forwarded-Proto` value (HSTS) from a proxy that sets it ([SECURITY_HEADERS](../security/SECURITY_HEADERS.md)).
- **Cookies.** `server.ts` appends the session cookie to the response instead of replacing existing `Set-Cookie` headers (the cart and delivery ZIP cookies); the spike's `response.headers.set('Set-Cookie', ...)` does not, so the adapter must not copy that line.
- **Environment.** More variables, same names from `process.env` ([DEPLOYMENT](DEPLOYMENT.md) lists them). A production build refuses to serve with `SESSION_SECRET` under 32 characters, and the delivery ZIP needs `DELIVERY_COOKIE_SECRET`. `server.ts` reads `process.env.NODE_ENV`; set it to `production`.
- **Background work.** The webhook route answers 200, then syncs in `waitUntil`. On a long-lived Node process a no-op `waitUntil` that keeps the promise alive is enough; the route falls back to running the task if none is supplied.
- **Per-process state.** The Extend circuit breaker, offers memory, offers rate limiter, webhook coalescer and replay marks live in module memory. With several processes each has its own copy (Cache API replay marks exist only on Workers runtimes). Not a correctness problem (the sync is idempotent) but rate limiting must be done at the proxy.
- **Extend sync.** It runs inside the app, not as a separate service; the SOW's "Extend sync as a service" for Option B is therefore an open interpretation (Q-003).
- **Logs.** Events are JSON lines on `console.warn` and `console.error`; the process manager must capture both.

Re-run the spike against the current build, with a real production entry, before relying on any of this.

## Consequences for the decision

Option B is feasible with roughly the seven changes above, all localised to the build config, one entry file and one cache line. Effort beyond that (server hardening, Nginx, TLS, monitoring, the sync service) is what SOW §3 already lists for Option B. Our recommendation stays Option A. Keeping `server.ts`, `app/lib/context.ts` and `vite.config.ts` as the only platform seams (ADR-0004) is confirmed as the right boundary.
