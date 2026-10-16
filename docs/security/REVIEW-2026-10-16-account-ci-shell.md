# Security review: account hardening, site settings, CI workflow, definitions tool, redaction, lazy shell panels (range 81a29a9..101c710)

Reviewer: security-engineer. Date: 2026-10-16. Branch `feat/p7-shell-weight-phase2-a11y`, tree clean at 101c710 (main 8f8b854). Previous review: [REVIEW-2026-10-15-pickers-headers](REVIEW-2026-10-15-pickers-headers.md).

Scope: `routes/account*.tsx`, `lib/account/results.ts`, `lib/shopify/{site-settings,admin-link,shop-policies,brand-link,brand-path,protection-load}.ts`, `components/layout/{PromoBar,LazyPanel,lazyPanels,HeaderSearch,SuggestionGroups}`, `lib/{navigation,when-idle,analytics,toast}.ts`, `lib/logging/{redact,request-context}.ts`, `server.ts`, `lib/server-safety.ts`, `routes/products.$handle.tsx`, `.github/workflows/ci.yml`, `storefront/playwright.config.ts`, `scripts/shopify/apply-definitions.mjs` and `scripts/lib/{env,shopify-admin,redact}.mjs`, `scripts/perf/lighthouse-command.mjs`, `tests/e2e/helpers/telemetry-refusal.ts`. Threats: T-04, T-05, T-07, T-08, T-10, T-11, T-12, T-13, T-14.

Method: code reading with hostile cases; esbuild-bundled probe scripts (admin links, phone, request ids, redaction with 20 hostile strings and 6 large-input timings; apply-definitions driven through `main()` with a hostile fake Shopify); dev server on port 4700 against mock.shop with a throwaway env file outside the repo (no `.env` read), curl probes of the account actions; fresh `npm run build` and a grep of all 108 `dist/client` assets; the CI history scan re-run locally over 56 commits; `npm audit --omit=dev`; 392 Vitest tests in 12 related files and all 259 script tests (pass). The dev server was stopped and port 4700 verified free. No source changed.

## Gate verdict

**PASS WITH CONDITIONS (proposed).** No High. One new Medium (post-login redirect to the Referer, inherited from Hydrogen and not caught by our wrappers) must be fixed before the customer account is enabled on a store (V-08, Q-018). Everything else is Low or Info. H-1 (ADR-0008) and the ADR-0006 / O-M3 owner acceptance are unchanged. Not a gate pass: the account flow could not be exercised (see Could not verify).

## Findings

### High
None.

### Medium

**S-M1. Open redirect after sign-in: Hydrogen sends the shopper to the `Referer` (T-08, T-11).**
Evidence: `node_modules/@shopify/hydrogen/dist/development/index.js:4027` (production bundle: `redirectPath:lt(o.url)||z(o,"Referer")||y`) stores `redirectPath = getRedirectUrl(request.url) || Referer || default` in the session at login; `index.js:4173-4182` (`authorize`) answers `redirect(redirectPath)` with no same-origin check. `getRedirectUrl` checks only the `return_to`/`redirect` query value (`isLocalPath`), not the Referer. Our wrappers `routes/account_.login.tsx` and `account_.authorize.tsx` only add no-store headers.
Scenario: a page on `https://evil.example` links to `https://<store>/account/login`. The browser sends `Referer: https://evil.example/...` (the attacker chooses the referrer policy). The shopper signs in on Shopify's real page, the callback then 302s to the attacker's page ("verify your payment details"). No session is stolen, but it is a phishing amplifier on a trusted sign-in. Not exercised live (the dev server refuses OAuth without a Hydrogen tunnel); read from the installed Hydrogen 2026.4.7 source.
Fix: in `account_.authorize.tsx`, after `authorize()`, read the response's `Location`; if it does not resolve to the request's own origin, replace it with `/account` (keep the `Set-Cookie`). Alternatively in `account_.login.tsx` refuse a cross-origin `Referer` by redirecting to `/account/login?return_to=/account` first. Add a unit test with `Referer: https://evil.example/`. Due: before the account is enabled on a store.

### Low

**S-L1. Admin link allow-list is bypassed by HTML entities (T-08, T-07).** `lib/shopify/admin-link.ts:34-71`: `isPublicPath` checks dot segments on the raw text, but `safeUrl` returns the entity-decoded text (`:69-71`). Probe: `/pages/&#46;&#46;/account/addresses` and `/pages/a&#x2F;..&#x2F;api/x` are accepted and returned as `/pages/../account/addresses` and `/pages/a/../api/x`, which a browser resolves to `/account/...` or `/api/...`; `/pages/x&#9;y` returns a literal tab. Reach: any `parseAdminLink` caller (promo bar `lib/shopify/site-settings.ts:promoFrom`, homepage tiles). Impact is limited: the writer is store staff, the target is a same-origin GET, an external https link is already allowed, and `%2e%2e`, `..`, `..%2f`, `//host`, `\`, `javascript:` were all refused (probed). Fix: validate the decoded value (run `isPublicPath` on `safe`), or return the original trimmed text instead of the decoded one.

**S-L2. Client-chosen request id wins over the host's (T-05 hygiene).** `lib/logging/request-context.ts:9-12,31-36`: `x-request-id` is read before `cf-ray`, so a caller can pick the id that appears on a log line and collide with or imitate another request. The shape is strict (`^[A-Za-z0-9][A-Za-z0-9_.-]{7,63}$`: no spaces, quotes, newlines, markup; probed with 14 hostile values, all fell back to a random UUID or were refused by `Headers`), so there is no log injection and the 64-character cap holds; the logger also JSON-encodes every field. Fix: prefer `cf-ray` (host set) when present, or log the client value under a separate field. The logged `path` (`:42`) is the raw pathname: harmless at the two current call sites (`/cart`, `/checkout-steps`), but `/discount/<code>` would put a code in a log if the helper is reused there; redact or drop the segment after `/discount/`.

**S-L3. History scan misses some token shapes and excludes one file (T-04).** `.github/workflows/ci.yml:framework job`: five patterns (`shp*_`, `sk-`, private key block, `Bearer`, `AKIA`); Stripe-style `sk_live_`, GitHub `ghp_` and JWTs are not matched (the redaction test fixtures contain them, which is why they are probably left out), and `scripts/validate-framework.mjs` is excluded from every commit. It prints only `commit:path` (`git grep -l`), never the matched text, so the scan cannot leak a secret into the log (verified: the step only echoes the pattern and the path list). Run locally over all 56 commits: 0 hits, no git error. Fix: add `gh[pousr]_` and `sk_(live|test)_` with a path exclusion for `*.test.ts` fixtures; prefer a dedicated scanner (already a recommendation in DEPLOYMENT.md). `git rev-list --all` does not cover unreachable objects (only matters for the transfer scan, REQ-HAND-001).

**S-L4. GitHub Actions are pinned to tags, not commit SHAs (T-12).** `ci.yml`: `actions/checkout@v4.2.2`, `setup-node@v4.4.0`, `upload-artifact@v4.6.2`, all first party. Meets the written rule ("a version or commit") and the file says to move to SHAs when the repository moves to the client's organisation. Keep that as a transfer-day task.

**S-L5. `npx -y @lhci/cli@0.15.1` (T-12).** `scripts/perf/lighthouse-command.mjs:35`, `docs/testing/PERFORMANCE.md:50`. The top-level version is pinned, but about 300 transitive packages resolve to the newest in-range versions at run time with no lockfile, `-y` skips the install prompt, and install scripts run on a developer machine. It is a printed command only; CI does not run it. Fix: until an ADR adopts it as a devDependency, add `--ignore-scripts` (`npm_config_ignore_scripts=true npx ...`) and run it from a scratch directory; note the transitive risk in PERFORMANCE.md.

**S-L6. Product page makes two extra Storefront reads for an unknown handle (T-13).** `routes/products.$handle.tsx` (Promise.all of product, eligibility by handle, offer-only handles, brands) plus `lib/shopify/protection-load.ts`: a request for a well-formed but unknown handle now costs two uncached-first reads instead of one. Each distinct handle is a cache miss and there is no rate limit until Q-003 (K-L8 family). Bounded by the handle shape check and the cache windows; fix with the host rate limit.

**S-L7. apply-definitions trusts the id Shopify returns (T-14, defence in depth).** `scripts/shopify/apply-definitions.mjs:366-373`: the id is checked for shape only; the returned definition's `type` is not compared with the requested one. A hostile or confused Shopify answer naming another definition would make `--live` add spec fields to it (probe: fields were sent to `gid://shopify/MetaobjectDefinition/999` with `type: OTHER`). Still create-only. Fix: require `existing.type === definition.type` before planning `add-fields`.

### Info
- Dev-only: a cross-origin action to `/account/*.data` in `vite dev` returns React Router's 400 with a stack trace; production builds sanitise it (not re-checked in a preview this round).
- `PUBLIC_SUPPORT_PHONE` and `support_phone` can never become a `javascript:` link: `normalizeUsPhone` accepts only digits, spaces, `().+-` (30 characters) and the `tel:` href is rebuilt from the digits (probed: `javascript:`, `;ext=`, newline, Arabic-Indic digits, `tel:` prefix all refused).
- `E2E_ENV_FILE` allows an absolute path (`/etc/...` matches `[\w./-]+`); the comment says relative. Trusted input (developer or CI), no shell syntax, no `..`, no leading `-`. `E2E_RUN_NAME` is `[\w-]` only.
- `site_settings` and the new collection `faqs` metafield are `PUBLIC_READ`: all fields are public by design (haul-away maximum, phone, promo text); keep secrets out of that entry.
- `analytics.ts` `track()` types allow any string parameter; no sink is registered, and `console.debug` is dev-only. PII rules must be enforced when the Phase 7 sink arrives.
- Post-login `login_hint`, `acr_values`, `locale` from the query reach Shopify's authorize URL URL-encoded by Hydrogen: pre-fills an email only.
- `user: name` style keys (`user`) are not redacted in free text; callers pass codes (rule unchanged).

## Verified

**T-11 / T-05 account routes (code, tests, local probes).** Customer is never read from the request: every loader/action uses the signed-in token (`customerAccount.query/mutate`); address ids are shape-checked (`parseAddressId`, 200 characters, no control characters, `gid://shopify/CustomerAddress/` prefix) and Shopify decides ownership; order ids are base64 of an Order gid and a foreign or malformed id gives the same 404 (`decodeOrderRouteId`, `account.orders.$id.tsx`). Live (dev, signed out): cross-origin, `Origin: null` and `Sec-Fetch-Site: cross-site` POSTs to `/account/logout` gave 403 JSON with `no-store`; forged address ids with PUT/DELETE gave 401 (signed out), a non-address gid or a CR/LF id gave 400, an 8 KB+ body gave 400 `invalid-request`, PATCH 405, POST to profile 405; every response `private, no-store`, fixed texts, no echo of input; unknown ids never reach a GraphQL string (variables only). Orders search filter strips everything except `[A-Za-z0-9_-]`. `AccountErrorBoundary` shows fixed text only.

**T-08.** `isSameOriginRequest` unchanged and used by logout, address and profile actions; logout GET only redirects to `/`; promo and admin links refuse `javascript:`, `//host`, backslash, `%2e%2e`, `..%2f`, whitespace (see S-L1 for the entity gap); `discount.$code` redirect still uses `safeRedirectPath`. Gap: S-M1.

**T-05 redaction.** The K-L1 gaps are closed in code: unquoted multi-word values stop at the next pair, `{key, value}` pairs are judged by the key, escaped JSON is handled, new key names (`ip`, `pc`, `recipient`, `dateOfBirth`, `orderNote`, `forwarded-for`...) match. Remaining by design: a bare ZIP in prose (`No delivery to 90210`) and `City, ST 78701`. No regex DoS: 1 MB inputs of seven shapes ran in 0.7 to 6.7 ms. `finishResponse` (`lib/server-safety.ts`): headers first, then the cookie appended; tested for an immutable redirect.

**T-07 / T-10.** No `dangerouslySetInnerHTML`, `innerHTML`, `eval` or storage use in the range's added lines; promo text is `cleanText` plain text capped at 140 code points; Toast renders `{toast.message}` as text; brand link built from `[a-z0-9-]{1,100}` plus `encodeURIComponent` (`brand-path.ts`), vendor text rendered as a text node: no injection or open redirect. Production `Content-Security-Policy-Report-Only` (checked in the dev response) and enforced Hydrogen policy both allow same-origin and `cdn.shopify.com` scripts, so the dynamic chunks load; no third-party origin added. Telemetry filter (`telemetry-refusal.ts`) is hostname-exact (K-L7 closed, 105 tests). Lazy panels: failure boundary shows fixed text with a link to `/cart` or a reload; preload on pointer events only fetches static chunks.

**T-04 bundle and secrets.** Fresh `npm run build`: 0 hits in 108 `dist/client` assets for every non-`PUBLIC_` name in `.env.example` (SESSION_SECRET, DELIVERY_COOKIE_SECRET, OFFER_CONFIG_JSON, SHOPIFY_APP_CLIENT_SECRET, EXTEND_ACCESS_TOKEN, PRIVATE_STOREFRONT_API_TOKEN, SHOPIFY_ADMIN_API_ACCESS_TOKEN...), for `X-Extend-Access`, `readOrderForSync`, `loadCoverageCatalog`, `revalidateCartGate`, `readDeliveryZip`, `requireAccountSession`, `customerAccount.mutate`, `loadSiteSettings`, `createHmac`, and for token shapes (`shpat_`, private key, `sk_live_`, `AKIA`). The four lazy chunks (CartMain, MobileNav, ZipForm, SuggestionGroups) are clean. History: 56 commits, 0 hits. Only `.env.example` is tracked.

**T-12.** `npm audit --omit=dev`: 7 findings (1 low, 4 moderate, 2 high), the same set as ADR-0008 (react-router, lodash, esbuild on Windows); no dependency or lockfile change in the range (only two script entries in `package.json`). CI: trigger is `pull_request` and `push` to main (no `pull_request_target`), `permissions: contents: read`, no secrets, no `github.event.*` expression in any `run` step (only `github.ref` in the concurrency group and `steps.*.outcome` through `env`), heredocs are quoted (`<<'EOF'`) and hold only placeholder values, artefacts upload only reports and traces of the mock store, the history scan prints paths only.

**T-14 apply-definitions.** Dry run is the default and the client is built with `allowMutations: live` (a dry run cannot send a mutation: 0 mutations in the hostile dry run). Store guard: `*.myshopify.com` wildcards, `x.myshopify.com.evil.com`, `evil.com#.myshopify.com`, uppercase, URL form, NUL and dotted names were refused or normalised (8 cases); live needs both `--live` and an allow-listed store; refusals exit 3 with zero requests. Update path sends only `create` operations built from whitelisted keys (`key,name,type,required,description,validations`): unknown keys such as `delete`, `update`, `resetFieldOrder` in a hostile spec are dropped (probed); no `delete`/`update` operation appeared in any of 28 mutations against a hostile store response. Token: read from env only, trimmed, never in output (hostile response echoing the token produced no leak in stdout or stderr); `redirect: 'error'` so the token is never forwarded; host fixed to the validated `<name>.myshopify.com`. Malformed specs exit 2 before any request. Caveat: S-L7.

## Threat model verification (this review)

| ID | Status |
|---|---|
| T-04 | Verified in code (fresh bundle and history clean); S-L3 scan coverage |
| T-05 | Partial to verified for the range: K-L1 closed, requestId and path checked (S-L2); network inspection waits for analytics |
| T-07 | Verified in code; S-L1 |
| T-08 | Verified in code except **S-M1** (open) and S-L1 |
| T-10 | Partial, unchanged (report-only, no third party; lazy chunks compatible with the CSP) |
| T-11 | Partial: code, tests and signed-out probes verified; ownership by Shopify not exercised; **S-M1** |
| T-12 | Open (H-1 / ADR-0008 unchanged); CI workflow reviewed, S-L4, S-L5 |
| T-13 | Partial: S-L6 added |
| T-14 | Verified in code for apply-definitions; not run against a store; S-L7 |

## Could not verify

Sign-in, sign-out, address and profile mutations, order reads and cross-customer refusal on a real store (the dev server refuses OAuth without a Hydrogen tunnel and a customer-account-enabled store: V-08, Q-018); S-M1 live (read from Hydrogen source, not run); production preview headers and a real-browser load of the lazy chunks under the enforced CSP (the existing `lazy-panels.spec` was not re-run; stopped at the turn limit); the CI workflow on GitHub (never run remotely); behaviour behind the real host or CDN (Q-003); whether Shopify answers `metaobjectDefinitionUpdate` as documented (V-20, dev store).
