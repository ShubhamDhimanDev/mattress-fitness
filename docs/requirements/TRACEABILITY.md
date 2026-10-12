# Requirement traceability matrix

One row per requirement in [REQUIREMENTS.md](REQUIREMENTS.md). It records **planned** test coverage, so nothing can silently go untested, and (later) the evidence that it passed. The strategy behind the layers is in [../testing/TEST_STRATEGY.md](../testing/TEST_STRATEGY.md).

**Layers:** `U` unit test (Vitest, colocated `*.test.ts`), `I` integration test (Vitest with recorded or mocked Shopify and Extend responses, `storefront/tests/integration/`), `E` end-to-end (Playwright Test, `storefront/tests/e2e/<spec>.spec.ts`), `A` accessibility (axe within the e2e spec), `P` performance (Lighthouse CI or WebPageTest budget), `S` security check ([../security/THREAT_MODEL.md](../security/THREAT_MODEL.md)), `M` manual check recorded with evidence, `D` document or configuration evidence.

**State:** `NOT_STARTED`, `IN_PROGRESS`, `PASSING` (link evidence in [../../progress/TEST_RESULTS.md](../../progress/TEST_RESULTS.md)), `FAILING`, `WAIVED` (written approval required). A requirement is only DONE when its row is `PASSING` and its phase gate has passed.

The spec names below are planned file stems, not existing files. `scripts/validate-framework.mjs` fails if a requirement is missing from this table.

| ID | Phase | Unit and integration | E2E, accessibility | Other | State |
|---|---|---|---|---|---|
| REQ-NAV-001 | 2 | U: nav model | E+A: `shell.spec` (3 viewports, keyboard) | M: device pass | NOT_STARTED |
| REQ-NAV-002 | 3B | U: menu mapper; I: menu query | E+A: `shell.spec` mega menu | M: admin edit reflected | NOT_STARTED |
| REQ-NAV-003 | 3B | U: ZIP validator | E: `delivery-zip.spec` | S: no ZIP to third parties | NOT_STARTED |
| REQ-HOME-001 | 3B | U: section mapper; I: homepage query | E+A: `home.spec` | M: admin reorder | NOT_STARTED |
| REQ-COL-001 | 3B | U: price and badge logic; I: collection query | E+A: `collection.spec` | P: LCP on listing | NOT_STARTED |
| REQ-COL-002 | 3B | U: filter-URL codec; I: filters query | E+A: `collection.spec` filters | M: counts vs admin | NOT_STARTED |
| REQ-COL-003 | 3B | U: tile placement | E: `collection.spec` tiles | | NOT_STARTED |
| REQ-COL-004 | 3B | U: FAQ mapper | E+A: `collection.spec` FAQ | D: JSON-LD validation | NOT_STARTED |
| REQ-COL-005 | 3B | I: brand query | E: `brand.spec` | M: admin edit reflected | NOT_STARTED |
| REQ-SRCH-001 | 3B | U: debounce and guard | E+A: `search.spec` predictive | | NOT_STARTED |
| REQ-SRCH-002 | 3B | I: search query | E: `search.spec` results | | NOT_STARTED |
| REQ-PDP-001 | 3B | U: variant selection | E+A: `pdp.spec` size, gallery | P: LCP on PDP | NOT_STARTED |
| REQ-PDP-002 | 3B | U: section visibility | E: `pdp.spec` sections | D: Product JSON-LD | NOT_STARTED |
| REQ-PDP-003 | 3B | I: availability query | E: `pdp.spec` pickup | M: against real location stock | NOT_STARTED |
| REQ-PDP-004 | 3B | | E: `pdp.spec` try-in-store link | | NOT_STARTED |
| REQ-PDP-005 | 3B | U: review adapter contract | E: `pdp.spec` reviews and failure | M: Judge.me proxy with a test key | NOT_STARTED |
| REQ-ADD-001 | 4 | U: size matching | E: `addons.spec` | | NOT_STARTED |
| REQ-ADD-002 | 4 | U: bundle pricing; I: batch add | E: `addons.spec` Add all | | NOT_STARTED |
| REQ-ADD-003 | 5A | U: offer mapping | E: `protection.spec` PDP | | NOT_STARTED |
| REQ-CMP-001 | 6 | U: attribute rows | E+A: `compare.spec` | | NOT_STARTED |
| REQ-QZ-001 | 6 | U: quiz state machine | E+A: `quiz.spec` flow | M: client approves wording | NOT_STARTED |
| REQ-QZ-002 | 6 | U: result assembly | E: `quiz.spec` results | | NOT_STARTED |
| REQ-QZ-003 | 6 | U: scoring (table-driven, golden cases) | | | NOT_STARTED |
| REQ-QZ-004 | 6 | U: config parser (invalid mapping); I: metaobject query | | M: admin edit reflected | NOT_STARTED |
| REQ-QZ-005 | 6 | U: storage; I: account persistence | E: `quiz.spec` return visit | | NOT_STARTED |
| REQ-QZ-006 | 6 | U: event builder | E: `analytics.spec` quiz events | | NOT_STARTED |
| REQ-QZ-007 | 6 | | E: `quiz.spec` entry points | | NOT_STARTED |
| REQ-LOC-001 | 6 | U: route and hours formatting | E+A: `stores.spec` | D: JSON-LD | NOT_STARTED |
| REQ-LOC-002 | 3A | I: store query | | M: import count and admin edit | NOT_STARTED |
| REQ-LOC-003 | 3B | U: store cookie | E: `stores.spec` my store | | NOT_STARTED |
| REQ-DEL-001 | 5B | U: eligibility (ZIP fixtures, boundaries); I: parity script between the metaobject list and Local delivery postal codes | E: `delivery.spec` | M: test order in zone and out of zone | NOT_STARTED |
| REQ-DEL-002 | 5B | U: promise rules | E: `delivery.spec` PDP | | NOT_STARTED |
| REQ-ACC-001 | 6 | I: auth round trip (test store) | E: `account.spec` login | S: session handling | NOT_STARTED |
| REQ-ACC-002 | 6 | I: order queries | E: `account.spec` orders | S: cross-customer test | NOT_STARTED |
| REQ-ACC-003 | 6 | U: matcher and 60-day window; I: lookup route | E: `account.spec` guest | S: enumeration, rate limit | NOT_STARTED |
| REQ-CNT-001 | 6 | | E+A: `content.spec` (15 pages) | M: client text loaded | NOT_STARTED |
| REQ-CNT-002 | 6 | I: blog query | E: `content.spec` blog | | NOT_STARTED |
| REQ-CART-001 | 4 | U: cart reducer; I: cart mutations | E+A: `cart.spec` | | NOT_STARTED |
| REQ-CART-002 | 4 | U: gift eligibility | E: `gifts.spec` | | NOT_STARTED |
| REQ-CART-003 | 4 | U: add-on rules | E: `addons.spec` cart | | NOT_STARTED |
| REQ-CART-004 | 4 | U: threshold math | E: `cart.spec` free-delivery | | NOT_STARTED |
| REQ-CART-005 | 4 | U: message selection | E: `cart.spec` financing | D: wording approval | NOT_STARTED |
| REQ-PRE-001 | 4 | U: step planner | E+A: `precheckout.spec` | | NOT_STARTED |
| REQ-PRE-002 | 4 | U: protector matching | E: `precheckout.spec` comfort | | NOT_STARTED |
| REQ-PRE-003 | 5B | U: haul-away limits | E: `haulaway.spec` | S: server cap; M: Flow flags an over-limit test order | NOT_STARTED |
| REQ-PRE-004 | 5A | U: coverage selection | E: `protection.spec` step | | NOT_STARTED |
| REQ-PRE-005 | 4 | U: decline attributes | E: `precheckout.spec` + M: order in admin | | NOT_STARTED |
| REQ-PRE-006 | 4 | U: `evaluateOffers` (tampered carts); I: action | E: `precheckout.spec` tamper | S: price tampering | NOT_STARTED |
| REQ-PROMO-001 | 4 | U: gift rules | E: `gifts.spec` | M: cart equals checkout | NOT_STARTED |
| REQ-PROMO-002 | 4 | U: bundle rules | E: `addons.spec` bundle | M: cart equals checkout | NOT_STARTED |
| REQ-PROMO-003 | 5B | U: cap and revalidation logic; I: webhook or Flow-equivalent check | E: `haulaway.spec` direct-API over-limit cart | S: tamper test; M: Flow tags and emails on the dev store | NOT_STARTED |
| REQ-POST-001 | 5B | | | D: client decision (app or drop); M: dev-store test if an app is installed | NOT_STARTED |
| REQ-POST-002 | 5B | | | D: client decision (app or drop); M: dev-store test if an app is installed | NOT_STARTED |
| REQ-EXT-001 | 5A | U: request builder; I: Offers client against the local mock, then the Extend demo host | E: `protection.spec` | S: server-only credentials | NOT_STARTED |
| REQ-EXT-002 | 5A | U: link model and price-point matching | E: `protection.spec` qty, size, remove | S: orphan line; M: V-16 nested-line behaviour on the dev store | NOT_STARTED |
| REQ-EXT-003 | 5A | U: order snapshot builder; I: sync against the local mock (create, fulfil, refund, cancel, replay), then the Extend demo host | | S: HMAC; M: contract issued in demo | NOT_STARTED |
| REQ-EXT-004 | 5A | | E: `protection.spec` branding and terms | D: Extend approval | NOT_STARTED |
| REQ-EXT-005 | 5A | U: category filter | E: `protection.spec` ineligible | | NOT_STARTED |
| REQ-CHK-001 | 4 | I: cart-to-checkout hand-off | E: `checkout-handoff.spec` (stops at Shopify checkout) | M: totals compared | NOT_STARTED |
| REQ-CHK-002 | 5B | | | M: checkout branding review | NOT_STARTED |
| REQ-CHK-003 | 5B | | E: `checkout-handoff.spec` methods | M: test orders per method | NOT_STARTED |
| REQ-CHK-004 | 5B | | | M: test payment per option | NOT_STARTED |
| REQ-CHK-005 | 5B | | | M: test order | NOT_STARTED |
| REQ-CHK-006 | 5B | | | M: emails to test inbox | NOT_STARTED |
| REQ-CAT-001 | 3A | U: validator rules | | D: validation report | NOT_STARTED |
| REQ-CAT-002 | 3A | U: mapper; I: idempotent import (dev store) | | M: sampled comparison | NOT_STARTED |
| REQ-CAT-003 | 3A | U: image matching | | M: sample review | NOT_STARTED |
| REQ-CAT-004 | 3A | | | D: approval log | NOT_STARTED |
| REQ-CAT-005 | 3A | I: new product lands in rules | | M: admin check | NOT_STARTED |
| REQ-CAT-006 | 3A | I: brand query | | M: sample review | NOT_STARTED |
| REQ-CAT-007 | 4 | I: rule query | E: `precheckout.spec` | M: rule change without deploy | NOT_STARTED |
| REQ-CAT-008 | 4 | | E: `gifts.spec`, `addons.spec` | M: launch rules verified | NOT_STARTED |
| REQ-CAT-009 | 3A | I: re-run updates only | | D: admin guide section | NOT_STARTED |
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
| NFR-001 | 2 | | E: `shell.spec` and every page spec at 4 viewports | M: device pass | NOT_STARTED |
| NFR-002 | 7 | | | P: Lighthouse CI budgets | NOT_STARTED |
| NFR-003 | 7 | | A: axe in every spec | M: screen-reader pass | NOT_STARTED |
| NFR-004 | 7 | I: webhook signature | | S: threat-model verification, dependency audit | NOT_STARTED |
| NFR-005 | 6 | | | M: non-developer edits each content type | NOT_STARTED |
| NFR-006 | 1 | | | D: architecture review (no database) | NOT_STARTED |
| NFR-007 | 8 | | | D: asset provenance and copy review | NOT_STARTED |
| NFR-008 | 2 | U: price formatting | | D: no i18n or currency libraries | NOT_STARTED |
| NFR-009 | 8 | | E: browser projects in the Playwright config | M: device matrix | NOT_STARTED |
| NFR-010 | 7 | U: logger redaction | | D: alert test | NOT_STARTED |
| NFR-011 | 7 | | E: `analytics.spec` consent gating | D: consent behaviour approved | NOT_STARTED |
| NFR-012 | 1 | | | D: CI run showing a failing check blocks merge | NOT_STARTED |
| NFR-013 | 5A | I: timeouts and failures | E: `resilience.spec` | | NOT_STARTED |
