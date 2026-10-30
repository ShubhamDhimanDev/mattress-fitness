# Release test plan: browser matrix, regression, test orders and the verification debt register

Tasks P8-01 (browser and device matrix), P8-02 (full regression), P8-03 (test-order matrix); requirements REQ-ACPT-002, NFR-009, NFR-012, NFR-013. **Draft 1, dated 2026-10-26, branch `feat/remaining-scope-fast`.** Strategy: [TEST_STRATEGY](TEST_STRATEGY.md); Playwright workflow: [PLAYWRIGHT_WORKFLOW](PLAYWRIGHT_WORKFLOW.md); acceptance rules: [ACCEPTANCE_CRITERIA](../../plans/ACCEPTANCE_CRITERIA.md); results go to [TEST_RESULTS](../../progress/TEST_RESULTS.md).

> **DEFERRED by owner decision 2026-10-26, to be run before acceptance.** Testing and QA are not being run in this work round. Nothing in sections 3 to 5 has been executed for a release candidate. Counts quoted from earlier rounds are **agent-reported or orchestrator-reported**, not re-run by the writer of this document. Nothing here moves a requirement to `PASSING` or a task to `DONE`; that needs a development-store record and an independent review (DEC-025, ACCEPTANCE_CRITERIA "Evidence rules").

Tags: `[assumed]`, `[client input needed]`, `UNVERIFIED`. Environment labels are mandatory on every result: **mock store**, **fixtures**, **fake**, **local Extend mock**, **development store**, **production preview**, **live store** (ACCEPTANCE_CRITERIA).

## 1. Order of work when the deferral ends

1. Clear the preconditions in section 7 that need the owner (Admin token, store password, dev-store content).
2. Run the static gate and the verification pass V (section 6) on the development store.
3. Agree the matrix (section 2) with the client (Q-012), then run the regression (section 3).
4. Run the test-order matrix (section 4).
5. Record evidence (section 5); open UAT ([UAT_PLAN](../../plans/UAT_PLAN.md)).
6. Final accessibility and security re-check on the release candidate (P8-08), then the go or no-go (P8-09, [CUTOVER_AND_DNS](../deployment/CUTOVER_AND_DNS.md) section 5).

## 2. Browser and device matrix (proposal for Q-012 / NFR-009)

The approved matrix is recorded in `docs/testing/BROWSER_MATRIX.md` (P8-01 output, not written yet). Below is the proposal to take to the client. NFR-009 stays `Pending approval` until the client approves it.

| # | Browser and device | Viewport | How tested | Playwright project | Ever run? |
|---|---|---|---|---|---|
| M-1 | Chrome (Chromium) desktop, Windows | 1280 x 800 | Automated | `desktop-chromium` | Yes, many rounds, mock stores and the owner's dev store (agent-reported) |
| M-2 | Chrome on Android phone (Pixel 7 emulation) | 412 x 915 | Automated | `mobile-chromium` | Yes (agent-reported) |
| M-3 | Safari desktop (WebKit engine) | default `Desktop Safari` | Automated | `desktop-webkit` (needs `E2E_ALL_BROWSERS=1`) | **Never** (B-22, B-24) |
| M-4 | Safari on iPhone (WebKit, iPhone 14 emulation) | default `iPhone 14` | Automated | `mobile-webkit` | **Never** |
| M-5 | Firefox desktop | default `Desktop Firefox` | Automated | `desktop-firefox` | **Never** |
| M-6 | Edge desktop | 1280 x 800 | Manual smoke (it shares Chromium's engine) `[assumed]` | none | Never |
| M-7 | One real iPhone (iOS Safari, current and previous major iOS) | device | Manual pass with the scripts in [UAT_PLAN](../../plans/UAT_PLAN.md) section 4 and the checklist M-01..M-12 | none | Never |
| M-8 | One real Android phone (Chrome) | device | Manual pass | none | Never |
| M-9 | Tablet (iPad or Android) portrait and landscape | 768 wide | Manual smoke | none | Never |
| M-10 | Screen readers: NVDA (Windows), VoiceOver (macOS and iOS), TalkBack (Android) | n/a | Manual: [ACCESSIBILITY_AUDIT](ACCESSIBILITY_AUDIT.md) checklist M-01..M-12 | none | Never (B-23) |
| M-11 | Forced colours (Windows High Contrast) and 400 percent zoom on real hardware | n/a | Manual; the automated smoke uses emulation | none | Emulation only |

Design widths for layout checks: 360, 768, 1280 and 1536 px (`visual.spec.ts` layout invariants). Older browsers (for example a browser two or more majors behind) are **not** in the proposal `[assumed]`. Which browsers the client's shoppers use is `[client input needed]` (no analytics exist yet); the matrix should be revisited with real figures after launch.

Apple Pay needs Safari on an Apple device and Google Pay needs Chrome with a saved card: the wallet rows of the test-order matrix (section 4) therefore need M-7, M-8 or a desktop Safari, not an emulated browser. Whether the express buttons appear in the current Shopify checkout with Local delivery is itself unverified (V-06b).

## 3. Regression run

### 3.1 Prerequisites

- Git Bash with Node 22 (`node --version` prints `v22...`; the system Node 25 in PowerShell is outside the Hydrogen CLI range, B-01). From `storefront/`: `npm ci`. Browsers: `npx playwright install chromium`, and for the cross-browser projects `npx playwright install webkit firefox`.
- Git-ignored environment files in `storefront/` (never printed, never committed). Names and contents are in [DEV_DATA](../../storefront/DEV_DATA.md): `.env.bedding`, `.env.delivery`, `.env.protection`, `.env.prodpreview`, `.env.demo` (written by `node scripts/setup/demo-env.mjs`). The specs for consent, chat, signup, track-order and add-ons read further git-ignored files named in each spec's header (`.env.analyticsqa`, `.env.trackqa`, `.env.beddingqa`, an env file with `PUBLIC_CHAT_PROVIDER=fake`, one with a fake `KLAVIYO_PRIVATE_API_KEY`); **these are not documented in one place, and a fresh checkout has none of them**. Writing them is a QA task before the first run (placeholders only).
- The local Extend mock for protection specs: `node scripts/mocks/extend-mock.mjs --port 4010`.
- Browser rule while agents run: at most two Playwright tabs and one agent with a browser at a time; `--workers=1` (DEC-073).

### 3.2 Static gate (no browser)

Run from `storefront/` unless stated; record each output.

| Command | What it proves | Last reported result (not re-run by the writer) |
|---|---|---|
| `npm run check` | `format:check`, `lint`, `typecheck`, `test` (Vitest), `build`, `perf:bundle` in one go | Vitest 6322 tests in 247 files; `perf:bundle` passing on every route (orchestrator-reported 2026-10-26) |
| `npm run test` | Vitest only | as above |
| `node --test "scripts/**/*.test.mjs"` (repository root; the quoted pattern is needed on Node 22) | Importer, validator, node-server adapter, detective, setup scripts | 339 passing (orchestrator-reported 2026-10-26) |
| `node scripts/validate-framework.mjs` and `node scripts/validate-framework.mjs --ids-by-phase` (repository root) | Records, requirement IDs, secret patterns in the current tree | **Not run on the records since 2026-10-22** as far as the project manager knows; run it |
| `npm audit --omit=dev` | Dependency advisories | 7 findings (1 low, 4 moderate, 2 high) on 2026-10-25; the high react-router items are the launch blocker B-12 |
| `node --test "scripts/node-server/*.test.mjs"` | Node server adapter | 53 passing (VPS_RUNBOOK, 2026-10-25) |
| History secret scan (the `git grep` shapes of the CI job, or a dedicated scanner run once before transfer) | REQ-HAND-001 | The CI scan only ever ran locally on a throwaway repository |

### 3.3 End-to-end specs (Playwright, `storefront/tests/e2e/`)

List of the 35 spec files by name (counted from the folder on 2026-10-26), with what each describes (taken from its `describe` titles; none has been run for a release candidate). Helpers (`helpers/*.ts`) are not specs. **`zz-debug.spec.ts` is a scratch measurement spec** (layout-shift probing, writes to a hard-coded local scratchpad path); QA should delete it or exclude it from the release run, and the writer of this plan did not change it.

| Spec | Covers | Needs beyond the default mock-store server |
|---|---|---|
| `smoke.spec.ts` | Home page loads | none |
| `shell.spec.ts` | Landmarks, skip link, header, ZIP entry, desktop and mobile navigation, footer, link contract, no horizontal scroll, accessibility (REQ-NAV-001 to 003, REQ-CNT-001, NFR-001, NFR-003) | ZIP tests need `DELIVERY_COOKIE_SECRET` and a zone (`.env.delivery`) |
| `home.spec.ts` | Home sections (REQ-HOME-001) | none |
| `nav-menu.spec.ts` | Shopify menu navigation, desktop and mobile (REQ-NAV-002) | a menu handle; flat mock menu only |
| `catalog.spec.ts` | Collection page and product page (REQ-COL-001/002, REQ-PDP-001/002) | none |
| `brands.spec.ts` | Brand index and brand page (REQ-COL-005) | none |
| `gallery.spec.ts` | Component gallery: accordion, dialog, drawers, toasts, selectors, brand states | none |
| `search.spec.ts` | Search results and predictive search (REQ-SRCH-001/002) | none |
| `compare.spec.ts` | Compare: empty state, select and remove, persistence, size and similar, mobile (REQ-CMP-001) | none |
| `quiz.spec.ts` | Quiz intro, full run, keyboard, remembered on device, layout (REQ-QZ-001/002/005) | none |
| `stores.spec.ts` | Removed 2026-10-28 with the store locator (DEC-141, REQ-LOC-001/003 `Descoped`) | n/a |
| `cart.spec.ts` | Cart drawer and page, hostile input, server hand-off (REQ-CART-001, REQ-PRE-006, REQ-CHK-001) | none |
| `pickers.spec.ts` | Gift, add-on and bundle pickers (REQ-CART-002/003, REQ-ADD-002) | Success paths skip on mock stores (V-03, V-06, V-17) |
| `product-addons.spec.ts` | Product page add-on slot (REQ-ADD-001) | `E2E_ADDONS_RULES=on` and a server with real foundation rules for the success path |
| `delivery.spec.ts` | Delivery promise, no-JS ZIP entry, cart page haul-away messages (REQ-DEL-002, REQ-NAV-003) | `.env.delivery` with `OFFER_CONFIG_JSON` zone, port 3700 |
| `delivery-unavailable.spec.ts` | Unusable delivery secret in production fails closed (REQ-DEL-001, P3B-11) | a server with a short `DELIVERY_COOKIE_SECRET` |
| `protection.spec.ts` | Extend protection panel, flag on and off (NFR-013) | `.env.protection`, `E2E_PROTECTION_FLAG=on`, mock on port 4010 |
| `resilience.spec.ts` | Extend failures never block shopping or checkout (NFR-013, P5A-11) | as protection |
| `b20-production.spec.ts` | Cart refusals are visible on a production build (REQ-CART-001, B-20) | `npm run build` first; `E2E_PROD_PREVIEW=1`, `.env.prodpreview`, port 4400 |
| `lazy-panels.spec.ts` | Lazy shell panels; brand link on product page | dev server |
| `lazy-panels-production.spec.ts` | Lazy panels and first-open timing on a production build | `E2E_PROD_PREVIEW=1` |
| `seo-headers.spec.ts` | Response headers, robots, sitemap | `PUBLIC_SITE_URL` for some checks |
| `design-rules.spec.ts` | Touch targets, reduced motion, text spacing | none |
| `visual.spec.ts` | Layout invariants at four widths; pixel snapshots only with `E2E_VISUAL=1` | **No baselines exist** (B-24) |
| `a11y-audit.spec.ts` | axe over 33 routes and states at 360 and 1280 px; keyboard; reflow at 320 x 256; text spacing; reduced motion; forced-colours smoke (NFR-003) | some routes need the dev store (checkout-steps with items, policies, pages, articles, account) |
| `content-a11y.spec.ts` | axe on content templates (REQ-CNT-001/002) | a store that serves content |
| `content-pages.spec.ts` | Footer links, header links, a content page, not-found and redirects, policy page, blog (REQ-CNT-001/002) | a store with pages with text, a terms policy and a `journal` blog (B-26); skips on both mock stores |
| `brand-verification.spec.ts` | Restyle verification: axe, keyboard journey, reflow, layout fixes (BA-10) | `.env.demo`; desktop and phone |
| `real-store.spec.ts` | Read paths, headers, cart on real Shopify carts, read-only checkout hand-off, a11y with real data | `E2E_REAL_STORE=1`, `E2E_ENV_FILE=.env.demo`; the cart-equals-checkout tests skip while the store password is on (B-25) |
| `consent.spec.ts` | Consent banner, GA4 and Meta gating, layout (REQ-ANL-001/002, NFR-011) | `E2E_ANALYTICS=on`, `E2E_ENV_FILE=.env.analyticsqa`; with `E2E_PROD_PREVIEW=1` for the enforced CSP. Provider hosts are stubbed |
| `consent-remount.spec.ts` | One consent layer across remounts; pending-navigation pause (A-M1); safe-page guard; Referrer-Policy; cookie removal | as consent |
| `track-order.spec.ts` | Guest order tracking page fails closed; configured with invented values (REQ-ACC-003) | `E2E_TRACK_LOOKUP=on`, `E2E_ENV_FILE=.env.trackqa` (fake token, `<shop>.myshopify.com`) |
| `signup.spec.ts` | Email signup not configured, and configured with a fake key (REQ-ANL-003) | `E2E_SIGNUP=on` with an env file holding a fake key, a list id and `TRUSTED_CLIENT_IP_HEADER=x-real-ip` |
| `chat.spec.ts` | No provider; fake provider call-out; failure isolation; consent wait (REQ-ANL-004) | `E2E_CHAT=on` or `consent` with `PUBLIC_CHAT_PROVIDER=fake` (dev server only). **No result recorded** |
| `zz-debug.spec.ts` | Scratch; see above | n/a |

### 3.4 Run commands

Mirror of the CI plan ([DEPLOYMENT](../deployment/DEPLOYMENT.md) "Pipeline") for a local, hand-run release (no CI by owner decision, DEC-080). Run from `storefront/` in Git Bash. Give each run its own `E2E_RUN_NAME` so a later run does not erase the earlier report. Add `--trace on` and keep `test-results/<name>` for failures. Replace the env file names with the local ones.

```
# Run 1: the whole suite on the mock store (desktop and phone Chromium)
E2E_RUN_NAME=run1-mock-store E2E_ENV_FILE=.env.bedding E2E_PORT=3400 npx playwright test --workers=1 --trace on

# Run 2: delivery zone specs
E2E_RUN_NAME=run2-delivery E2E_ENV_FILE=.env.delivery E2E_PORT=3700 npx playwright test tests/e2e/delivery.spec.ts tests/e2e/shell.spec.ts --workers=1

# Run 3: protection and resilience against the local Extend mock (start the mock first)
node ../scripts/mocks/extend-mock.mjs --port 4010
E2E_RUN_NAME=run3-protection E2E_ENV_FILE=.env.protection E2E_PORT=3900 E2E_PROTECTION_FLAG=on npx playwright test tests/e2e/protection.spec.ts tests/e2e/resilience.spec.ts --workers=1

# Run 4: production-build specs (build first)
npm run build
E2E_RUN_NAME=run4-production-preview E2E_PROD_PREVIEW=1 E2E_ENV_FILE=.env.prodpreview E2E_PORT=4400 npx playwright test tests/e2e/b20-production.spec.ts tests/e2e/lazy-panels-production.spec.ts --workers=1

# Run 5: development store, read and cart paths (needs the owner's token-free Storefront token in .env.demo)
E2E_RUN_NAME=run5-real-store E2E_REAL_STORE=1 E2E_ENV_FILE=.env.demo E2E_PORT=6100 npx playwright test tests/e2e/real-store.spec.ts tests/e2e/brand-verification.spec.ts tests/e2e/content-pages.spec.ts tests/e2e/content-a11y.spec.ts --workers=1

# Run 6: consent and analytics (placeholder ids), dev server, then enforced CSP on a production preview
E2E_RUN_NAME=run6-consent E2E_ANALYTICS=on E2E_ENV_FILE=.env.analyticsqa E2E_PORT=5200 npx playwright test tests/e2e/consent.spec.ts tests/e2e/consent-remount.spec.ts --workers=1
E2E_RUN_NAME=run6b-consent-preview E2E_PROD_PREVIEW=1 E2E_ANALYTICS=on E2E_ENV_FILE=.env.analyticsqa E2E_PORT=5300 npx playwright test tests/e2e/consent.spec.ts tests/e2e/consent-remount.spec.ts --workers=1

# Run 7: tracking, signup, chat (each with its own env file and switch)
E2E_RUN_NAME=run7a-track E2E_TRACK_LOOKUP=on E2E_ENV_FILE=.env.trackqa E2E_PORT=5400 npx playwright test tests/e2e/track-order.spec.ts --workers=1
E2E_RUN_NAME=run7b-signup E2E_SIGNUP=on E2E_ENV_FILE=<signup env file> E2E_PORT=5500 npx playwright test tests/e2e/signup.spec.ts --workers=1
E2E_RUN_NAME=run7c-chat E2E_CHAT=on E2E_ENV_FILE=<chat env file> E2E_PORT=5600 npx playwright test tests/e2e/chat.spec.ts --workers=1

# Run 8: cross-browser (never run; expect first-run failures)
E2E_RUN_NAME=run8-crossbrowser E2E_ALL_BROWSERS=1 E2E_ENV_FILE=.env.bedding E2E_PORT=3400 npx playwright test --project=desktop-webkit --project=mobile-webkit --project=desktop-firefox --workers=1

# Optional: pixel snapshots (baselines do not exist; see B-24 and Q-023)
E2E_VISUAL=1 npx playwright test tests/e2e/visual.spec.ts
```

The port numbers are free-port choices for this plan, not recorded ones `[assumed]`. The `--project` flag selects a matrix row; add `--project=desktop-chromium --project=mobile-chromium` explicitly if you want to be sure. A skipped test is reported as skipped with its reason; skips are listed in the evidence (section 5), never counted as passes. Known skips by design: pickers success paths, haul-away and delivery-choice steps (`nodes(ids)` not answered by mock stores), anything needing the development store or the Extend demo host.

### 3.5 What a pass means

- A Chromium pass on a mock store supports `IN_REVIEW`, not `DONE` (DEC-025).
- Each failure is logged with the spec, project, trace and screenshot, graded with the SOW grades, and either fixed or deferred; **no test is weakened or deleted to pass** (testing rules). A flaky test is fixed or quarantined with an owner and a date.
- Cross-browser failures on the first run of WebKit and Firefox are expected `[assumed]` (no spec is tagged Chromium-only).

## 4. Test-order matrix (REQ-ACPT-002, P8-03)

Rule from the SOW: a test order for every delivery method, add-on and payment type, then cancel and refund it. Run on a **development or sandbox store only**; a live-store test order needs the separate authorisation in [CUTOVER_AND_DNS](../deployment/CUTOVER_AND_DNS.md) section 11. Payment uses the provider's documented test mode and test credentials only; never a real card. Stop at the order; do not fulfil.

### 4.1 Dimensions

| Dimension | Values | Condition |
|---|---|---|
| Delivery method (SOW section 7) | D1 white-glove in-home (ZIP inside the zone); D2 store pickup (item available at the chosen store); D3 parcel shipping (boxed mattress, bedding, pillow) | One delivery zone (ADR-0007). D1 and D2 need Local delivery and pickup set up on the store (V-06, V-07) |
| Add-on type | A1 none (control); A2 haul-away; A3 comfort-guarantee protector; A4 matching add-on (foundation, protector, pillow or bedding); A5 gift with purchase; A6 bundle; A7 Extend protection | A2 only with D1 (eligibility; other combinations must be **refused with an explanation**, rows 9 and 16). A5 needs the gift discount verified (V-03, B-21). A7 only if Extend is approved and the demo host is connected, else record "not live" (REQ-EXT-004 is `Blocked`) |
| Payment type (SOW section 7) | P1 credit or debit card; P2 Shop Pay; P3 Apple Pay; P4 Google Pay; P5 PayPal; P6 Affirm | Each subject to activation on the client's own account (CLR-007). A type that is not activated is recorded "not activated, not tested", never skipped silently. Affirm has an order-value range (V-25) |

### 4.2 Pairwise plan (documented reduction)

All 126 combinations (3 x 7 x 6) are not run `[assumed reduction, approval by the owner and client]`. The plan below guarantees: every value of every dimension appears; **every delivery x add-on pair** (21) is covered; **every delivery x payment pair** (18) is covered; each add-on meets three different payment types. A full add-on x payment pairwise cover would need at least 42 orders; add rows if the client requires it. Payment type per row is assigned by rotation: payment index = ((add-on number - 1) + shift) modulo 6, plus 1, with shift 0 for D1, 1 for D2, 3 for D3 (add-on A7 therefore repeats the first payment of its delivery).

Fill one row per order. "Expected" is the intended behaviour, not an observed result.

| # | Delivery | Add-on | Payment | Cart lines (synthetic product names) | Expected | Env (dev store / sandbox) | Order ID | Date and tester | Extend record | Result | Cancelled and refunded (confirmation) | Evidence link |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | D1 white-glove | A1 none | P1 card | | Order placed; white-glove shown in zone; totals equal the cart | | | | n/a | | | |
| 2 | D1 | A2 haul-away | P2 Shop Pay | | Haul-away line present only with a saved in-zone ZIP; within the maximum; detective check silent | | | | n/a | | | |
| 3 | D1 | A3 protector | P3 Apple Pay | | Protector line priced by Shopify | | | | n/a | | | |
| 4 | D1 | A4 matching add-on | P4 Google Pay | | Size-matched add-on line | | | | n/a | | | |
| 5 | D1 | A5 gift | P5 PayPal | | Gift line free via automatic discount (V-03); not free if the gate fails | | | | n/a | | | |
| 6 | D1 | A6 bundle | P6 Affirm | | Bundle saving from the titled automatic discount | | | | n/a | | | |
| 7 | D1 | A7 Extend | P1 card | | Protection nested under its item; or "not live" | | | | `[to fill]` | | | |
| 8 | D2 pickup | A1 none | P2 Shop Pay | | Pickup offered; "ready for pickup" email | | | | n/a | | | |
| 9 | D2 | A2 haul-away | P3 Apple Pay | | **Refused before checkout with an explanation** (see 4.1); no order | | | | n/a | | | |
| 10 | D2 | A3 protector | P4 Google Pay | | | | | | n/a | | | |
| 11 | D2 | A4 matching add-on | P5 PayPal | | | | | | n/a | | | |
| 12 | D2 | A5 gift | P6 Affirm | | | | | | n/a | | | |
| 13 | D2 | A6 bundle | P1 card | | | | | | n/a | | | |
| 14 | D2 | A7 Extend | P2 Shop Pay | | Protection line or "not live" | | | | `[to fill]` | | | |
| 15 | D3 parcel | A1 none | P4 Google Pay | | Parcel rate; boxed or bedding item only | | | | n/a | | | |
| 16 | D3 | A2 haul-away | P5 PayPal | | **Refused** (see 4.1); no order | | | | n/a | | | |
| 17 | D3 | A3 protector | P6 Affirm | | | | | | n/a | | | |
| 18 | D3 | A4 matching add-on | P1 card | | | | | | n/a | | | |
| 19 | D3 | A5 gift | P2 Shop Pay | | | | | | n/a | | | |
| 20 | D3 | A6 bundle | P3 Apple Pay | | | | | | n/a | | | |
| 21 | D3 | A7 Extend | P4 Google Pay | | Protection line or "not live" | | | | `[to fill]` | | | |

Rows 9 and 16 are expected-refusal tests: record the message shown, and that no order and no haul-away line reached checkout. They count toward the delivery x add-on cover. Rows 7, 14 and 21 are valid only when Extend is live in the sandbox; otherwise mark "not live (REQ-EXT-004 Blocked)" and do not count them as passed.

### 4.3 Extra rows (not in the pairwise cover)

| # | Scenario | Expected |
|---|---|---|
| X-1 | D1 haul-away with no saved ZIP | Checkout paused with an explanation; no order |
| X-2 | D1 haul-away above the maximum pieces | Over-limit refused on our pages; if an over-limit order is made through Shopify's API directly, the detective check logs it after the order (ADR-0006) |
| X-3 | Out-of-zone ZIP with white-glove-only item | White-glove not offered |
| X-4 | Cart built directly via the Storefront API with a gift not at $0 | Detected after the order (detective), not prevented |
| X-5 | Discount code at checkout combined with an automatic discount | Combination behaves as configured (V-03) |
| X-6 | Free-delivery threshold exactly at the value and one cent below | Fee applies below, free at or above |
| X-7 | Express wallet from the cart page, with Local delivery | Works or is declined with a clear reason (V-06b) |
| X-8 | Refund of a partial order; cancellation of an unpaid order | Emails and totals correct |

### 4.4 Per-order checks and evidence

For every order: the order ID; delivery method; lines (names, quantities, prices); payment type and the test mode used; discount allocations; the customer emails received (confirmation, pickup-ready or shipping, refund) and that they carry the client's brand; the cart total equals the checkout total (B-25 blocks this while the store password is on); in the server journal the webhook handling logged without error and `detective.checked` (if the read token and subscription exist); the Extend record where relevant; the cancellation and the **refund confirmation**. No card numbers, real names, addresses or e-mails in any screenshot; use synthetic data and redact.

## 5. Evidence recording rules

1. Every run is recorded in `progress/TEST_RESULTS.md` with: date, tester, commit or tag, **environment label** (section top), command, counts (passed, failed, skipped, flaky), and links to the trace, screenshot or HTML report folder (`playwright-report/<name>`). A count the orchestrator did not re-run is marked "agent-reported".
2. A failing or skipped test is reported as failing or skipped, with its reason. Waivers need the project owner's written approval (and the client's where scope is affected).
3. Defects use the SOW grades (Blocker, Major, Minor) and go in the shared issue list; a Blocker is never closed by a re-run alone, only by a fix with a regression test.
4. Manual passes (devices, screen readers, wallets) record the device model, OS and browser version, the person, the script and each step's result.
5. No secret, token, real order detail or customer data in any evidence; redact screenshots; keep traces out of the repository (git-ignored output folders).
6. Test orders: the table in 4.2 is the evidence index; each row links to its evidence and to the refund confirmation. Orders are cancelled and refunded the same day they are made.
7. A requirement moves to `PASSING` only with a development-store record and an independent review; evidence from mock stores, fakes or the Extend mock supports `IN_REVIEW` only.
8. The same commands, run by a second person from a clean checkout, are the reproducibility check.

## 6. Verification debt register

Everything built so far is unverified against the platform it depends on (STATUS: 0 requirements `PASSING`, no gate passed). This register lists what still needs a store, a token, an account, a host or a person. IDs V-01 to V-28 are from [TECH_FEASIBILITY](../research/TECH_FEASIBILITY.md) section 4; `VD-nn` are debts that have no V number. "Pass V" means the verification pass the owner scheduled after the Admin token (DEC-076).

### 6.1 Platform facts (V-xx)

| ID | What is unverified | Needs | Blocks |
|---|---|---|---|
| V-01 | Plan resolved (Basic, owner, 2026-10-12). Open part: staff or collaborator access to the client's store (see V-21) | Client's store access | everything |
| V-02 | Nested lines (`parent`) on a Basic-equivalent store: child quantity, update of parent, webhook and Admin representation | Dev store; Admin token (B-27) | REQ-EXT-002, REQ-ADD-002, protection success path |
| V-03 | Automatic discounts (gift at $0, bundle saving, title exposed on the cart allocation) apply in Storefront carts as at checkout; the 25-discount cap; combination with codes | Dev store; discounts created (OFFER_SETUP_DEVSTORE); no token needed to read, token to automate | REQ-PROMO-001/002, gift picker (B-21), P4-12 |
| V-04 | Collection and search filters on metafields (comfort, type, benefits, positions, line), counts, Search and Discovery configuration. On the owner's store only price filtering was seen | Dev store with products and S&D filters (B-26) | REQ-COL-002, REQ-SRCH-002 |
| V-05 | Metaobjects (FAQs, homepage sections, quiz, offer rules, site settings; the `store` definition was removed 2026-10-28, eleven definitions remain) readable via the Storefront API; definitions applied; the `offer-only` tag search; sitemap behaviour | Dev store; `apply-definitions` (token) | REQ-HOME-001, REQ-QZ-004, P3A-02 |
| V-06 | White-glove delivery by ZIP in checkout: Local delivery and postal codes; V-06a plan support; V-06b express wallets with Local delivery; V-06c Admin API read of postal codes; V-06d delivery options by ZIP before checkout; V-06e ZIP-conditioned rates | Dev store or paid Basic trial (V-26); Local delivery configured | REQ-DEL-001, REQ-CHK-003, REQ-CHK-005, B-17 |
| V-07 | **Withdrawn 2026-10-28 (DEC-141): no per-store pickup availability any more.** Was: `storeAvailability` per location and the store-to-location mapping (pickup) | n/a | REQ-PDP-003 (`Descoped`) |
| V-08 | Customer Account API for a headless storefront: callback URLs, new customer accounts, sign-in, orders, addresses | Dev store with new customer accounts | REQ-ACC-001/002, P6-07, P6-04 |
| V-09 | Guest order lookup: Admin `read_orders`, `name:` search, 60-day window without `read_all_orders`, latency against the 800 ms floor, cost per lookup | Dev store with a test order; `read_orders` token | REQ-ACC-003, P6-08, SD-05 |
| V-10 | Checkout customisations on Basic: largely answered by docs; open: behaviour of a chosen app on a headless checkout (V-19) | Docs; dev store with an app | REQ-CHK-002, REQ-POST-001/002 |
| V-11 | Extend: sandbox and production hosts, credentials, category taxonomy for mattresses, price-tier modelling, headless approval, Shopify-app double sync | The client's Extend account; Extend's written answers (Q-005, B-03) | REQ-EXT-001 to 005 |
| V-12 | Webhook subscription: which credential creates it, HMAC with the app client secret, retry behaviour, where the secret is displayed | Dev store; app | REQ-EXT-003, order sync, detective check |
| V-13 | Hydrogen features on a plain Node host (caching, analytics, session, image handling). Partly shown locally on Windows (ADR-0011, 42 to 53 adapter tests, built storefront served); not on Linux; not on Hydrogen 2026.10 | A Linux VPS; the 2026.10 migration (P1-12) | REQ-HOST-003 |
| V-14 | TypeScript pin: resolved (5.9) | none | none |
| V-15 | Admin and Storefront API rate and cost limits for server proxies (guest lookup, Extend sync) | Docs; dev store load | Phases 5A, 6 |
| V-16 | Nested-line behaviour end to end: child quantity updates, removal, `instructions`, order and webhook representation, Extend line properties; also `cartLinesUpdate` with a new `merchandiseId` and a stock cap (partly seen on the owner's store) | Dev store | REQ-EXT-002 |
| V-17 | Shopify Flow on Basic: Order created trigger, quantity condition, add-tag, internal email, limits | Dev store (not plan-gated, see V-26) | REQ-PROMO-003, REQ-PRE-003 (the detective check replaced the Flow idea; confirm if Flow is still wanted) |
| V-18 | App Store quantity-limit apps with Storefront API carts | Dev store with each app | optional layer in REQ-PROMO-003 |
| V-19 | Post-purchase and thank-you apps with a headless checkout; Shopify access approval | Dev store with an app; Shopify | REQ-POST-001/002 (client decision Q-007; parked, DEC-139: do not run) |
| V-20 | Dev Dashboard app with custom distribution: Admin API token on the client's store, webhook subscriptions, scopes (`read_orders`, products, metaobjects), `read_all_orders` | Owner/client creates the app; authorization-code grant | REQ-CAT-002, REQ-ACC-003, REQ-EXT-003 |
| V-21 | Collaborator access for our team versus Basic staff seats | Shopify help; client | CLR-002 |
| V-22 | Klaviyo: subscribe endpoint, SMS consent fields, acceptance of the body, the 202, list membership, consent record, double opt-in mail, what an unsubscribed profile becomes, a key with exactly three scopes (SU-M1 gate) | Client's Klaviyo account, a double opt-in list, a sandbox or test account | REQ-ANL-003, P7-02 |
| V-23 | Judge.me: Hydrogen package status, API access on the free plan, pricing | Client's choice (Q-011); account | REQ-PDP-005, P3B-12 |
| V-24 | Chat: Shopify Inbox setup on Hydrogen (steps, CSP, consent) is **not verifiable** for our stack on 2026-10-25; any real provider: hosts, CSP, `open()`, cookies, unload | A client-chosen provider with sandbox access (CLR-005, Q-011, B-34) | REQ-ANL-004, P7-03 |
| V-25 | Shop Pay Installments / Affirm messaging components on headless; correct order range | Client's Affirm activation (CLR-007); docs | REQ-CART-005 |
| V-26 | Dev stores are not plan-gated: plan-dependent claims (Flow, nested lines, Local delivery with wallets, app installs) need documentation plus a read-only check on the client's store or a paid Basic trial | Client's store; trial store | V-16 to V-19, REQ-PROMO-003 |
| V-27 | Seven built-in assumptions only a store can settle: (a) gift at 0 by a line-level automatic discount and the allocation title; (b) `PARENT_LINE_INVALID_REFERENCE` for a variant parent (source unrecorded); (c) `products(query: "tag:extend-coverage")` and sitemap hiding; (d) Extend price does not depend on quantity (quote at quantity 1, DEC-040); (e) `delivery_choice` and decline attributes reach the order, pickup order has no shipping address, Local delivery shipping line as assumed by the detective; (f) `cartAttributesUpdate` replace versus merge; (g) `Cart.updatedAt` resolution for the picker's re-read | Dev store; Extend | V-03, V-05, V-11, V-16, V-20 |
| V-28 | Not built so not assumed: guest lookup route against a store, Customer Account flows against a store, metaobject reads for `quiz_*`, `offer_rule`, `delivery_zone`, `site_settings` (`storeAvailability` and `store` reads were removed 2026-10-28, DEC-141) | Dev store | REQ-ACC-001 to 003, REQ-QZ-004 |

### 6.2 Other debts (no V number)

| ID | What is unverified | Needs | Blocks |
|---|---|---|---|
| VD-01 | Cart total equals checkout total (REQ-CHK-001); the real checkout hand-off and every test order. Blocked by the Online Store password (B-25, DEC-075) | Owner removes the password; dev store | REQ-CHK-001, REQ-ACPT-002, G3 to G5 |
| VD-02 | The catalog importer and `apply-definitions` have never touched a real store (dry run or live); client-side clean run (REQ-HAND-002) | Admin token (B-27), allow-list, demo catalog (DEC-077), client's sheet (CLR-014) | P3A-05, REQ-CAT-*, REQ-HAND-002 |
| VD-03 | Content pages and the blog: no store holds a page with text, a terms policy or an article; template, contents list, FAQ structured data, canonical, print, blog listing never rendered with content | Owner makes test objects by hand (B-26), then client text (CLR-016) | REQ-CNT-001/002, P6-09, P6-11 |
| VD-04 | **Withdrawn 2026-10-28 (DEC-141): no store locator, so no debt.** Was: store locator data path | n/a | REQ-LOC-002 (`Descoped`) |
| VD-05 | Quiz scoring rules as metaobjects; quiz saved to the account on sign-in | Dev store; V-08 | REQ-QZ-004/005, P6-13, P6-04 |
| VD-06 | The detective order check on a real order; webhook delivery and HMAC with a real signature; Extend sync/reconcile with real data | Dev store, token, subscription (V-12, V-20), Extend demo host | REQ-PRE-005/006, REQ-EXT-003, B-17, B-18 |
| VD-07 | `nginx -t`, the nginx template (zones `mf_*`, the `.map` guard, probe paths, IPv6 /64 key), systemd unit (`systemd-analyze verify`, sandbox options, `MemoryMax`), certbot issue and renewal, firewall, SSH hardening: none ever run | A throwaway VPS; the owner (B-31 item 3) | REQ-HOST-003, B-19 |
| VD-08 | Address-header chain behind real nginx and the Node adapter: forged `X-Real-IP`, `CF-Connecting-IP`, `True-Client-IP`, `Oxygen-Buyer-IP`; 429 behaviour of every zone | VPS; VPS_RUNBOOK section 8 checklist items 2 to 4 | T-09, R-27 |
| VD-09 | Security headers on every response behind the real proxy (redirects, 404, 500, static); duplicate-header check; CSP promotion from report-only; HSTS ramp; two-cookie shared-cache test | Real host | P7-07, NFR-004, B-19 |
| VD-10 | Rollback and cutover rehearsal, restart gap, log retention, alerts and uptime monitoring (nothing wired) | VPS or staging; owner | REQ-HOST-003/004, P9-04 |
| VD-11 | Dependency risk: react-router below 7.18 advisories (B-12); decision (a) migrate to Hydrogen 2026.10 or (b) force 7.18.4; ADR-0008 still Proposed; re-run the audit and every Node-host proof afterwards | Owner decision; P1-12 | NFR-004; any public URL |
| VD-12 | WebKit and Firefox (never run); recovery of a failed lazy panel there; pixel baselines (none); NFR-012 "CI green on main" unmet as worded (DEC-080, Q-023) | Local run of `E2E_ALL_BROWSERS=1`; an agreed baseline machine, or a recorded waiver | NFR-009, NFR-012, P2-06 |
| VD-13 | Manual accessibility: screen readers (NVDA, VoiceOver, TalkBack), forced colours and zoom on hardware, device pass, final brand-colour contrast, routes the mock store cannot serve | A person with devices (B-23); brand kit (CLR-013) | NFR-003, P7-05 |
| VD-14 | Performance on real data: Lighthouse after the restyle and with real images; LCP; budgets are proposals (Q-012); Lighthouse CI as a dependency needs an ADR | Dev store content; owner decision | NFR-002, P7-06 |
| VD-15 | GA4 DebugView events and parameters, Meta Test Events, **A-M1** (provider history-change page view on a private page; must be checked with the real tags), the real Google and Meta host lists, the GA4 history-change setting off | Client GA4 and Meta access (CLR-004) | REQ-ANL-001/002, NFR-011, B-32 |
| VD-16 | Legal sufficiency of consent wording, mode (`opt-in` or `opt-out`), 180-day lifetime, Global Privacy Control, SMS wording and number-ownership proof, privacy policy text | Client counsel | NFR-011, Q-012, T-16 |
| VD-17 | Reviews adapter against the chosen provider; chat provider; pickup placeholder | Provider choice (Q-011, CLR-005) | REQ-PDP-005, REQ-ANL-004 |
| VD-18 | Extend demo host run: offers, add-with-protection, nested coverage lines, order sync, claims links | Client's approved Extend account (B-03) | REQ-EXT-*, REQ-ACPT-002 row A7 |
| VD-19 | Placeholder offer rules (DEC-082, DEC-099): gift is product-level, bundle minimum of 3 cannot require one of each, gift size not tied to the mattress size; the client's real rules (CLR-011) | Dev store discounts; client rules | P4-12, REQ-PROMO-* |
| VD-20 | Independent reviews not recorded or pending: code re-review of `3febb51`, `619db62`; security re-review of `f4b830a`, `22c5408`; first security review of the chat range; code and security reviews of `9f7b0c3`, `a4cfca5`, `51b2439`, `2dff8d6`, `8bf4b58`, `a2e8b2a`; independent code review of P7-02 beyond the minors | code-reviewer (not the author); security-engineer | gates G2 to G5 |
| VD-21 | Test results: `chat.spec.ts` has no recorded result; no e2e re-run of `3febb51`; every count above is agent- or orchestrator-reported and not re-run by the project manager; the framework validator has not run on the records | qa-engineer; orchestrator | all |
| VD-22 | Client acknowledgement of SD-01 to SD-05, SD-07, SD-11 (B-11), CLIENT_QUESTION_PACK not sent (B-08); UXD-01 to UXD-28 unacknowledged (B-29); named decision-maker (Q-013) | Owner sends the pack; client replies | acceptance, release notes |
| VD-23 | Owner's written acceptances (B-17, B-18, B-32, B-33 items 1a to 1f); the working-tree change to `storefront/package-lock.json` (revert or commit alone) | Project owner | G5, security re-review |
| VD-24 | Accessibility/axe of routes needing the dev store (`/checkout-steps` with items, policies, pages, articles, account) | Dev store | NFR-003 |
| VD-25 | Repository history secret scan and repository transfer to the client's GitHub (Q-014); branch protection | Client's organisation; owner pushes | REQ-HAND-001 |

## 7. Preconditions the owner controls (to start the run)

| # | Precondition | Source |
|---|---|---|
| 1 | Online Store password removed on the dev store | B-25, DEC-075 |
| 2 | Admin custom app and token created, set in the shell only | B-27, DEC-076 |
| 3 | Demo catalog loaded (invented data) and test pages, terms policy and `journal` blog made by hand | B-26, DEC-077 |
| 4 | Discounts for the placeholder gift and bundle created (OFFER_SETUP_DEVSTORE) | P4-12 |
| 5 | Payment test modes activated; Local delivery and pickup configured | CLR-007; V-06, V-07 |
| 6 | Browser/device matrix approved by the client | Q-012 |
| 7 | A throwaway VPS (for VD-07 to VD-10) | B-31 item 3 |
| 8 | A person with devices for the manual passes | B-23 |
| 9 | The decision on ADR-0008 / P1-12 so the run is on the build that will ship | B-12 |

## What this plan does not cover

UAT (UAT_PLAN); cutover and the live test order (CUTOVER_AND_DNS); load testing; penetration testing; translation or currency testing (EXC-11); testing of providers' own behaviour beyond what our integration proves.
