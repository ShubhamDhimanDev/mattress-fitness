# Security review: guest order tracking (commit 18e52db, P6-08, REQ-ACC-003, SD-05)

Date: 2026-10-24 (review round named in the request; system date 2026-10-23). Reviewer: security-engineer. Read-only review; no browser; no call to Shopify or any third party.
Branch `feat/analytics-consent-and-placeholder-offers`, commit `18e52db` (15 files, +2996). Threats: T-09 (primary), T-05, T-13, T-04, T-07, T-08. Risks: R-27. Blockers: B-19, B-11. Requirement: REQ-ACC-003 (Pending approval, SD-05 not acknowledged).

**Verdict: PASS WITH CONDITIONS (not a gate pass). No High.** One Medium (M-1) must be fixed before any public or staging URL. The route has only met a typed fake Admin client; nothing was verified against a store (V-09, V-20).

## Scope and method

Read: CLAUDE.md, `.claude/rules/security.md`, THREAT_MODEL, GUEST_TRACKING.md, `track-order.tsx`, `guest-lookup.ts`, `guest-lookup-handler.ts`, `guest-lookup-client.ts`, `guest-lookup-limiter.ts`, the three components, `lib/cart/http.ts` (origin check), `delivery-runtime/form.ts` (body cap), `extend/admin-client.ts` (`adminConfigFromEnv`), `extend/capped-body.ts`, `logging/logger.ts`, `catalog/text.ts`, `deploy/nginx.conf.example`, `scripts/node-server/adapter.mjs`, ADR-0011 and VPS_RUNBOOK (process model), `seo/canonical.ts`, REQ-ACC-003, SD-05, B-19.
Ran: `npx vitest run tests/unit/orders tests/unit/routes/track-order.test.ts app/lib/orders` -> 6 files, 324 tests, all pass. Secret and pattern scan of the commit's added lines (Shopify token prefixes, `sk_live`, `ghp_`, JWT, PEM, `console.*`, `dangerouslySetInnerHTML`, `process.env`): no match. No package files changed in the commit (the `package-lock.json` change in the working tree is not part of it). A live probe was attempted and abandoned: the existing `storefront/dist` build predates the route (GET /track-order gave 404), and a rebuild writes artefacts, which this review does not do. The probe server was stopped.
Not covered: uncommitted working-tree changes by other work (`entry.server.tsx`, `security-headers.ts`, `analytics*`, `consent/`).

## Findings

### Medium

**M-1 (T-09, T-13, R-27): the default trusted address header is client-controllable on the VPS, so the per-address counters can be dodged and, with L-1, the whole lookup can be switched off by one client.**
Evidence:
- `guest-lookup-handler.ts:78` default `oxygen-buyer-ip`; `:97-101` any configured name that is not on the allow-list falls back to that default; `:295` the name comes from `TRUSTED_CLIENT_IP_HEADER`, which is in no env file, runbook or `.env.example` yet.
- `scripts/node-server/adapter.mjs:183-192` copies every inbound header into the Web `Request` (no stripping of `oxygen-buyer-ip`, `cf-connecting-ip`, `true-client-ip`).
- `deploy/nginx.conf.example:228-233` overwrites `X-Forwarded-For`, `X-Real-IP`, `X-Forwarded-Proto`, blanks `Forwarded`, but passes `Oxygen-Buyer-IP`, `CF-Connecting-IP` and `True-Client-IP` through unchanged.
- `handler.test.ts:572-578` proves the fallback reads `oxygen-buyer-ip` from the request. GUEST_TRACKING.md:37 and handler.ts:77 say that anywhere but Oxygen the header "is absent and the shared bucket applies". That is wrong behind our nginx: a client simply sends it.
Impact: `curl -H 'Oxygen-Buyer-IP: 10.<n>' ...` with a new value per request gives every request a fresh "address", so the address (10) and order+address (3) counters never trip. For one order number the only unspoofable limit left is the overall ceiling (300 per 15 min per process, about 1,200 email guesses an hour). The email counter (5 per email) still holds. Realistic privacy risk is modest (a guess has to hit the exact email on file) but the control the design relies on is not working as documented. The opposite failure also exists: with no header configured and none sent, every honest shopper shares one `unknown` bucket (10 attempts per 15 min for the whole site).
Fix (recommended design, see answer 1): nginx sets one header and blanks the others; the Node adapter drops all untrusted address headers and owns one; the app reads that one; no Oxygen default off Oxygen.

### Low

**L-1 (T-13): the overall ceiling is a single-party kill switch, and it is evaluated last.** `guest-lookup-limiter.ts:216-221` pushes `overall` after address, order+address and email. When overall refuses, the attempt has already been recorded on the earlier counters (they `hit` first), so a flood after the ceiling trips still burns victims' email allowances and inserts new keys into the address and email stores. The doc's claim "a refused attempt is not recorded on a later counter" is true in that direction only. Impact with M-1 open: 300 requests per 15 minutes from one curl loop make the feature return 429 for everyone; with a correct address it needs 30 addresses. Fallback exists (sign in), so Low, but Medium while M-1 is open. Fix: check `overall` first (no hashing needed, cheaper), or do a read-only pass over all counters and record only if all allow. Log `limitedBy=overall` as an alert event.

**L-2 (T-09): email counter allows lock-out of a victim.** See answer 2. Accept with mitigations.

**L-3 (T-13, B-19): no host-level limit on the lookup path yet.** `nginx.conf.example:31-32, 41, 221` keep the lookup zone commented out ("not built yet"); `/track-order` now exists, so `POST /track-order` and `/track-order.data` ride only on `mf_general` (20 r/s, burst 60), far above any shopper need. nginx sees the real `$remote_addr` and is the only unspoofable per-address layer. Fix: enable the zone (answer 6). Condition for any public URL.

**L-4 (T-07, T-10): tracking links are checked for the `https:` scheme only.** `guest-lookup.ts:282-290`. Blocks `javascript:` and `data:`, but accepts any host, `https://user:pass@host/`, IP literals, odd ports and 2,000-character URLs. The value is staff-entered or comes from a fulfilment app, so the risk is phishing through a compromised staff account or app, not XSS (React escapes the attribute; `rel="noopener noreferrer"` is set at `GuestOrderSummary.tsx:96`). Fix: answer 8.

**L-5 (T-13): per-address key uses the whole IPv6 address.** `handler.ts:105-107`. One residential IPv6 customer owns a /64 (2^64 addresses), so rotating the low bits defeats the per-address counters even when the header is trustworthy. Fix: key IPv6 on the /64 prefix; canonicalise `::ffff:a.b.c.d` to the IPv4 form.

**L-6 (T-07, SEO): `/track-order` is indexable by our own SEO helpers.** `seo/canonical.ts:27-35` `NON_INDEXABLE_PREFIXES` does not list it, so the page gets a canonical link (`canonical.ts:77`) and would enter the sitemap extras if a menu links it (`sitemap.ts:156`), while the page says `noindex`. Conflicting signals, no data exposure (the page holds no personal data). Fix: add `/track-order` to `NON_INDEXABLE_PREFIXES` only; do not add it to `ROBOTS_DISALLOWED_PREFIXES` (a robots block would stop crawlers seeing the noindex).

**L-7 (T-04, T-13, E-L8): one Admin token for two features, and an outage looks like "not found".** `adminConfigFromEnv` reads `SHOPIFY_ADMIN_API_ACCESS_TOKEN`, shared with the Extend sync and detective check. By design every Admin failure (revoked token, throttle, timeout) returns the generic 200 (`handler.ts:221-224`), which protects the shopper view but hides a dead lookup from the owner. Fix: give guest lookup its own app/token (`read_orders` only, never `read_all_orders`) if the Extend sync needs more, and alert on `guest_lookup.upstream_failed` with `reason=auth|throttled` (an alert definition in the runbook).

### Info

- **I-1 constant-time compare** is adequate (answer 5).
- **I-2** `createKeyHasher` caches a rejected `importKey` promise forever (`limiter.ts:90-98`): fails closed until restart. Harmless; reset `keyPromise` on rejection if wanted.
- **I-3** The 800 ms floor is cosmetic (answer 3).
- **I-4** The found view carries item titles, quantities, order date and a tracking number (the carrier page often shows destination city). That is the intended disclosure to anyone holding the order number plus email; it contains no email, address, phone or price (`toView`, `guest-lookup.ts:298-324`; `candidate.email` never leaves).
- **I-5 unverified on a store:** `Order.email` and customer fields may need Shopify's protected customer data approval for the app (V-20); the doc's UNVERIFIED list (items 1 to 9) stands and is not repeated here.

## Checks that passed (evidence)

| Check | Result |
|---|---|
| GraphQL injection | Constant query text; only variable is `name:<number>`; number is `[A-Z0-9]{1,20}(-[A-Z0-9]{1,6})?` after NFKC and invisible-character removal (`guest-lookup.ts:50, 57-68, 443-456`), so no space, quote, colon, wildcard or operator can enter. Exact equality is re-checked on the returned name. Prefix regex input is capped at 60 chars (no ReDoS); email regexes run after the 64/254 length checks. |
| SSRF and redirect | Host only from `PUBLIC_STORE_DOMAIN`, must match `<shop>.myshopify.com` (`admin-client.ts:SHOP_DOMAIN`); fixed path and version; `redirect: 'error'` (`client.ts:71`); 6 s timeout; 500 KB body cap; no user value in URL or headers. |
| Token handling | Token in a closure (`admin.headers()`), sent only in `X-Shopify-Access-Token`; test asserts it is absent from results; no `console.*`, no `process.env` in the commit; secret scan clean. |
| Response uniformity | 15 order- or form-dependent scenarios (wrong email, no order, other order, over 60 days, no email on order, malformed number, malformed email, missing, oversized, Admin auth, timeout, network, GraphQL error, non-form body, body over cap) all give status 200, identical JSON and identical header set (`cache-control`, `vary`, `x-robots-tag`) and the same floor (`handler.test.ts:194-327`, run and passing, on a fake clock). Different by design and not order-dependent: 405, 403, 429, 503. |
| Existence leak through 429 vs 200 | None: every counter key derives from the submitted values and the address, never from whether an order exists (`limiter.ts:184-223`). See answer 4. |
| Timing | Every valid-format request reaches the same upstream call; found and not-found differ only in local compare work (microseconds) under the floor. Not proven on real latency (V-20). |
| CSRF and same origin | `isSameOriginRequest` before body read and before any counter (`handler.ts:172`); Origin host compared; `Sec-Fetch-Site: cross-site` refused when Origin is absent; nothing is mutated and the lookup needs no cookie, so the worst forgery is a lookup the attacker cannot read. Cross-site form POST always carries Origin in current browsers. |
| Input bounds | Body cap 4 KB, declared and streamed (`form.ts`); nginx 1 MB and Node `MAX_BODY_BYTES` behind it; fields capped 60 and 254 characters in the form and 60/320/254 in code; a `File` value is rejected by the `typeof` checks. |
| PII in logs and errors | Events carry codes and counts only (`completed`, `rate_limited`, `limiter_failed`, `upstream_failed`, `unavailable`, `rejected`); no address, order number, email or message text; logger redacts further; errors never echo input; a test greps logs across outcomes. nginx `mf_privacy` log format drops query strings and cookies. |
| Cache | Page, loader and action answers `private, no-store`; action adds `Vary: Cookie` and `X-Robots-Tag`; the route `headers` export merges them (`track-order.tsx:37-42`). Node in-memory `caches` stand-in is used only for Hydrogen queries and replay marks, never for this route. No proxy cache in nginx. GET never reads the query string (`track-order.tsx:44-50`), so a link cannot start or pre-fill a lookup. |
| XSS | Order name, item titles, carrier and number go through `cleanText` (strips tags, control and bidi characters) and are rendered as React text; no `dangerouslySetInnerHTML`; only link is `https`, `target=_blank` with `noopener noreferrer`. |
| Meta | `robots: noindex, nofollow` in `meta` and `X-Robots-Tag` on every answer (but see L-6). |
| Limiter memory | Four limiter instances, each bounded to 5,000 keys with LRU eviction; each key holds at most `limit` timestamps (at most 300 for `overall`); sweep is O(n) with n at most 5,000 per new key. Flooding distinct keys is bounded by the overall counter (300 per 15 min is far below 5,000), except through the ordering gap in L-1. Window arithmetic is atomic per `hit` (no check-then-act race across the `await`s). |

## Answers to the author's eight questions

**1. Client address (TRUSTED_CLIENT_IP_HEADER) for a VPS behind nginx.** The idea of one allow-listed header, malformed to a shared bucket, is right; the default and the trust model are not. Our nginx template already overwrites `X-Forwarded-For` with `$remote_addr`, so the "last entry" rule is correct (it is also the right rule if someone later switches to `$proxy_add_x_forwarded_for`). But a header the proxy does not own is attacker-controlled, and the Node adapter forwards everything. Recommended exact design:
- nginx (`location /`): keep `proxy_set_header X-Real-IP $remote_addr;` (overwrite, single value) and add `proxy_set_header CF-Connecting-IP ""; proxy_set_header True-Client-IP ""; proxy_set_header Oxygen-Buyer-IP "";` (nginx drops a header whose value is empty). If a CDN or Cloudflare is ever put in front, fix it once in nginx with `set_real_ip_from <CDN ranges>; real_ip_header CF-Connecting-IP;` so `$remote_addr` and `X-Real-IP` stay the client; the app does not change.
- Node adapter (it alone knows `TRUST_PROXY`): in `toHeaders`, delete `oxygen-buyer-ip`, `cf-connecting-ip`, `true-client-ip` always; when `trustProxy` is false also delete `x-real-ip` and `x-forwarded-for` and set `x-real-ip` from `req.socket.remoteAddress`. With `trustProxy` true the loopback-bind check (`config.mjs:129`) already guarantees only nginx can set it.
- App: no default header. `TRUSTED_CLIENT_IP_HEADER` unset means `unknown` (stricter, fails safe) rather than `oxygen-buyer-ip`; set `TRUSTED_CLIENT_IP_HEADER=x-real-ip` in `/etc/mattressfitness/env` on the VPS and `oxygen-buyer-ip` only on Oxygen (and only after verifying Oxygen strips an inbound copy, Q-003). Accept only a single value: `Headers.get` joins duplicates with ", ", which `ADDRESS_SHAPE` already rejects. Add IPv6 /64 and IPv4-mapped normalisation (L-5). Add a unit test that a request carrying `oxygen-buyer-ip` is ignored when `x-real-ip` is configured, and an adapter test that the stripped names never reach the handler. Add the variable to the runbook's environment table and `.env.example`.

**2. Email counter lock-out (5 per 15 min).** Yes, an attacker who knows a victim's email can keep that email's counter full and the victim's guest lookup returns 429 (any address; no order number needed). It is acceptable for a non-critical, optional lookup because the shopper has sign-in and the confirmation-email link, the 429 message says so, and the same counter is the only unspoofable defence against guessing order numbers for a known email (order numbers are sequential and low entropy, so the email is the only secret). Recommended mitigations: count only requests that pass format validation (already so); also add an unspoofable per-order counter (order number alone, about 10 per 15 min) so the email counter is not the only one; surface a clear "or sign in" path (present); alert on `limitedBy=email` spikes; document the trade-off in the owner's acceptance. Not worth a CAPTCHA at this size.

**3. Defaults 10 / 3 / 5 / 300 per 15 min and the 800 ms floor.** Reasonable starting values: 10 per address and 3 per order+address tolerate a mistyped order number or email; shoppers behind one NAT can collide, which fails safe. Keep 5 for email (see 2). 300 overall is below Admin API capacity (one lookup is roughly `orders(first:5)` with nested connections; cost unmeasured, V-20) but, per L-1, is a kill switch: move it first, alert on it, and raise it only if real traffic needs more. Add the per-order counter. The 800 ms floor is a mitigation only: it hides the difference between a request that skipped Admin and one that used it (an attacker already knows whether their input is well formed) and does nothing for found vs not found, which share an upstream path. Keep it (cheap, 800 ms per request costs a timer and a pending promise, bounded by nginx `limit_conn`), but do not cite it as a control; re-tune after measuring Admin latency on a store.

**4. Does 429 vs 200 leak existence?** No. Counter keys depend on submitted values and the address only, and a malformed value counts only against the address; whether an order or email exists never changes a counter. Residual signals, all weak: a 429 for a fresh address and a valid-format email means that email was submitted five times in the last 15 minutes (activity, not existence); `Retry-After` shows when the oldest counted attempt was made; 429 is instant while 200 takes at least the floor, which is independent of existence. Fixed, order-independent statuses (403, 405, 503) are fine.

**5. Constant-time compare in JavaScript.** Adequate. The compare runs after a network round trip (hundreds of ms of jitter), after an 800 ms floor, against an oracle that only returns found or not found, and is capped at 5 tries per email; a remote timing attack on a few microseconds is not realistic. `constantTimeEqual` (`guest-lookup.ts:140-147`) covers length and every character, and `matchGuestOrder` evaluates all checks without short-circuit. Optional hardening if wanted: HMAC both values with the per-process key and compare the fixed-length digests, which removes length and engine-optimisation concerns. No change required.

**6. Shared limiter P6-14 on one VPS.** One process is the plan (ADR-0011:48), so the per-process in-memory store is functionally the shared store; it resets on every restart and deploy (a few seconds of lost counters, acceptable). Add nginx `limit_req` as a second, accurate layer, and treat nginx as authoritative for the per-address limit: uncomment and set `map "$request_method$uri" $mf_key_lookup { default ""; "~*^POST/track-order(\.data)?/?$" $binary_remote_addr; }`, `limit_req_zone $mf_key_lookup zone=mf_lookup:5m rate=6r/m;`, and `limit_req zone=mf_lookup burst=5 nodelay;` in `location /` (starting values, untested, `nginx -t` never run). Two caveats: a second process or a zero-downtime two-instance setup multiplies the app's allowances (nginx then becomes the only shared per-address limit; email and overall counters would need a shared store); and `$remote_addr` is the CDN if one is added (use realip, answer 1). The HMAC key can stay a random per-process key until counters leave the process. When a shared store, a second process or cross-restart counters are introduced, put one 32-byte random `GUEST_LOOKUP_KEY_SECRET` in `/etc/mattressfitness/env` (root:root 0600, next to `SESSION_SECRET` and `DELIVERY_COOKIE_SECRET`, never `PUBLIC_`, distinct from both, listed by name in `.env.example` and in the node server's startup check), derive per-scope keys with HKDF, and rotate by restart (counters reset, nothing else breaks). Never use an unkeyed hash for keys: emails are guessable.

**7. Hashed address in logs for abuse tracing.** Not needed and not recommended by default. The address is already in the nginx access log (`mf_privacy` keeps `$remote_addr`, drops queries and cookies), which is where tracing and blocking (fail2ban or an nginx deny) belong, under a set retention period. If a log line is still wanted, add it only to `guest_lookup.rate_limited` (never on success), as a keyed hash truncated to 8 bytes with the per-process or rotating key, and add the field name to the logger's allow-list deliberately. A hashed IP is still personal data under US privacy laws, so the privacy policy and retention (T-16) must cover it. Never log an email or order number hash.

**8. Carrier tracking URL allow-list.** Keep `https` only, and add: reject userinfo, IP literals, non-443 ports and hosts without a dot; require the host to equal or be a subdomain of an allow-listed carrier domain (UPS, FedEx, USPS, DHL, OnTrac plus the client's own freight and white-glove carriers, which are not known yet and must come from the client); a link whose host is not allow-listed is not shown as a link, the carrier name and tracking number are shown as text instead. Hold the list as a constant with a site-setting or env override so the client's team can add a carrier without a code change. The value is staff or app supplied, so this is hardening against a compromised staff account or fulfilment app, not an XSS fix; React already escapes it.

## Threat model verification updates (proposed; THREAT_MODEL.md not edited by this review)

| ID | Status 2026-10-23 | What remains |
|---|---|---|
| T-09 | Partial: verified in code against a typed fake Admin client (324 tests); route exists | M-1, L-1, L-3; dev store with `read_orders`-only token (V-09, V-20); client acknowledgement of SD-05 (B-11); abuse tests on a real host (answers 1 and 6); owner acceptance of the lock-out trade-off (L-2) |
| T-05 | Verified in code for this route | Logs, errors, cache, URLs, bundle show no PII; real-host two-cookie test still open (R-29, B-19) |
| T-13 | Partial | Lookup is limited in-process only; nginx zone not enabled (L-3); overall ceiling kill switch (L-1) |
| T-07 | Verified in code for this route | L-4, L-6 |
| T-08 | Verified in code for the new action | Behaviour behind the real proxy (P-L5) |
| T-04 | Unchanged, secret scan clean for the commit | Separate `read_orders`-only token (L-7, E-L8) |

## Residual risks and what could not be verified

- No store, no token: query validity, `name:` search behaviour (prefix or split orders, custom order-name prefix), field availability, protected-customer-data approval, 60-day window, Admin latency against the 800 ms floor and Admin cost per lookup are all unverified.
- The route was not run end to end: the `dist` build predates it, the Playwright spec was not run (no browser by instruction), and single-fetch status and header handling for POST `/track-order.data` is unit-tested only for the handler and the route functions, not on the wire.
- nginx and the systemd unit have never run (`nginx -t` not executed); every limit number is a guess. Behaviour behind a CDN is not designed yet (Q-003).
- Whether Oxygen strips an inbound `oxygen-buyer-ip` is an assumption (Q-003).
- Real-world `trackingInfo.url` shapes for the client's carriers are unknown.
- Risk acceptance needed from the owner (not recorded here): L-2 (lock-out trade-off), and that guest lookup is per-process and restart-reset on a single VPS.

## Conditions for the gate

1. Fix M-1 (nginx blanking, adapter stripping, no off-platform default, runbook and `.env.example` entry, tests) before any public or staging URL.
2. Reorder or two-phase the overall counter and add the per-order counter (L-1) at the same time.
3. Enable the nginx lookup zone (L-3) with the real path.
4. Add `/track-order` to `NON_INDEXABLE_PREFIXES` (L-6) and decide L-4 and L-5 with the owner.
5. Dev-store verification (V-09, V-20) and an independent re-review of the fixes before REQ-ACC-003 leaves Pending approval.
