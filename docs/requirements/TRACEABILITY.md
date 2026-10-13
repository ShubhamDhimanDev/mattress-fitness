# Requirement traceability matrix

One row per requirement in [REQUIREMENTS.md](REQUIREMENTS.md). It records **planned** test coverage, so nothing can silently go untested, and (later) the evidence that it passed. The strategy behind the layers is in [../testing/TEST_STRATEGY.md](../testing/TEST_STRATEGY.md).

**Layers:** `U` unit test (Vitest, colocated `*.test.ts`), `I` integration test (Vitest with recorded or mocked Shopify and Extend responses, `storefront/tests/integration/`), `E` end-to-end (Playwright Test, `storefront/tests/e2e/<spec>.spec.ts`), `A` accessibility (axe within the e2e spec), `P` performance (Lighthouse CI or WebPageTest budget), `S` security check ([../security/THREAT_MODEL.md](../security/THREAT_MODEL.md)), `M` manual check recorded with evidence, `D` document or configuration evidence.

**State:** `NOT_STARTED`, `IN_PROGRESS`, `PASSING` (link evidence in [../../progress/TEST_RESULTS.md](../../progress/TEST_RESULTS.md)), `FAILING`, `WAIVED` (written approval required). A requirement is only DONE when its row is `PASSING` and its phase gate has passed.

The spec names below are planned file stems, not existing files. `scripts/validate-framework.mjs` fails if a requirement is missing from this table.

| ID | Phase | Unit and integration | E2E, accessibility | Other | State |
|---|---|---|---|---|---|
| REQ-NAV-001 | 2 | U: nav model | E+A: `shell.spec` (3 viewports, keyboard) | M: device pass | IN_PROGRESS (logic and unit tests only; no UI or live-store evidence yet) |
| REQ-NAV-002 | 3B | U: menu mapper; I: menu query | E+A: `shell.spec` mega menu | M: admin edit reflected | NOT_STARTED |
| REQ-NAV-003 | 3B | U: ZIP validator | E: `delivery-zip.spec` | S: no ZIP to third parties | NOT_STARTED |
| REQ-HOME-001 | 3B | U: section mapper; I: homepage query | E+A: `home.spec` | M: admin reorder | IN_PROGRESS (page and e2e `home.spec` pass locally on mock.shop, TEST_RESULTS V-E7; hero copy and section types still TODO P3B-13; admin reorder and live data not verified; review pending) |
| REQ-COL-001 | 3B | U: price and badge logic; I: collection query | E+A: `collection.spec` (built as `catalog.spec`) | P: LCP on listing | IN_PROGRESS (built; unit and e2e pass locally on mock.shop; ratings need P3B-12, gift badge needs P4-06; Lighthouse not run; review pending) |
| REQ-COL-002 | 3B | U: filter-URL codec; I: filters query | E+A: `collection.spec` filters (built as `catalog.spec`) | M: counts vs admin | IN_PROGRESS (filter UI and URL codec built; unit and e2e pass locally; filter ids and counts unverified, V-04; review pending) |
| REQ-COL-003 | 3B | U: tile placement | E: `collection.spec` tiles | | NOT_STARTED |
| REQ-COL-004 | 3B | U: FAQ mapper | E+A: `collection.spec` FAQ | D: JSON-LD validation | IN_PROGRESS (FAQ accordion and FAQPage JSON-LD built; unit tests pass; JSON-LD validation not run; review pending) |
| REQ-COL-005 | 3B | I: brand query | E: `brand.spec` | M: admin edit reflected | NOT_STARTED |
| REQ-SRCH-001 | 3B | U: debounce and guard | E+A: `search.spec` predictive | | IN_PROGRESS (suggestions built, `search.spec` passes locally; not yet a true ARIA combobox, needs a `HeaderSearch.tsx` change, so the listbox keyboard criterion is not met; review pending) |
| REQ-SRCH-002 | 3B | I: search query | E: `search.spec` results | | IN_PROGRESS (results page built, filtered zero-results keeps a reset control (aa1a23e), `search.spec` passes locally on mock.shop; filters unverified on a dev store, V-04; review pending) |
| REQ-PDP-001 | 3B | U: variant selection | E+A: `pdp.spec` size, gallery (built as `catalog.spec`) | P: LCP on PDP | IN_PROGRESS (built; unit and e2e pass locally on mock.shop; variant dimensions and nested lines unverified on a dev store, V-02; Lighthouse not run; review pending) |
| REQ-PDP-002 | 3B | U: section visibility | E: `pdp.spec` sections (built as `catalog.spec`) | D: Product JSON-LD | IN_PROGRESS (sections built; brand section waits on P3B-06; metafields unverified, V-05; JSON-LD validation not run; review pending) |
| REQ-PDP-003 | 3B | I: availability query | E: `pdp.spec` pickup | M: against real location stock | NOT_STARTED |
| REQ-PDP-004 | 3B | | E: `pdp.spec` try-in-store link | | IN_PROGRESS (link built in part; depends on the my-store selection, which is cookie only until P3B-10 wires the header; review pending) |
| REQ-PDP-005 | 3B | U: review adapter contract | E: `pdp.spec` reviews and failure | M: Judge.me proxy with a test key | NOT_STARTED |
| REQ-ADD-001 | 4 | U: size matching | E: `addons.spec` | | IN_PROGRESS (logic and unit tests only; no UI or live-store evidence yet) |
| REQ-ADD-002 | 4 | U: bundle pricing; I: batch add | E: `addons.spec` Add all | | IN_PROGRESS (logic and unit tests only; no UI or live-store evidence yet) |
| REQ-ADD-003 | 5A | U: offer mapping | E: `protection.spec` PDP | | IN_PROGRESS (logic and unit tests only; no UI or live-store evidence yet) |
| REQ-CMP-001 | 6 | U: attribute rows | E+A: `compare.spec` | | IN_PROGRESS (page built on fixture data, Add-to-compare control added in aa1a23e; resolves fixture handles only; unit and `compare.spec` pass locally; no compare link in the navigation yet; rating row omitted until P3B-12; review pending) |
| REQ-QZ-001 | 6 | U: quiz state machine | E+A: `quiz.spec` flow | M: client approves wording | IN_PROGRESS (quiz UI built on fixture data; unit tests pass; `quiz.spec` has 1 failing full-run test (console CSP telemetry error), fix under way; wording not client-approved, CLR-012; review pending) |
| REQ-QZ-002 | 6 | U: result assembly | E: `quiz.spec` results | | IN_PROGRESS (results UI built on fixture data; unit tests pass; covered by the `quiz.spec` full run that currently fails; review pending) |
| REQ-QZ-003 | 6 | U: scoring (table-driven, golden cases) | | | IN_PROGRESS (scoring engine in use by the quiz page; unit tests pass; golden cases not client-approved; review pending) |
| REQ-QZ-004 | 6 | U: config parser (invalid mapping); I: metaobject query | | M: admin edit reflected | IN_PROGRESS (logic and unit tests only; no UI or live-store evidence yet) |
| REQ-QZ-005 | 6 | U: storage; I: account persistence | E: `quiz.spec` return visit | | IN_PROGRESS (device-only storage built and passes locally; saving to the customer account is not built, needs P6-07; criterion not met) |
| REQ-QZ-006 | 6 | U: event builder | E: `analytics.spec` quiz events | | IN_PROGRESS (event hooks built; unit tests pass; consent gating and GA delivery not built or verified, REQ-ANL-001; review pending) |
| REQ-QZ-007 | 6 | | E: `quiz.spec` entry points | | IN_PROGRESS (entry points and guidance note built; each listed surface to be confirmed by QA; review pending) |
| REQ-LOC-001 | 6 | U: route and hours formatting | E+A: `stores.spec` | D: JSON-LD | IN_PROGRESS (state, city and store pages built on fixture stores; unit and `stores.spec` pass locally; store hours need `time_zone`, P3B-16; map tiles and JSON-LD validation not verified; review pending) |
| REQ-LOC-002 | 3A | I: store query | | M: import count and admin edit | IN_PROGRESS (logic and unit tests only; no UI or live-store evidence yet) |
| REQ-LOC-003 | 3B | U: store cookie | E: `stores.spec` my store | | IN_PROGRESS (cookie and "Set as my store" built, `stores.spec` passes locally; header display not wired (P3B-10), so the criterion is not met; pickup availability not built) |
| REQ-DEL-001 | 5B | U: eligibility (ZIP fixtures, boundaries); I: parity script between the metaobject list and Local delivery postal codes | E: `delivery.spec` | M: test order in zone and out of zone | IN_PROGRESS (logic and unit tests only; no UI or live-store evidence yet) |
| REQ-DEL-002 | 5B | U: promise rules | E: `delivery.spec` PDP | | IN_PROGRESS (logic and unit tests only; no UI or live-store evidence yet) |
| REQ-ACC-001 | 6 | I: auth round trip (test store) | E: `account.spec` login | S: session handling | NOT_STARTED |
| REQ-ACC-002 | 6 | I: order queries | E: `account.spec` orders | S: cross-customer test | NOT_STARTED |
| REQ-ACC-003 | 6 | U: matcher and 60-day window; I: lookup route | E: `account.spec` guest | S: enumeration, rate limit | IN_PROGRESS (logic and unit tests only; no UI or live-store evidence yet) |
| REQ-CNT-001 | 6 | | E+A: `content.spec` (15 pages) | M: client text loaded | NOT_STARTED (note: the header reassurance strip and footer About links show a comfort and price guarantee the client has not supplied; needs a layout owner and decision) |
| REQ-CNT-002 | 6 | I: blog query | E: `content.spec` blog | | NOT_STARTED |
| REQ-CART-001 | 4 | U: cart reducer; I: cart mutations | E+A: `cart.spec` | | IN_PROGRESS (cart drawer and page built, size swap on lines added in aa1a23e; unit and `cart.spec` (including hostile input, T-01/T-08) pass locally on mock.shop; not run against a dev store; `cartLinesUpdate` with a new `merchandiseId` (V-16) and nested lines (V-02) unverified; review pending) |
| REQ-CART-002 | 4 | U: gift eligibility | E: `gifts.spec` | | IN_PROGRESS (logic and unit tests; evaluated on each cart pass since aa1a23e; the gift picker is a placeholder; no live-store evidence) |
| REQ-CART-003 | 4 | U: add-on rules | E: `addons.spec` cart | | IN_PROGRESS (rules run on every cart pass since aa1a23e; the add-on picker UI is a placeholder; not seen live; no live-store evidence) |
| REQ-CART-004 | 4 | U: threshold math | E: `cart.spec` free-delivery | | IN_PROGRESS (free-delivery progress message built in aa1a23e on the threshold math; threshold from server-only config, not client-confirmed; no live-store evidence) |
| REQ-CART-005 | 4 | U: message selection | E: `cart.spec` financing | D: wording approval | NOT_STARTED |
| REQ-PRE-001 | 4 | U: step planner | E+A: `precheckout.spec` | | IN_PROGRESS (`/checkout-steps` route built in aa1a23e with the step planner; only the comfort-guarantee step is supported; protection and haul-away steps not built; no live-store evidence) |
| REQ-PRE-002 | 4 | U: protector matching | E: `precheckout.spec` comfort | | IN_PROGRESS (comfort-guarantee step reachable through `?step=`; wording is placeholder pending client approval; no live-store evidence) |
| REQ-PRE-003 | 5B | U: haul-away limits | E: `haulaway.spec` | S: server cap; M: Flow flags an over-limit test order | IN_PROGRESS (logic and unit tests; the cart gate enforces it server-side but the delivery ZIP has no server-side store, so any haul-away line fails closed (`zip-missing`) and blocks checkout until P3B-11 and P5B-04; no haul-away UI; no live-store evidence) |
| REQ-PRE-004 | 5A | U: coverage selection | E: `protection.spec` step | | IN_PROGRESS (logic and unit tests only; no UI or live-store evidence yet) |
| REQ-PRE-005 | 4 | U: decline attributes | E: `precheckout.spec` + M: order in admin | | IN_PROGRESS (logic and unit tests; `cartAttributesUpdate` replace versus merge and a test order in admin unverified; no live-store evidence) |
| REQ-PRE-006 | 4 | U: `evaluateOffers` (tampered carts); I: action | E: `precheckout.spec` tamper | S: price tampering | IN_PROGRESS (revalidation wired in aa1a23e: each cart mutation and the `/checkout-steps` gate evaluate, repair and re-evaluate the cart read back from Shopify (max 3 passes), uncorrectable violations block the hand-off, roles never from the browser; unit and e2e pass locally on mock.shop; security re-verification of aa1a23e pending; no live-store evidence) |
| REQ-PROMO-001 | 4 | U: gift rules | E: `gifts.spec` | M: cart equals checkout | IN_PROGRESS (logic and unit tests only; no UI or live-store evidence yet) |
| REQ-PROMO-002 | 4 | U: bundle rules | E: `addons.spec` bundle | M: cart equals checkout | IN_PROGRESS (logic and unit tests only; no UI or live-store evidence yet) |
| REQ-PROMO-003 | 5B | U: cap and revalidation logic; I: webhook or Flow-equivalent check | E: `haulaway.spec` direct-API over-limit cart | S: tamper test; M: Flow tags and emails on the dev store | IN_PROGRESS (logic and unit tests only; no UI or live-store evidence yet) |
| REQ-POST-001 | 5B | | | D: client decision (app or drop); M: dev-store test if an app is installed | NOT_STARTED |
| REQ-POST-002 | 5B | | | D: client decision (app or drop); M: dev-store test if an app is installed | NOT_STARTED |
| REQ-EXT-001 | 5A | U: request builder; I: Offers client against the local mock, then the Extend demo host | E: `protection.spec` | S: server-only credentials | IN_PROGRESS (logic and unit tests only; no UI or live-store evidence yet) |
| REQ-EXT-002 | 5A | U: link model and price-point matching | E: `protection.spec` qty, size, remove | S: orphan line; M: V-16 nested-line behaviour on the dev store | IN_PROGRESS (logic and unit tests only; no UI or live-store evidence yet) |
| REQ-EXT-003 | 5A | U: order snapshot builder; I: sync against the local mock (create, fulfil, refund, cancel, replay), then the Extend demo host | | S: HMAC; M: contract issued in demo | IN_PROGRESS (logic and unit tests only; no UI or live-store evidence yet) |
| REQ-EXT-004 | 5A | | E: `protection.spec` branding and terms | D: Extend approval | NOT_STARTED |
| REQ-EXT-005 | 5A | U: category filter | E: `protection.spec` ineligible | | IN_PROGRESS (logic and unit tests only; no UI or live-store evidence yet) |
| REQ-CHK-001 | 4 | I: cart-to-checkout hand-off | E: `checkout-handoff.spec` (stops at Shopify checkout) | M: totals compared | IN_PROGRESS (hand-off now goes through the `/checkout-steps` gate with server revalidation (P4-09, P4-11, aa1a23e); permalink `/cart/:lines` redirects to the gate; only the comfort step exists; haul-away lines block checkout until P3B-11; checkout total equality not checked; no `checkout-handoff.spec` yet) |
| REQ-CHK-002 | 5B | | | M: checkout branding review | NOT_STARTED |
| REQ-CHK-003 | 5B | | E: `checkout-handoff.spec` methods | M: test orders per method | NOT_STARTED |
| REQ-CHK-004 | 5B | | | M: test payment per option | NOT_STARTED |
| REQ-CHK-005 | 5B | | | M: test order | NOT_STARTED |
| REQ-CHK-006 | 5B | | | M: emails to test inbox | NOT_STARTED |
| REQ-CAT-001 | 3A | U: validator rules | | D: validation report | IN_PROGRESS (logic and unit tests only; no UI or live-store evidence yet) |
| REQ-CAT-002 | 3A | U: mapper; I: idempotent import (dev store) | | M: sampled comparison | IN_PROGRESS (logic and unit tests only; no UI or live-store evidence yet) |
| REQ-CAT-003 | 3A | U: image matching | | M: sample review | IN_PROGRESS (logic and unit tests only; no UI or live-store evidence yet) |
| REQ-CAT-004 | 3A | | | D: approval log | NOT_STARTED |
| REQ-CAT-005 | 3A | I: new product lands in rules | | M: admin check | NOT_STARTED |
| REQ-CAT-006 | 3A | I: brand query | | M: sample review | NOT_STARTED |
| REQ-CAT-007 | 4 | I: rule query | E: `precheckout.spec` | M: rule change without deploy | IN_PROGRESS (logic and unit tests only; no UI or live-store evidence yet) |
| REQ-CAT-008 | 4 | | E: `gifts.spec`, `addons.spec` | M: launch rules verified | IN_PROGRESS (logic and unit tests only; no UI or live-store evidence yet) |
| REQ-CAT-009 | 3A | I: re-run updates only | | D: admin guide section | IN_PROGRESS (logic and unit tests only; no UI or live-store evidence yet) |
| REQ-ANL-001 | 7 | U: event builders | E: `analytics.spec` consent | M: GA4 DebugView | NOT_STARTED |
| REQ-ANL-002 | 7 | U: event builders | E: `analytics.spec` | M: Meta test events | NOT_STARTED |
| REQ-ANL-003 | 7 | I: signup route | E: `signup.spec` | M: profile in Klaviyo | NOT_STARTED |
| REQ-ANL-004 | 7 | | E: `chat.spec` | | NOT_STARTED |
| REQ-SEO-001 | 7 | U: metadata builders | E: `seo.spec` | D: structured-data validation | NOT_STARTED |
| REQ-HOST-001 | 1 | | | D: staging URL and change-note log | NOT_STARTED |
| REQ-HOST-002 | 9 | | E: smoke on production (read-only) | D: rollback rehearsal | NOT_STARTED |
| REQ-HOST-003 | 9 | | E: smoke on production (read-only) | D: hardening checklist, monitoring test | NOT_STARTED |
| REQ-HOST-004 | 9 | | | D: cutover runbook evidence | NOT_STARTED |
| REQ-HAND-001 | 9 | | | D: repo ownership screenshot, secret scan | NOT_STARTED |
| REQ-HAND-002 | 9 | | | M: client-side clean run | NOT_STARTED |
| REQ-HAND-003 | 9 | | | M: non-developer walkthrough | NOT_STARTED |
| REQ-HAND-004 | 9 | | | D: session record | NOT_STARTED |
| REQ-HAND-005 | 9 | | | D: launch-day log | NOT_STARTED |
| REQ-ACPT-001 | 8 | | | D: issue list and grading log | NOT_STARTED |
| REQ-ACPT-002 | 8 | | | D: test-order evidence per combination | NOT_STARTED |
| REQ-ACPT-003 | 8 | | | D: defect log, signed deferrals | NOT_STARTED |
| REQ-GOV-001 | 0 | | | D: TECH_FEASIBILITY review | NOT_STARTED |
| NFR-001 | 2 | | E: `shell.spec` and every page spec at 4 viewports | M: device pass | IN_PROGRESS (logic and unit tests only; no UI or live-store evidence yet) |
| NFR-002 | 7 | | | P: Lighthouse CI budgets | NOT_STARTED |
| NFR-003 | 7 | | A: axe in every spec | M: screen-reader pass | NOT_STARTED |
| NFR-004 | 7 | I: webhook signature | | S: threat-model verification, dependency audit | NOT_STARTED |
| NFR-005 | 6 | | | M: non-developer edits each content type | NOT_STARTED |
| NFR-006 | 1 | | | D: architecture review (no database) | NOT_STARTED |
| NFR-007 | 8 | | | D: asset provenance and copy review | NOT_STARTED |
| NFR-008 | 2 | U: price formatting | | D: no i18n or currency libraries | IN_PROGRESS (logic and unit tests only; no UI or live-store evidence yet) |
| NFR-009 | 8 | | E: browser projects in the Playwright config | M: device matrix | NOT_STARTED |
| NFR-010 | 7 | U: logger redaction | | D: alert test | NOT_STARTED |
| NFR-011 | 7 | | E: `analytics.spec` consent gating | D: consent behaviour approved | NOT_STARTED |
| NFR-012 | 1 | | | D: CI run showing a failing check blocks merge | IN_PROGRESS (logic and unit tests only; no UI or live-store evidence yet) |
| NFR-013 | 5A | I: timeouts and failures | E: `resilience.spec` | | IN_PROGRESS (logic and unit tests only; no UI or live-store evidence yet) |
