# Security re-review: fixes after the guest-tracking and analytics-consent reviews (range 18e52db..565a1b5)

Date: 2026-10-24. Reviewer: security-engineer. Read-only review of code; no browser, no call to Shopify, Google or Meta, no nginx. The only file written is this note. Branch `feat/analytics-consent-and-placeholder-offers`, HEAD `565a1b5` (118 files, +14,903 in the range). Earlier notes: [guest tracking](REVIEW-2026-10-24-guest-tracking.md), [analytics consent](REVIEW-2026-10-24-analytics-consent.md). Threats: T-09, T-13, T-05, T-10, T-16, T-07, T-12. Open blockers touched: B-19, B-32, B-11.

## Verdict

- **Guest order tracking (REQ-ACC-003): PASS WITH CONDITIONS, code side.** M-1, L-1, L-3, L-4, L-5, L-6 and I-2 are closed in code and in tests, including raw-HTTP adapter tests for spoofed headers. No High, no Medium left. What remains is outside the code: nginx has never run (`nginx -t` not executed), no dev store, owner acceptance of the lock-out trade-off, separate Admin token (L-7). Not a gate pass for a public URL until those are done.
- **Analytics consent layer (P7-01): PASS WITH CONDITIONS, still inert without ids.** M-2, L-1, L-2 (partly), L-3, L-4, L-6, I-1 are closed. M-1 is closed for every event the runtime sends, but **one new Medium (A-M1)** remains and cannot be settled without a browser and GA4 DebugView: Google's and Meta's own history-change page views can fire on a private page before our pause runs. No High. **No GA4 or Meta id may be set on a staging or public URL** until A-M1 is checked or mitigated, the owner has accepted the two wildcards in writing (B-32, DEC-093) and the client's counsel has reviewed wording and mode (Q-012).
- No secret found in the range. `npm audit --omit=dev`: 7 findings (1 low, 4 moderate, 2 high), identical on the committed lockfile and on the working tree; no new package in the range.

## Method

Read CLAUDE.md, `.claude/rules/security.md`, THREAT_MODEL rows, ANALYTICS.md, GUEST_TRACKING.md, SECURITY_HEADERS.md, both earlier reviews; then the code named in each finding.
Ran (all real output, 2026-10-24):

| Command | Result |
|---|---|
| `npx vitest run tests/unit/orders tests/unit/routes/track-order.test.ts app/lib/orders` | 7 files, 458 tests, pass |
| `npx vitest run tests/unit/analytics tests/unit/ui/footerPrivacyChoices.test.tsx app/lib/security-headers.test.ts app/lib/analytics.test.ts app/lib/seo` | 27 files, 555 tests, pass |
| `node --test scripts/node-server/node-server.test.mjs` | 48 tests, pass (includes two raw-HTTP adapter tests with spoofed address headers) |
| `node --test scripts/perf/bundle-budget.test.mjs` | 14 tests, pass |
| `npm audit --omit=dev` (working tree) and the same against `git show HEAD:storefront/package-lock.json` | 7 vulnerabilities both times, same set |
| Probe with vite-node (script kept in the scratchpad, nothing written to the repo) | `evaluatePage` on 38 hostile addresses, referrers and titles; `enforcedCspExtras` output. Results quoted below |
| Added-line scan of the range: Shopify token prefixes, `sk_live`, `ghp_`, AWS key, PEM, JWT, real-looking GA4 ids, `console.*`, `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `new Function`, `document.write` | none outside test placeholders (`G-ABCD1234`, `G-TESTTEST01`) and prose; `git ls-files` shows only `.env.example` as an env file |

The QA results in `progress/TEST_RESULTS.md` (V-E164 to V-E203: production preview, enforced CSP, 0 `securitypolicyviolation`, chunk requested only with ids, spoofed-address rotation not dodging the limit) are agent-reported and were not re-run here; I cite them as supporting, not as my evidence.

## Guest tracking: status of each earlier finding

| Earlier | Status | Evidence |
|---|---|---|
| M-1 address header chain | **Closed in code.** Not run behind a real nginx | nginx overwrites `X-Real-IP` and `X-Forwarded-For` with `$remote_addr`, blanks `Forwarded`, `CF-Connecting-IP`, `True-Client-IP`, `Oxygen-Buyer-IP` (`deploy/nginx.conf.example:233-243`; an empty value makes nginx drop the header). Adapter drops the three platform names always, drops `x-real-ip`/`x-forwarded-for` unless `TRUST_PROXY=true` and then sets `x-real-ip` from the socket (`scripts/node-server/adapter.mjs:188-225`); `TRUST_PROXY=true` is refused unless `BIND_HOST` is loopback (`config.mjs:129`). The app reads only the header named in `TRUSTED_CLIENT_IP_HEADER`, no default, five allowed names, unlisted, absent, joined or malformed gives the shared `unknown` bucket (`app/lib/orders/guest-lookup-address.ts:117-129`). `deploy/mattressfitness.env.example` sets `TRUSTED_CLIENT_IP_HEADER=x-real-ip`; `.env.example` has the name. Tests: raw-HTTP adapter tests `node-server.test.mjs:833-880` (spoofed `oxygen-buyer-ip`, `cf-connecting-ip`, `true-client-ip`, `x-real-ip`, `x-forwarded-for` never reach the handler; `x-real-ip` equals the socket address; behind a trusted proxy the proxy value arrives and the platform names still do not); `guest-lookup-address.test.ts` (no default, spoofed names ignored when another is configured, no fallback, joined values refused, /64 and IPv4-mapped keys) |
| L-1 order of counters, concurrency | **Closed** | `reserve(steps)` checks every counter (overall first) and records all only if all allow, in one synchronous call after all key hashes exist (`guest-lookup-limiter.ts:122-145`, `:357-393`); a refused attempt records nowhere; per-order counter (10 per 15 min, `:221`, `:310-315`) cannot be dodged by changing address or email. Tests: 50 parallel guesses at one order from 50 addresses, from one address, for one email, 400 parallel against the overall ceiling, refused attempts record nowhere, real async hasher (`guest-lookup-limiter.test.ts:342-434`). A shared store without `reserve` falls back to peek then hit and can overshoot by the requests in flight; documented, applies only to the future P6-14 store |
| L-3 nginx zone | **Closed in the template; never run** | `map "$request_method$uri" $mf_key_lookup` for `POST /track-order(.data)?` (`:35`), `limit_req_zone ... zone=mf_lookup:5m rate=6r/m` (`:44`), `limit_req zone=mf_lookup burst=5 nodelay` in `location /` (`:224`). `$uri` is normalised and decoded, `~*` is case-insensitive, so `//track-order`, `/TRACK-ORDER` and `/track%2Dorder` match. The `POST /cart` zone (A-L1) is in the same file. `nginx -t` is not available here: **unverified** |
| L-4 tracking links | **Closed** | `guest-lookup.ts:289-403`: https only, no credentials, default port, plain hostname (no IP literal, no trailing dot, letter-only TLD), at most 2000 characters, host equals or is a subdomain (dot-boundary, so `evilups.com` fails) of the built-in five or `TRACKING_LINK_HOSTS`; extras refused when they carry scheme, path, port, wildcard, IP, single label, space, more than 30, or look like a public suffix (`:319-326`). Unlisted link: shown as text. Tests in `guest-lookup.test.ts` pass. Residual: the public-suffix rule is a rule of thumb (`github.io`, `pvt.k12.ma.us` not caught); entries are set by the owner (Info N-3) |
| L-5 IPv6 /64 | **Closed** | `guest-lookup-address.ts:94-111` (`v6:` + first four groups; `::ffff:a.b.c.d` becomes IPv4), 200-variant rotation test |
| L-6 noindex prefix | **Closed** | `/track-order` in `NON_INDEXABLE_PREFIXES` (`seo/canonical.ts:33`), deliberately not in the robots Disallow list; `seo.test.ts` passes |
| I-2 hasher cache | **Closed** | `createKeyHasher` clears a rejected key and retries once (`limiter.ts:166-199`) |
| L-2 lock-out trade-off | **Open: owner acceptance not recorded** | Counters (email 5, order 10) still let anyone hold one email or order shut for 15 minutes; the message offers sign-in. Proposal stays: accept |
| L-7 separate Admin token | **Open** | Still the shared `SHOPIFY_ADMIN_API_ACCESS_TOKEN`; GUEST_TRACKING.md:58 still advises a separate app and token |

### New or residual items, guest tracking

- **N-1 (Low, T-13): no startup check for `TRUSTED_CLIENT_IP_HEADER`.** Nothing in `scripts/node-server/config.mjs` warns when it is missing or not `x-real-ip` on the VPS. Unset means every shopper shares one bucket (10 attempts per 15 minutes for the whole site; one client can then lock the lookup for everyone). The env template sets it, so this is a deployment-mistake risk. Fix: devops adds a warning in the node server's startup check, or the readiness script, when `TRUST_PROXY=true` and the variable is not `x-real-ip`; the log already carries `clientSource=none` per refusal, so alert on a rising count.
- **N-2 (Low, T-13): nginx keys the zone on the whole IPv6 address, the app on the /64.** `limit_req_zone $mf_key_lookup` uses `$binary_remote_addr`. The app's per-/64 counters (10 per 15 minutes) still bind a single home connection, and the nginx zone is only a burst brake (6 per minute, burst 5, about 90 per 15 minutes, so it is not the 15-minute cap), so the effect is small. Fix: key the zone on a /64 prefix of `$remote_addr` through a `map` with a named capture, when nginx is first run.
- **N-3 (Info):** `TRACKING_LINK_HOSTS` public-suffix check is heuristic (above). A carrier domain that later lapses and is re-registered would pass; owner review of the list at each handover.
- **N-4 (Info, doc drift):** GUEST_TRACKING.md:3 still says L-3 and the nginx and adapter side of M-1 "are not done here" and :63 says the names are "not yet in the root `.env.example`, `docs/deployment` or the runbook"; both are done (`101d8a9`, `.env.example`, RUNBOOKS.md and VPS_RUNBOOK.md mention the variable). Correct the text.

## Analytics consent: status of each earlier finding

| Earlier | Status | Evidence |
|---|---|---|
| M-1 page address, title, referrer | **Closed for the events we send; one new Medium on automatic provider events (A-M1); residual Low items (A-L1, A-L2)** | `evaluatePage` (`page-context.ts:104-154`) blocks private paths, a personal-looking query value or path, a personal search term; `runtime.track` sends nothing, loads nothing and pauses a resident Google tag on an unsafe page (`runtime.ts:238-251`, `:118-128`); `ga4.ts:110-119` sets reduced `page_location`, `page_referrer`, `page_title` before `config` and on each page view. Probe results below |
| M-2 withdrawal | **Closed** | `PrivacyChoicesButton` is rendered in the footer (`SiteFooter.tsx` diff, `<li className="empty:hidden">`), opens the preferences with the current choices; footerPrivacyChoices unit test passes; QA e2e (agent-reported) saw requests stop and cookies cleared |
| L-1 CSP hosts | **Closed in code; owner approval of the two wildcards still missing** | `hosts.ts:30-46`. GA4: script `www.googletagmanager.com`; img the same plus `*.google-analytics.com`; connect `www.googletagmanager.com`, `*.google-analytics.com`, `www.google.com`, `analytics.google.com`, `*.analytics.google.com`. No `*.google.com`. Meta: script `connect.facebook.net`; img `www.facebook.com`; connect `www.facebook.com`, `connect.facebook.net`. Parity: probe of `enforcedCspExtras` with both providers gives script, img and connect lists equal to the `analyticsCspHosts` lists that `buildReportOnlyCsp` uses (`security-headers.ts`), `{}` with no id, and the report-only string is byte-identical with `analytics: {}` and with it omitted. Hydrogen appends the nonce to a named `scriptSrc` (`index.js` `createCSPHeader`, checked). No `unsafe-inline`/`unsafe-eval`/bare `*` added. DEC-093 records the proposal; B-32 holds the owner's written approval, **not given** |
| L-2 cookie clearing | **Closed with a gap (A-L3)** | `cookies.ts:14-41` expires `_ga`, `_ga_<id>`, `_fbp`, `_fbc` on the host and every parent suffix of two labels or more, with and without a leading dot; unit tests include `www.shop.example.com`, `a.b.co.uk`, IP, `localhost` |
| L-6 cross-tab withdrawal | **Closed** | `attachConsentRefresh` re-reads on `storage`, `focus` and `visibilitychange` (`browser.ts:88-110`), wired in `ConsentRuntime.tsx:102` |
| I-1 consent mode text | **Closed** | `config.ts:40-44` exact match (`OPT-OUT`, ` opt-out `, `opt-out\n` give opt-in; tests `config-consent.test.ts:31-38`); ANALYTICS.md:29 and `.env.example` agree |
| L-3 banner claim | **Closed** | `bannerSentence` says only the Google/Meta tools wait (`ConsentBanner.tsx:18-35`) |
| L-4 scripts on private pages | **Closed, subject to A-M1** | no load and pause on `/account`, `/track-order`, `/delivery`, `/checkout-steps`, `/discount` |
| L-5 GPC | **Open (counsel, Q-012)** | unchanged, recorded in ANALYTICS.md |
| L-7 unsigned cookie | **Accepted in ANALYTICS.md**; owner acknowledgement not on record | unchanged |
| I-2 no SRI | **Accepted proposal**; not signed by the owner (DEC-094) | unchanged |

### Findings, analytics

#### Medium

**A-M1 (T-05, T-10; open, unverifiable here): Google's and Meta's own history-change page views can carry a private page's address before our pause runs.**
Evidence: our pause is applied inside `runtime.track()` (`runtime.ts:238-251`), which runs only when `PageViewTracker` fires from a React effect after the navigation has committed (`AnalyticsBridge.tsx:145-156`). Nothing looks at the navigation target before it commits (grep of `app/components/consent` for `useNavigation`, `history`, `pushState`: no match). React Router changes the address with `history.pushState` when the navigation completes, before that effect. gtag.js with Enhanced measurement "Page changes based on browser history events" (on by default) sends its own `page_view` from the history change, and `send_page_view: false` (`ga4.ts:132`) is documented by Google to cover the initial load, not necessarily history-change views (not confirmed here). ANALYTICS.md:156 tells the client these are "acceptable"; ANALYTICS.md:149 says whether `gtag('set')` applies to automatic events is UNVERIFIED. Meta's pixel behaviour on `pushState` is also unknown. The ordering was never tested with the real vendor scripts (QA used a network stub, V-E184 to V-E203).
Impact: a consenting shopper who moves by in-app link from a safe page to `/account/orders/<id>`, `/track-order` or `/delivery` may have that address (an order id for the first) reported to GA4 (and possibly Meta) with the title of the page in transition. The order id is an opaque Shopify id, not a name or email, so the severity is Medium rather than High, but it breaks the stated guarantee that private pages send nothing.
Fix (any one is enough to start; the first two together are the robust answer):
1. GA4 admin (client): switch **off** "Page changes based on browser history events" in Enhanced measurement; we already send one `page_view` per navigation. ANALYTICS.md:156 should say "off", not "acceptable".
2. Code (developer): pause before the address changes. In the bridge, read `useNavigation().location` (the pending target) and call the same unsafe-page path when its pathname is private, and resume on `idle`; or have the runtime pause on a document-level `click` of any link whose `href` resolves to a private prefix.
3. Verification (QA, needs a GA4 property and DebugView, CLR-004): navigate by link from a product page to `/account/orders/<id>` and to `/track-order` with consent given and the real `gtag.js`; expect no hit with those addresses; repeat for Meta Test Events. Record in `progress/TEST_RESULTS.md`.
Until done, this is a condition for setting any id outside a developer machine.

#### Low

**A-L1 (T-05; residual after the numeric relaxation): the guard is a deny-pattern net, and several shapes get through.** Probe on `evaluatePage` (result column is the verdict; the reported address is in the table's third column where it matters):

| Input | Verdict | Comment |
|---|---|---|
| `/search?q=jane@example.com`, `?q=555-123-4567`, `?q=555-1234` | unsafe | search term uses the 7-digit rule; correct |
| `/search?q=123+Main+St`, `?q=90210`, `?q=jane+at+example+dot+com` | safe | accepted residual (I-4), also sent as `search_term` |
| `/account/orders/<gid>`, `/TRACK-ORDER`, `/%61ccount`, `/\account`, `/delivery`, `/discount/ABC`, `/checkout-steps` | unsafe (private) | variants normalised |
| `/%2561ccount`, `/account;x=1` | safe | the router does not route either to `/account`; fine |
| `/?utm_content=5551234567`, `/?utm_content=Jane%20Smith` | **safe** | the relaxation for `utm_*` (email only, `privacy.ts:36-42`): a phone number or a name in a campaign tag passes |
| `/?utm_content=a%2540b.co` (double-encoded `@`) | **safe** | the value is checked once after one decoding |
| `/collections/x?zip=90210`, `?phone=5551234`, `?name=Jane` | safe | only email or ten digits trip it; the reduced address drops these keys but gtag/Meta read the real address |
| `/collections/x?phone=5551234567`, `?e=a@b.co`, `/pages/a@b.co`, `/pages/a%40b.co` | unsafe | |
| `/collections/x#a@b.co`, `#5551234567` | **safe** | the fragment is never evaluated |
| `/products/x?variant=44123456789012` | safe | by design |
| `?variant=jane@example.com`, `?gclid=a@b.co` | **safe** | `queryValueLooksPersonal` returns false for `variant` before any email test (`privacy.ts:38`), and `evaluatePage` skips the opaque click-id keys entirely (`page-context.ts:121`) |
| `/?mc_eid=1234567890` | unsafe | false positive: a 10-digit opaque id disables analytics for that page (availability, not a leak) |
Titles: `Hi jane@x.com` and `Call 555-123-4567` become `Page`; **`Order #1001` passes** (`cleanTitle`, `page-context.ts:78-81`; four digits). Order pages are private so this only matters if a stale title from the previous page is read during a transition (unverified).
Does the relaxation open a PII path from this site? No: no first-party route puts personal data in a query (grep of `searchParams`/`URLSearchParams` in `app/`: filters, sort, `q`, compare handles, quiz flow state, variant options, `redirect`/`discount`; the ZIP is a cookie and `/delivery` is private). The remaining exposure is third-party-built links (an email tool that puts a recipient's phone or name in `utm_*`), a shopper who edits the address themselves, and the quiz state in the URL on `/quiz` (sleep position, comfort, budget, size: not identifying). Hence Low.
Fix (cheap, all in `privacy.ts`/`page-context.ts`): (a) run the email test on every value, including `variant` and the opaque click ids (a click id never contains `@`); (b) require `variant` to match `^\d{1,20}$` or a gid, otherwise treat as any value; (c) test a value once more after a second `decodeURIComponent`; (d) evaluate `url.hash` with the email and ten-digit rules; (e) treat `utm_*` values containing a phone-like run of ten digits as personal again (a campaign named after a date has eight); (f) add a title rule for the word "Order" followed by a number. Add the probe table as unit cases.

**A-L2 (T-05, T-10; known residual, not fixed): Meta's view of a search page and the referrer after a private page.** Unchanged from ANALYTICS.md:147-148. New information: `document.referrer` is fixed at document load and does not change on in-app navigation, so the risk is a full page load that follows a click from `/account/orders/<id>` (same-origin referrers keep path and query under `strict-origin-when-cross-origin`). Fix when convenient: send `Referrer-Policy: same-origin` or `origin` on `/account*` and `/track-order` responses (the policy of the page you leave decides), through `withSecurityHeaders`.

**A-L3 (T-16): cookies are not removed when consent is withdrawn before the script has loaded in this visit, or when it expires.** `runtime.deactivate` calls `adapter.revoke()` (which clears the cookies) only for a `ready` provider; for `scheduled` it only cancels the load (`runtime.ts:214-226`), and an expired decision (180 days) never reaches it. `_ga` (two years) and `_fbp` (90 days) set on an earlier visit therefore stay in the browser. No data flows (no script, no events), so this is hygiene. Fix: on withdrawal and on first start without consent, expire the documented cookie names through the same `clearCookies` helper whatever the state.

#### Info

- **A-I1 (T-05): memory-only holds.** `track()` holds up to 25 events before the sink exists, including the raw `page_location: window.location.href` of a page view (`analytics.ts:88-96`, `AnalyticsBridge.tsx:152-155`); the runtime keeps the latest raw page view and up to 10 page events (`runtime.ts:91-97`). Everything is sanitised again at the adapter (`sanitizeParams`, `toMetaCall`) before it leaves, nothing is stored, and a private page clears them (`runtime.ts:243-246`). Withdrawal empties queues but not `lastPageView`/`remembered`; they only go out if the shopper re-consents on the same page. `earlyViews` keeps Hydrogen's raw `product_viewed` and `search_viewed` payloads, which include the cart and its buyer fields, until the chunk takes them (`gate.ts:67-85`); if the chunk is blocked they stay for the life of the page. Memory only, same origin, and Hydrogen holds the same object, so no action is needed; if wanted, drop the cart from the kept payload.
- **A-I2: replayed held events are judged against the page at replay time**, not the page that produced them (`runtime.ts:238-251`). A listing event produced before a navigation to `/account` is dropped (safe direction); one produced on page A and replayed on safe page B is attributed to B (accuracy only).
- **A-I3: new attack surface checked, no finding.**
  - Consent chunk: the dynamic import path is a literal (`AnalyticsGate.tsx:38-44`), same origin under `/assets/`, covered by `'self'` in both policies; no SRI, as for every other chunk. A failed download resolves to a component that renders nothing. QA (agent-reported) saw it requested only with ids and no `securitypolicyviolation` on a production preview.
  - Provider script nonce: `useNonce()` is passed as a prop, set with `script.nonce` (`script-loader.ts:45-46`); the loader refuses any origin outside the two provider origins before an element exists.
  - Body padding and `ResizeObserver`: numeric values from `offsetHeight` and `getComputedStyle` written to `style`, restored on cleanup (`ConsentBanner.tsx:45-70`); no HTML sink, not blocked by CSP.
  - `data-si`: `product.id|cents|index|listId` is built from a Shopify gid, cents and a path-derived list id (`listing-analytics.ts:21-33`); the title is the link text, not in the attribute. The reader (`hydrogen-events.ts:160-192`) caps the value at 300 characters, requires exactly four parts, re-validates the gid (`productIdFrom`), whole cents (nine digits), position (four digits) and the list id pattern; a `|` in a handle gives no event. React escapes the attribute; no injection path from a product title or handle.
  - Listing events: `listing-events.ts` is imported with `import()` from the listing effect, builds from the card data already on the page, sends through `track()`.
  - Withdrawal path (footer button, store, dialog) and cross-tab refresh: no issue.
- **A-I4: the working-tree `package-lock.json` change** (uncommitted, 11 lines) only drops `"dev": true` from the optional `lightningcss-*` platform binaries; `package.json` is unchanged and the audit result is the same. Revert it, or commit it on its own, with a reason (the lockfile is never hand-edited, `.claude/rules/git-practices.md`).
- **A-I5 (doc):** ANALYTICS.md:156 should read "off" for history-change page views (A-M1). SECURITY_HEADERS.md:81 still says "Never a wildcard host" without the pointer to DEC-093 in that sentence (line 71 has the exception); align after the owner decides.

## Dependencies (T-12)

`npm audit --omit=dev` run on the working tree and on the committed lockfile: 7 vulnerabilities (1 low, 4 moderate, 2 high), same on both, so nothing in this range added or changed one. The earlier note described all seven as router-related; the list is `esbuild` 0.27.3 to 0.28.0 (arbitrary file read by the dev server on Windows), `lodash` <= 4.17.23 (high: `_.template` code injection, `_.unset`/`_.omit` prototype pollution), `react-router` 6.0.0 to 7.18.1 (high: open redirect via backslash in `<Link>`/`useNavigate`, RSC XSS and CSRF items, constructor injection in `deserializeErrors`, unauthenticated DoS through inefficient route matching), and the dependents `@react-router/node`, `@react-router/dev`, `@shopify/hydrogen`, `react-router-dom`. Installed: react-router 7.16.0, @react-router/dev 7.16.0, @shopify/hydrogen 2026.4.7. `esbuild` and `lodash` come from the build toolchain (`@react-router/dev`, `@shopify/cli`, GraphQL codegen) and do not ship in the server bundle. The router items matter at runtime: the DoS through route matching (T-13, pairs with the nginx zones) and the backslash open redirect (T-08; our `<Link>` targets in the new banner are constants and redirects are allow-listed). The npm fix is `--force` to `@react-router/dev` 7.18.4, outside the held range. `npm view` shows `@shopify/hydrogen` `latest` = 2026.10.2 (we hold 2026.4.7, ADR-0008). Not a Gate-G5 blocker by itself (ADR-0008 is the recorded hold); **recommend revisiting ADR-0008 before the first public URL**: do the compatibility check for Hydrogen 2026.10.x and re-run the audit. No new package, Action or MCP server in the range.

## Secrets and PII (T-04, T-05)

No secret, token or customer value in the range (scan above). The new env names in `.env.example` and `deploy/mattressfitness.env.example` are names only (`TRUSTED_CLIENT_IP_HEADER`, `TRACKING_LINK_HOSTS`, `PUBLIC_CONSENT_MODE`; the commented future `GUEST_LOOKUP_KEY_SECRET` has no value). No `.env` file was read. The new logs carry event names, codes and counts only (`guest_lookup.*`, `analytics.provider_failed` with provider and a fixed reason). The client address is never logged. No PII in analytics payloads as built (named-field mappers, allow-listed parameter names, value filters) except the accepted residual of free-text search terms and the items in A-L1.

## Threat model rows (proposed; THREAT_MODEL.md not edited, this review writes one file)

| ID | Proposed status | Evidence | Still open |
|---|---|---|---|
| T-09 | Partial, code-side conditions met | this note; 458 unit tests; 48 node-server tests with raw-HTTP spoofing | owner acceptance of the lock-out trade-off (L-2); dev store and `read_orders`-only token (V-09, V-20, L-7); B-11 (SD-05) |
| T-13 | Partial | atomic reserve, per-order counter, nginx lookup and cart-post zones in the template; router DoS advisory open (audit) | `nginx -t` and a real-host abuse test (B-19); N-1, N-2; shared store (P6-14) |
| T-05 | Partial | events verified in code; safe-page guard probed; footer withdrawal | **A-M1**, A-L1, A-L2; network inspection once ids exist (DebugView, Test Events) |
| T-10 | Partial | origin allow-list, per-id CSP hosts with parity, nonce, consent and idle gating verified in code and by QA on a production preview (agent-reported) | owner's written approval of the two wildcards and the SRI decision (B-32, DEC-093, DEC-094); real hosts GA4 and Meta call (report-only run with a real id); A-M1 |
| T-16 | Partial | opt-in default, exact mode parsing, withdrawal button, cross-tab refresh, parent-suffix cookie clearing | A-L3; GPC (L-5) and wording, mode, lifetime (Q-012); privacy policy page matching practice |
| T-07 | Verified in code for these routes | `/track-order` non-indexable; tracking-link rules; no HTML sink in the range | none new |
| T-12 | Partial | audit result unchanged, 7 findings under ADR-0008 | revisit ADR-0008 before a public URL (Hydrogen 2026.10.x) |

## What remains open for a security gate (G5), by owner

1. **Developer:** A-M1 pre-navigation pause (or confirm by test it is unnecessary); A-L1 guard tightening with probe cases; A-L3 cookie clearing in every state; A-L2 referrer policy on private routes; N-1 startup warning for the trusted header; N-2 /64 key in nginx; fix doc drift N-4, A-I5.
2. **Devops:** run `nginx -t` on the template with real names and certificates; confirm on the VPS that a request with `Oxygen-Buyer-IP`, `CF-Connecting-IP`, `True-Client-IP`, a forged `X-Real-IP` and `X-Forwarded-For` reaches the app with the socket address in `x-real-ip` and the others gone; load-test the zones; `TRUSTED_CLIENT_IP_HEADER=x-real-ip` in `/etc/mattressfitness/env`.
3. **QA with accounts:** GA4 DebugView and Meta Test Events checks from ANALYTICS.md "GA4 administration checklist" item 6, plus the history-change case of A-M1; a report-only run with a real id on staging to confirm or remove each Google host (`www.google.com`, `analytics.google.com`, `*.analytics.google.com`) and to complete Meta's list.
4. **Project owner (written):** accept or reject the two CSP wildcards (B-32, DEC-093), SRI absence (DEC-094), the email and order lock-out trade-off (L-2), per-process counters that reset on restart, L-7 (unsigned `mf_consent`). **Client:** GA4 admin settings (Enhanced measurement site search, form interactions, outbound clicks and history changes off; data redaction; retention), privacy policy page, counsel review of mode, wording, lifetime and GPC (Q-012), carrier domains for `TRACKING_LINK_HOSTS`, acknowledgement of SD-05.
5. **Dev store:** guest lookup against a real store with a `read_orders`-only token (V-09, V-20): query validity, 60-day window, protected customer data approval, Admin latency against the 800 ms floor.

## Could not verify

- Any browser or vendor behaviour: what GA4 and Meta actually receive, whether `gtag('set', ...)` reaches automatic events, history-change page views (A-M1), Meta's reading of address and referrer, which Google hosts GA4 calls, Meta's host list, nonce acceptance by the real vendor scripts. QA's stub-based runs are agent-reported.
- nginx and systemd: no nginx binary here; the zones, the header blanking and the regexes are read, not executed. Behaviour behind a CDN is undesigned (Q-003).
- The guest lookup against Shopify (everything in GUEST_TRACKING.md "UNVERIFIED list").
- Whether Oxygen overwrites an inbound `oxygen-buyer-ip` (only relevant if Oxygen is chosen; the variable must then be named explicitly).
- Legal sufficiency of consent wording, mode, GPC handling, retention.
- A built client bundle was not inspected in this round (no rebuild, to avoid writing artefacts); the earlier rounds' bundle checks stand, and the range adds no server-only import to a client module (the consent files import only `~/lib/*` pure modules and `@shopify/hydrogen` client exports).
