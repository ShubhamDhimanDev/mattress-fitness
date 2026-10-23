# ADR-0011: Run the built storefront on plain Node through an adapter outside the application

- **Status:** Proposed (owner to accept; the implementation below is new files only and changes nothing in the Oxygen path)
- **Date:** 2026-10-23
- **Numbering:** first drafted as ADR-0010-node-server-entry; renumbered to 0011 on 2026-10-23 because ADR-0010 is [ui-primitives-and-design-tokens](ADR-0010-ui-primitives-and-design-tokens.md). The text is unchanged by the renumbering.
- **Deciders:** project owner, solution-architect (review requested), devops-engineer (author of this draft)
- **Requirements:** REQ-HOST-003, NFR-006
- **Related:** DEC-079 (interim VPS answer), DEC-080 (no CI), DEC-083 (Hydrogen 2026.10 migration, P1-12), ADR-0004, ADR-0008, Q-003, F-06, F-44, B-19, P9-12

## Context

The owner will deploy by hand to a VPS running our own Node server for now (DEC-079). ADR-0004 keeps the code host-agnostic and names `server.ts`, `app/lib/context.ts` and the `oxygen()` plugin in `vite.config.ts` as the platform seams. The question for P9-12: what exactly does a plain Node host need that the current build does not provide?

Checked on 2026-10-23 against the current working tree (Hydrogen 2026.4.7, react-router 7.16.0, React 18, Vite 8, Node 22.23.3, Windows):

- `npm run build` (`shopify hydrogen build`) writes `dist/server/index.js` and `dist/client/`. The server file is **one self-contained ES module of about 970 KB with no `import` of any package** (React, react-router and Hydrogen are bundled in). Its only export is `default { fetch(request, env, executionContext) }`, the same handler as `server.ts`, so the security headers (`withSecurityHeaders`, DEC-045), session handling and 500 page are already inside it.
- There is **no Node entry**: nothing listens on a port, serves `dist/client`, converts Node requests to Web `Request`s, or provides what Oxygen supplies to the handler.
- Two Workers features are missing in Node and are used at request time: the `caches` global (`caches.open('hydrogen')` in `app/lib/context.ts`, and the Extend webhook replay marks, `app/lib/extend/runtime.ts`) and `executionContext.waitUntil`.
- Not missing: the bundle runs on Node 22 as built. No React `server.browser` alias was needed (it is already inside the bundle), unlike the P1-08 spike, which rebuilt without the Oxygen plugin (`docs/deployment/OPTION_B_NODE.md`).

## Decision (proposed)

Add a small adapter that **loads the unchanged build** and supplies what Node lacks. It lives in `scripts/node-server/` (new files only, plain `.mjs`, zero dependencies, built-in `node:test` tests), and `storefront/package.json` gains one script, `start:node`. Nothing in `storefront/app/`, `server.ts`, `vite.config.ts` or `app/lib/context.ts` changes, and nothing in the storefront imports the adapter, so the Oxygen path is untouched.

- `server.mjs`: reads host settings, refuses to start when required storefront variables are missing or `SESSION_SECRET` is under 32 characters (names only in the log), installs a `caches` stand-in, imports `dist/server/index.js`, serves `dist/client`, handles SIGTERM with a graceful stop.
- `adapter.mjs`: Node request to Web `Request` (scheme from the first `X-Forwarded-Proto` only when `TRUST_PROXY=true`; host validated; body capped), Web `Response` to Node (several `Set-Cookie` lines kept separate, streamed bodies), static assets (no dotfiles, no source maps, no traversal), `/healthz`, `waitUntil` that remembers pending work so shutdown can wait for it.
- `cache.mjs`: a bounded in-process `Cache` (same expiry rule as Hydrogen's `InMemoryCache`, but bounded per named cache by entry count and by an estimated byte size, oldest write evicted first; an entry over one eighth of the byte limit is not stored; expired entries are swept on write and by an unref'd timer, so memory cannot grow without limit).
- `config.mjs`: the host settings `PORT`, `BIND_HOST`, `TRUST_PROXY`, `MAX_BODY_BYTES`, `SHUTDOWN_TIMEOUT_MS`, `CACHE_MAX_ENTRIES`, `CACHE_MAX_BYTES` (default 64 MiB). They configure the host, not the storefront; the storefront still reads only the request-context env (ADR-0004). `BIND_HOST` must be a literal IP address as Node's parser sees it, and `TRUST_PROXY=true` with a non-loopback `BIND_HOST` is refused at start (review round 2026-10-23). `PUBLIC_STOREFRONT_ID` is deliberately not a required name: Hydrogen's `getShopAnalytics` defaults it to `'0'`.

The server binds to `127.0.0.1` by default. A reverse proxy (nginx, see `docs/deployment/VPS_RUNBOOK.md`) is the only public listener and owns TLS, compression, rate and body limits.

## Options considered

| Option | What it takes | Why not (or why) |
|---|---|---|
| **A. Adapter around the unchanged Oxygen build (proposed)** | the new files above | Runs the same bundle bytes that the production-preview e2e run exercises; no change to the app or build; reusable for any `{fetch}` bundle, so it survives the Hydrogen 2026.10 migration if that keeps a fetch-style server entry. Cost: relies on the build output having no external imports and a `{fetch}` default export, which is Hydrogen build behaviour rather than a documented Shopify contract, and emulates `caches` in memory |
| B. A second build without the `oxygen()` plugin and a `server.node.ts` entry (the P1-08 spike) | a Vite config variant, the React `server.browser` alias, replacing `caches.open` in `context.ts` | Touches the three platform seams and creates two builds to keep in step; the run that CI and e2e check would not be the one deployed |
| C. Migrate to Hydrogen 2026.10 first (P1-12, DEC-083) and use the entry it asks the app to own | the 11 migration steps | Planned as the last functionality task and not a prerequisite for a first VPS rehearsal. When it lands, re-run the proof below; the adapter will likely need only a new import path |
| D. Docker or PM2 instead of systemd | an image or a Node tool on the server | Orthogonal: the adapter runs under any process manager; the runbook uses systemd because it needs nothing installed |

## Consequences

Easier: the owner can run and roll back a release with a symlink and a service restart; the runtime needs only Node 22 and the `dist` folder (no `node_modules` on the server, checked below); the adapter's tests run with `node --test` like the other scripts.

Harder or riskier:

- **Contract risk.** If a future Hydrogen build adds external imports or changes the default export, the adapter fails at start with `node_server.build_missing` or `node_server.build_invalid`. Re-run the proof after every Hydrogen or react-router upgrade (also ADR-0008).
- **Per-process state.** The `caches` stand-in, the Extend circuit breaker, offers memory, the offers limiter and webhook replay marks live in memory. With one process (the plan) that equals one Workers isolate. A second process would not share them; rate limiting is therefore done at the proxy.
- **Restart downtime.** A restart refuses connections for a short, unmeasured time; zero downtime would need two instances behind the proxy (not built).
- **Security.** `TRUST_PROXY=true` is only safe with loopback binding and a proxy that overwrites `X-Forwarded-Proto`; the server now enforces the first half (it refuses to start otherwise), so a proxy on another host or container needs a new decision here. `TRUST_PROXY` must be `true` behind TLS termination, or session and cart cookies lose `Secure` (they key on the request URL). The adapter validates the Host header and caps request bodies as a second line behind the proxy.
- **Client-address headers (security review 2026-10-24, M-1).** The storefront's guest-lookup limiter learns the shopper's address from one header named by `TRUSTED_CLIENT_IP_HEADER`, so the host must own that header. `adapter.mjs` therefore always drops `oxygen-buyer-ip`, `cf-connecting-ip` and `true-client-ip` (they belong to other platforms' edges); without `TRUST_PROXY` it also drops `x-real-ip` and `x-forwarded-for` and sets `x-real-ip` from the socket address (IPv4-mapped form shown as IPv4); with `TRUST_PROXY=true` (loopback bind enforced) the proxy's `x-real-ip` passes. nginx overwrites `X-Real-IP` and blanks the three platform headers as well. On this host the environment file sets `TRUSTED_CLIENT_IP_HEADER=x-real-ip`; `oxygen-buyer-ip` is for Oxygen only, and only after Oxygen is shown to strip an inbound copy (Q-003). Tested in `node-server.test.mjs` (spoofed headers ignored, with and without a trusted proxy); nginx side untested.
- **Per-process limiter state.** The application's guest-lookup counters live in this process and reset on every restart and deploy; they are not shared. That is acceptable on one process only with the owner's written acceptance (not yet given); nginx's `mf_lookup` zone is the per-address limit that survives restarts. A second process or two instances behind nginx would need a shared store for the email and overall counters first.
- **Unhandled rejections.** `server.mjs` logs them (error name only) and keeps serving rather than letting Node end the process; uncaught exceptions still end it and the process manager restarts it. Chosen because one stray promise should not drop every in-flight request; the cost is possibly inconsistent in-memory state until the next restart, so the log line is an alert candidate (VPS_RUNBOOK, section 7).

## Verification (2026-10-23, Windows 10 developer machine, not a VPS)

- 48 unit and integration tests in `scripts/node-server/node-server.test.mjs` (`node --test`; 30 at first, 18 added in the review rounds for `BIND_HOST` parsing, the loopback rule, `CACHE_MAX_BYTES`, the cache byte and sweep bounds and the stripping of client-address headers): settings, cache expiry and bounds, scheme and host handling, traversal and dotfile refusal, several cookies, body limit, streaming, `waitUntil` and shutdown, abort handling. One test was mutation-checked (removing the fix made it fail).
- `shopify hydrogen build`, then `scripts/node-server/server.mjs` against `bedding.mock.shop` with placeholder variables (port 3555): `/healthz`, home, collection, product, search, cart, delivery, stores, quiz, compare, 404, `robots.txt`, offers route (400 without input), account (302), webhook without a secret (503) and an oversized body (413) all answered as expected; a `/cart/<variant>:1` request returned 302 with a `Secure; HttpOnly` cart cookie; security headers were present on documents; no `render.failed` or `request.unhandled` lines. A copy of only `dist/`, `storefront/package.json` and `scripts/node-server/` (5.7 MB, no `node_modules`) ran the same pages.
- Config is read at run time: the run-time store domain (`bedding.mock.shop`) appears in the served Content-Security-Policy but nowhere in `dist/` (a search of the built files finds no occurrence), so the bundle holds no baked-in store values. Changing a variable therefore needs a restart, not a rebuild.

## Not verified

Linux and systemd; SIGTERM graceful stop (Windows has no SIGTERM; only the close routine is unit-tested); nginx in front; behaviour under load or with slow clients; customer account sign-in; a signed Shopify webhook; Extend against a real host; checkout hand-off; the delivery ZIP save through the real proxy; memory growth over days.
