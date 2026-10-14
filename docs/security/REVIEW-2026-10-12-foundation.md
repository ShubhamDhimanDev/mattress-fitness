# Security review: foundation commit 2740454

Reviewer: security-engineer. Date: 2026-10-12 (resumed 2026-10-13). Scope: commit `2740454` on `feat/foundation-libs-and-shell` (216 files: Extend library and mock, offers and delivery logic, guest lookup, quiz, stores, design shell, catalog and Shopify scripts, CI). Method: `git archive` export to a scratch directory, `npm ci`, `npm audit`, production build, bundle grep, hostile-input probes (esbuild bundle of the real modules, run on Node 22), and code reading from `git show`. Nothing was run against a live or third-party system. No secret values appear in this note.

Gate verdict: **PASS WITH ACCEPTED RISKS (proposed)** for a foundation commit that deploys nothing. It is not a verdict for production. Conditions: the owner accepts H-1 in writing (ADR-0008 is still "Proposed"), and M-1 to M-4 are fixed or scheduled before the gate of the phase named in each row. No finding is a secret exposure or a price-tampering path in the code under review.

## Findings

### High

**H-1. react-router 7.16.0 has open high-severity advisories (T-12, T-13).** Evidence: `npm audit --omit=dev` in the export reports 7 findings, 2 high (react-router, lodash), 0 critical. react-router range `6.0.0 - 7.18.1` includes GHSA-chx6-hx7r-mcp5 (unauthenticated DoS in route matching, high), GHSA-qwww-vcr4-c8h2 (RSC-mode CSRF bypass, high, RSC mode is not used here), plus moderate open-redirect (backslash in Link), hydration constructor injection and RSC XSS. Full tree: 53 findings, 38 high, mostly the GraphQL codegen and mini-oxygen toolchain (build-time, not shipped). The lodash high (`_.template` code injection) is reached through build tooling, not request handling. Impact: a remote shopper can degrade availability of every route. Fix: complete P1-12 (Hydrogen 2026.10 migration, ADR-0008) before any public deployment; until then the owner records acceptance for development only, and a CDN or host request limit is in front of any staging URL. CI already reports this with `continue-on-error` (`.github/workflows/ci.yml`), which is fine now and must become blocking at Phase 7.

### Medium

**M-1. Open redirect in `/discount/:code` (T-08).** `storefront/app/routes/discount.$code.tsx:24` blocks only `//`. `redirect=/\evil.com` and `redirect=/%09/evil.com` pass the check. Proof: `new URL('/\\evil.com?a=1','https://shop.example').href` gives `https://evil.com/?a=1`. Impact: phishing from a link on our domain; the same route also applies a discount code from a URL. Fix: accept only a path that matches `^/(?![/\\])[A-Za-z0-9/_\-.%?=&]*$`, strip control characters and backslashes, resolve with `new URL(p, origin)` and require `origin` equality, else `/`. Scaffold code, not changed by this commit, but it is shipped.

**M-2. `/cart/:lines` builds a cart and redirects to checkout with no offer revalidation (T-01, T-02, T-06).** `storefront/app/routes/cart.$lines.tsx:23-62` accepts any variant id and `parseInt` quantity (NaN and huge values pass through to Shopify) and returns `checkoutUrl`. A gift, haul-away or coverage variant can be bought alone, which is exactly what `evaluateOffers` would remove or reject. The engine itself is sound (see "Checked and sound") but is not wired to any route in this commit, so server revalidation is unproven end to end. Fix: delete the route (not in any requirement) or run `evaluateOffers` plus `revalidationOutcome` on the created cart and refuse on `rejected`; clamp quantity to 1..99 and reject non-integers. Direct Storefront API carts remain possible by design (ADR-0006), so the post-order detective report is still needed (P5B).

**M-3. Unsanitised Shopify HTML rendered with `dangerouslySetInnerHTML` (T-07).** `routes/pages.$handle.tsx:65`, `policies.$handle.tsx:56`, `blogs.$blogHandle.$articleHandle.tsx:90`, `products.$handle.tsx:120`. Content is client-authored, so exposure is a compromised or careless admin account, but the rule (`.claude/rules/security.md`) forbids it. The nonce-based CSP blocks injected inline script, not injected forms, links, iframes or styles (`style-src` allows `unsafe-inline`). Fix: server-side allow-list sanitiser (new dependency needs an ADR) or render Shopify structured rich text; add malicious-fixture tests. Due by Phase 3B.

**M-4. Eligibility inputs for haul-away are shopper-supplied (T-02).** `haulAwayEligibility` (`offers/haul-away.ts`) trusts the ZIP (cookie or buyer identity) and the `delivery_choice` cart attribute. Probe: with a forged `delivery_choice=in-home` and an outside ZIP the engine correctly rejects, but a shopper can store an in-zone ZIP and then enter an out-of-zone shipping address at checkout; nothing compares the two. Impact: unfulfillable service lines. Fix: the P5B detective report must compare the order shipping ZIP with `isInZone`; optionally pass the ZIP to checkout through buyer identity so the two agree. Residual, matches ADR-0006.

### Low

- **L-1. Webhook dedupe and topic are unsigned headers (T-03).** `extend/webhook.ts` signs the body only; `X-Shopify-Webhook-Id` and `X-Shopify-Topic` are not covered. Anyone holding one valid signed body can replay it with fresh ids forever (`maxAgeMs` is off by default; the memory store is per isolate). Probe: valid, replayed id, bad signature, empty secret all behave as designed (accepted / ignored / 401 / 401). Effect is bounded because the route must re-read the order and the snapshot PUT is idempotent, but the ADR-0009 claim "replay is a no-op" is overstated: it is an amplification of Admin API and Extend calls. Fix: debounce per order id in the route, set `maxAgeMs` above 4 h, reject on `Content-Length` over the cap before buffering. The route does not exist yet, so T-03 is verified for the library only.
- **L-2. Coverage discounted at checkout is still reported at full price.** `extend/orders.ts` compares the quote with `unitPriceCents` and ignores `paidUnitPriceCents` for coverage lines; `plan.purchasePrice` is quote times quantity. A discount code that reduces the coverage line makes the Extend report and the revenue disagree. Fix: flag coverage lines where paid price differs from unit price (staff review).
- **L-3. `parseExtendHost` accepts loopback (including `https://[::1]`) in every environment** (probe output; `extend/config.ts`). A production misconfiguration would send orders to a dead local address silently. Fix: allow loopback only when a `NODE_ENV`/mock flag is set. The token default `mock-access-token` in `scripts/mocks/extend-mock.mjs` is a fake value.
- **L-4. Session cookie lacks `secure`** (`app/lib/session.ts`: httpOnly, sameSite lax, no `secure`). Add `secure: true` outside local dev.
- **L-5. Guest lookup limiter (T-09, T-13).** Logic verified by probe: 10 per address then blocked; 5 per email then blocked even from distinct IPs; generic `no_match` for wrong email, no order, null candidate; order numbers with `*`, ` OR `, Arabic digits are invalid; the query text is a constant with the search string as a variable. Gaps: state is per isolate; the global limit of 300 can be used to lock out all guests, and 5 attempts on a victim email lock that email out (griefing); the route is not written, so the client-IP source is unchosen. See the shared-store proposal below.
- **L-6. Staged-upload allow-list is broad** (`scripts/catalog/images.mjs`): any `*.s3.amazonaws.com` or `storage.googleapis.com` host passes. It only matters if Shopify's response is hostile; `redirect:'error'` and https-only are in place. Tighten to the host observed on the first dev-store run.
- **L-7. CI.** Actions are pinned to version tags, not commit SHAs (`actions/checkout@v4.2.2` etc.); permissions are `contents: read` (good); no secret scan step exists though T-04 lists one; Playwright browsers install from the network. Fix: pin SHAs when the repo moves to the client, add gitleaks or an equivalent.
- **L-8. Agent deny rules cover repo-root `.env` only** (`.claude/settings.json`: `Read(.env)`). Use `Read(**/.env)` and `Read(**/.env.*)` so `storefront/.env` is covered. `@playwright/mcp@0.0.83` is pinned; the Figma server is a remote HTTP server, so unpinned by nature (T-15).
- **L-9. Scaffold `search.tsx` renders an `error` string from the loader** to the shopper (`{error && <p>...}`). If it carries upstream error text it leaks internals. Use a fixed message; log server-side.

## Checked and sound (evidence)

- **Secrets (T-04).** Token-pattern scan of `git log -p --all` (Shopify, GitHub, AWS, Slack, Stripe, JWT, private keys): 0 hits. Generic `secret|token|key = "<20+ chars>"` scan of the export: 0 hits. The only long hex literal is the public RFC 4231 test vector in `extend/webhook.test.ts`. `git log --all --name-only` shows `.env.example` as the only env file ever tracked; it holds names only. `.gitignore` ignores `.env*` and importer manifests.
- **Bundle.** `npm run build` succeeded. In `dist/client` (54 files): 0 hits for `EXTEND_`, `SHOPIFY_ADMIN`, `SHOPIFY_APP`, `SESSION_SECRET`, `PRIVATE_STOREFRONT`, `CLIENT_SECRET`, `JUDGEME`, `X-Extend-Access`, `api.helloextend`, `X-Shopify-Access`, `GuestOrderLookup`, `verifyShopifyWebhook`. Client contains only `PUBLIC_CHECKOUT_DOMAIN` and `PUBLIC_STOREFRONT_API_TOKEN` (public by Hydrogen design). `lib/extend/**` and `lib/orders/**` are not imported by any route yet.
- **ZIP and zones (T-02).** Probe: Arabic-Indic and full-width digits rejected; `60601-1234` and `60601 1234` reduce to the 5-digit ZIP; bare `*`, `12345*` dropped from lists; `606*` covers 60600-60699 only; a one-digit prefix `6*` is valid by design (10,000 ZIPs) and is a content risk, not a code flaw. 100,000-character lists fail closed.
- **Offer engine (T-01, T-02, T-06).** Probe: haul-away over max corrected to max; pickup, missing ZIP, outside ZIP produce violation `haul-away-not-eligible`; quantity 0, negative, fractional, NaN produce `invalid-quantity`. Corrections only lower or remove; code reads as idempotent; Maps used so `__proto__` sizes are inert. No price is computed anywhere.
- **Extend cross-check (ADR-0009 item 7).** Coverage lines need a plausible plan id, a resolvable covered product present in the same order, no duplicate coverage, and a fresh quote whose price equals the charged unit price; an unverifiable lookup throws and the sync retries instead of passing. Flagged lines never reach Extend. Flags are only logged; there is no staff alert channel yet.
- **Extend HTTP.** Host allow-list verified by probe (userinfo, suffix, port, http all null); `redirect:'error'`, per-request timeout, 1 MB response cap, bounded retries (4, 30 s total), token in a closure, closed log-event shape with no PII fields.
- **Output.** `serializeJsonLd` turns `</script>`, `&` and U+2028 into escapes (probe); Maps directions URL encodes `&`, `#`, `?`; filter codec drops unknown values, bounds repeats and cursor format; predictive search now encodes `q`; `_dev.components` returns 404 in production builds.
- **Scripts (T-14).** Dry run default; store must be a `*.myshopify.com` domain in `SHOPIFY_ALLOWED_STORES`; `--live` required for writes; client refuses mutations unless `allowMutations`; token only in a header and redacted from logs and responses; CSV cells reject formulas, HTML and control characters; importer blocks variant or image removal without `--allow-removals`, never sends metafields through `productSet`, merges tags. Manifest holds ids, change list and a pre-update product snapshot (no secrets, directory git-ignored).

## Guest lookup shared limiter proposal (T-09)

Unverified until Q-003 (host) is answered. On Oxygen the Cache API is per data centre and non-atomic, so it is only a speed bump. Best realistic options, in order: (1) a managed atomic counter reached by `fetch` (for example a Redis REST service with `INCR` plus expiry), key `hash(ip)` and `hash(email)`, server-only secret, needs client approval of the vendor; (2) an edge rule if a CDN or WAF fronts the site: 10 requests per minute per IP on the track-order route; (3) a bot challenge on the form plus a link to Shopify's own order status page as the fallback. The route must take the client IP from the platform's trusted header (confirm the Oxygen header name) and never from `X-Forwarded-For` supplied by the caller. On an own Node server, one process is fine in memory, several need option 1. Also use a dedicated custom app with `read_orders` only for this endpoint.

## Threat model verification status (this commit)

| ID | Status |
|---|---|
| T-01 | Partial: engine proven by probe; no route wiring (M-2) |
| T-02 | Partial: library proven; detective control pending (M-4) |
| T-03 | Library verified; route absent; L-1 |
| T-04 | Verified for tree, history and client bundle; CI scan missing (L-7) |
| T-05 | Library loggers verified; no route logging reviewed |
| T-06 | Library verified; order-time flags need an alert path |
| T-07 | Open: M-3 |
| T-08 | Open: M-1 |
| T-09 | Library verified; limiter not shared (L-5) |
| T-10, T-11, T-16 | Not in scope of this commit |
| T-12 | Open: H-1, L-7 |
| T-13 | Partial: Extend breaker and caps verified; guest limiter L-5 |
| T-14 | Verified in code and unit tests read, not run live |
| T-15 | Partial: L-8 |

## Could not verify

Runtime response headers (no server run; CSP directives beyond the nonce not inspected, and no HSTS, nosniff, referrer or frame-ancestors setting exists in app code); Oxygen rate-limit and client-IP capabilities; webhook and guest-lookup routes (do not exist); Shopify behaviours marked V-09, V-16, V-20; the vitest suites were not re-run by me; live-store script behaviour; Extend's real responses.
