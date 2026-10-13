# Backlog (dependency-aware, rolling wave)

Task definitions live in the phase plans ([plans/phases/](phases/)). This file is the **single place where task status is tracked**, for tasks that are active (the current phase, the next phase and anything already started). Tasks not listed here are implicitly `TODO` and defined only in their phase plan. Status vocabulary and gates: [MASTER_PLAN](MASTER_PLAN.md). Updated 2026-10-13.

`Depends on` lists task IDs (validated by `scripts/validate-framework.mjs`) and open items (`Q-*`, `CLR-*`, `G-*`). Priority: High (on the critical path or blocks others), Med, Low.

## Sprint 1 (Phase 0 and Phase 1 start): state after the owner's answers

| ID | Task | Phase | Owner | Depends on | Status | Priority | Notes |
|---|---|---|---|---|---|---|---|
| P0-01 | Transcribe SOW; requirements catalogue, traceability, question list | 0 | project-manager | none | IN_REVIEW | High | Owner confirmed the SOW is final (Q-001). Still to do: place the PDF in `docs/requirements/source/` and diff the transcription |
| P0-02 | Send consolidated question pack to the client's decision-maker | 0 | project-manager | P0-01 | IN_REVIEW | High | Drafted: `docs/requirements/CLIENT_QUESTION_PACK.md` (plain language). Owner reviews and sends; Extend questions go with it |
| P0-03 | Establish the Shopify development store; confirm the live store's plan | 0 | solution-architect | Q-002 | BLOCKED | High | Plan is **Basic** (owner). Still needs a Partner account or collaborator access to create or reach a store |
| P0-04 | Prove Storefront API assumptions on the development store | 0 | shopify-hydrogen-developer | P0-03 | BLOCKED | High | V-02, V-03, V-04, V-05, V-07, V-08, V-16, V-17 |
| P0-05 | Extend: written answers and demo credentials | 0 | integration-engineer | P0-02 | BLOCKED | Med | **Building does not wait for this** (ADR-0009); only go-live does |
| P0-06 | Verify Functions, post-purchase and checkout eligibility for the plan; recommend fallbacks | 0 | integration-engineer | none | IN_REVIEW | High | Done by research: [BASIC_PLAN_WORKAROUNDS](../docs/research/BASIC_PLAN_WORKAROUNDS.md), ADR-0006, SOW_DEVIATIONS. Needs independent review and client acknowledgement |
| P0-07 | Delivery-zone approach comparison (research) | 0 | solution-architect | none | IN_REVIEW | Med | `DELIVERY_ZONE_OPTIONS.md`; single zone decided by the owner, ADR-0007 proposed |
| P0-08 | Reference-site pattern notes (layout and features only) | 0 | ui-ux-designer | none | IN_REVIEW | Low | `REFERENCE_PATTERNS.md`, extended with a visual-structure study; needs review for NFR-007 |
| P0-09 | Install and verify Node 22 LTS side by side | 0 | devops-engineer | Q-017 | DONE | High | fnm 1.39.0 and Node v22.23.3 installed with owner approval; evidence in `progress/TEST_RESULTS.md` |
| P0-10 | Framework verification: validation script, agents listed, MCP approval | 0 | project-manager | none | IN_PROGRESS | High | Script passes; Claude Code loads agents and skills (F-17); Figma verified; owner must approve the project MCP servers and confirm Playwright connects (B-04) |
| P0-11 | Phase 0 exit review and Phase 1 go or no-go | 0 | project-manager | P0-02, P0-07, P0-09, P0-10 | TODO | Med | |
| P1-01 | Pin Node 22 LTS through fnm; add `.nvmrc` | 1 | devops-engineer | P0-09 | DONE | High | `.nvmrc` = 22; scaffold `engines` is `^22 \|\| ^24` |
| P1-02 | Initialise git repository on `main` | 1 | devops-engineer | none | DONE | Low | No commits yet (commit only on the owner's request) |
| P1-03 | Scaffold Hydrogen into `storefront/` (TypeScript, Tailwind, mock shop) | 1 | shopify-hydrogen-developer | P1-01 | IN_REVIEW | High | Done 2026-10-12 with the recorded flags; lint, typecheck, build pass; nested `.git` removed. Needs independent review |
| P1-04 | Quality tooling: Vitest, Prettier check, scripts | 1 | shopify-hydrogen-developer | P1-03 | IN_REVIEW | High | Done 2026-10-12 (Vitest 5, Testing Library, jsdom, `format:check`, `check`); on main |
| P1-05 | Playwright Test setup, axe helper and smoke spec | 1 | qa-engineer | P1-03 | IN_REVIEW | High | Done: desktop and mobile Chromium, 4 smoke tests pass; WebKit and Firefox run in CI |
| P1-06 | CI workflow (verified locally first) | 1 | devops-engineer | P1-04, P1-05 | IN_REVIEW | High | `.github/workflows/ci.yml` written, YAML parses, commands verified locally; first real run when a remote exists (Q-014) |
| P1-07 | Staging pipeline on our server | 1 | devops-engineer | P1-06 | BLOCKED | Med | Staging server details not provided |
| P1-08 | Prove a plain-Node build (Option B viability) | 1 | devops-engineer | P1-03 | IN_REVIEW | Med | Spike passed: [OPTION_B_NODE](../docs/deployment/OPTION_B_NODE.md), F-44 |
| P1-09 | Reconcile architecture docs and ADRs with the scaffold | 1 | solution-architect | P1-03, P1-08 | TODO | Med | |
| P1-10 | Daily change-note template and weekly demo cadence | 1 | project-manager | none | TODO | Low | |
| P1-12 | Hydrogen dependency advisories and the 2026.10 migration | 1 | shopify-hydrogen-developer | P1-03, Q-019 | BLOCKED | High | **Launch blocker:** react-router below 7.18 has open high-severity advisories (security review H-1); the owner has not yet accepted ADR-0008, which stays Proposed. Decision 2026-10-12: hold the scaffold pins; the 2026.10 template on GitHub `main` is a different, unreleased architecture (F-44). Revisit when `npm create @shopify/hydrogen` delivers it, and at the Phase 7 gate at the latest (ADR-0008) |
| P1-13 | Review template-supplied agent files; replace `storefront/CLAUDE.md` | 1 | devops-engineer | P1-03 | IN_REVIEW | Med | Written; template `AGENTS.md` left as reference, not followed |
| P1-11 | Phase 1 gate review | 1 | project-manager | P1-04, P1-05, P1-06, P1-07, P1-08, P1-09, P1-10, P1-12, P1-13 | BLOCKED | Med | |

## Sprint 2 (proposed, unblocked first)

| ID | Task | Phase | Owner | Depends on | Status | Priority | Notes |
|---|---|---|---|---|---|---|---|
| P2-01 | Brand kit and neutral placeholder tokens (no Figma expected) | 2 | ui-ux-designer | P0-02 | IN_REVIEW | Med | Tokens, components and shell built (`tailwind.css`, `app/components/ui|layout`); ADR-0010. Real brand arrives with CLR-013 |
| P5A-03 | Local mock server of Extend's documented subset | 5A | integration-engineer | P1-04 | IN_REVIEW | High | `scripts/mocks/extend-mock.mjs` (MOCK-labelled) + fixtures; 589 library and integration tests pass |
| P5A-04 | Offers client, price-point matching, feature flag | 5A | integration-engineer | P5A-03 | IN_REVIEW | High | `app/lib/extend/*` done; routes and UI not wired yet (P5A-05) |
| P5A-06 | Cart linking: add as nested line, quantity follows, size change, removal, orphan detection | 5A | integration-engineer | P5A-02, P5A-05 | TODO | High | **Exit criterion:** coverage enforcement runs through the cart gate (`/checkout-steps` and every cart mutation): the server variant list feeds `extend-seam.ts` (coverage roles and `protectionEligibleLineIds`), so orphan or oversized coverage is corrected and never reaches checkout on our storefront path. Until then coverage lines look like ordinary lines to the gate. Direct Storefront API carts stay detective only (ADR-0006) |
| P3A-10 | Delivery-zone single source of truth (ADR-0007 accepted) | 3A | solution-architect | P0-07 | TODO | Med | Needs the ZIP list (Q-008) |

## Sprint 2 additions (built 2026-10-12, in review; library level, not yet wired into routes)

| ID | Task | Phase | Owner | Depends on | Status | Priority | Notes |
|---|---|---|---|---|---|---|---|
| P4-01 | Offer engine `evaluateOffers` and tampered-cart tests | 4 | solution-architect | P3A-02 | IN_REVIEW | High | `app/lib/offers/*` (445 tests incl. a 4,000-cart property test) |
| P5B-01 | Delivery eligibility module for the single zone | 5B | integration-engineer | P3A-10 | IN_REVIEW | High | `app/lib/delivery/*` (183 tests) |
| P3A-03 | Product sheet template and schema | 3A | shopify-hydrogen-developer | P3A-02 | IN_REVIEW | High | `scripts/catalog/*` (CSV, validator, sanitiser, importer; 203 script tests) |
| P3A-04 | Validator and validation report | 3A | shopify-hydrogen-developer | P3A-03 | IN_REVIEW | High | done |
| P3A-05 | Idempotent importer (dry run default) | 3A | shopify-hydrogen-developer | P3A-04 | IN_REVIEW | High | done against a fake Admin API; **first live run still to do**; no revert tool yet |
| P3A-02 | Metafield and metaobject definitions as code | 3A | solution-architect | P3A-01 | IN_REVIEW | High | `scripts/shopify/definitions.json` + `apply-definitions.mjs` (dry run default) |
| P6-01 | Quiz configuration model, loader and validation | 6 | shopify-hydrogen-developer | P3A-02, CLR-012 | IN_REVIEW | Med | `app/lib/quiz/config.ts` |
| P6-02 | Scoring engine with reasons and golden tests | 6 | shopify-hydrogen-developer | P6-01 | IN_REVIEW | Med | `app/lib/quiz/score.ts` |
| P6-13 | Friendlier quiz scoring model in Shopify admin (rule metaobjects instead of a raw JSON field) so non-developers can edit mappings (NFR-005, REQ-QZ-004) | 6 | solution-architect | P6-01 | TODO | Med | Decision 2026-10-12: keep JSON for v1 with a validating template in the admin guide; replace with `quiz_scoring_rule` metaobjects before Phase 6 acceptance. The scoring field is still raw JSON (2026-10-13) |
| P3B-16 | Add optional `time_zone` field to the `store` metaobject (store hours need it) | 3B | solution-architect | P3A-02 | TODO | Low | Raised by the quiz and stores library; the store pages now need it for "open today" |
| P6-14 | Guest-tracking shared rate limiter (the in-memory limiter is per runtime instance) | 6 | security-engineer | P6-08 | TODO | Med | Needs a shared store or an edge rule before go-live (R-27); the choice depends on the hosting answer (Q-003, B-06) |
| P5A-14 | Reconciliation script `scripts/reconcile-extend.mjs` on top of `reconcile()` | 5A | integration-engineer | P5A-09 | TODO | Med | P5A-10 in the phase plan. Not built (2026-10-13) |

## Sprint 3 additions (built 2026-10-13 in commits 8c533e2, 46e64a2 and aa1a23e; no live-store verification)

Status rule for this block: `IN_REVIEW` means built, locally verified (typecheck, lint, format:check, Vitest, build; e2e on fixtures) and waiting for the independent code and security reviews of both commits (running 2026-10-13). `IN_PROGRESS` means built in part, with the gap named. Nothing here is `DONE`: no row has run against a real dev store (B-02), so V-02, V-04 and V-05 are unverified, and Lighthouse and the checkout total equality check have not been run. Evidence: [TEST_RESULTS](../progress/TEST_RESULTS.md) V-E1 to V-E7.

| ID | Task | Phase | Owner | Depends on | Status | Priority | Notes |
|---|---|---|---|---|---|---|---|
| P3B-01 | Query modules, generated types, caching helpers, error mapping | 3B | shopify-hydrogen-developer | P3A-01 | IN_REVIEW | High | Commit 46e64a2: `app/lib/shopify/*`, `app/lib/catalog/*`. Built on mock.shop and fixtures; metafield reads (V-05) unverified. Price and availability queries use a 60s/300s stale-while-revalidate strategy (DEC-024, decided; implemented in aa1a23e as `pricedCache`). `PUBLIC_SITE_URL` is the canonical origin (security review P-L2); fixture pages are `noindex`; discount links merge codes (P-L4 part) |
| P3B-03 | Collection page: grid, sort, load more, From $ pricing, sale and gift badges | 3B | shopify-hydrogen-developer | P3B-01 | IN_REVIEW | High | REQ-COL-001. Ratings and gift badge sources depend on P3B-12 and P4-06 |
| P3B-04 | Filters and URL codec; empty and error states | 3B | shopify-hydrogen-developer | P3B-03, V-04 | IN_REVIEW | High | REQ-COL-002. **Filter counts and ids unverified (V-04)**; the task stays in review, not done, until checked on a dev store |
| P3B-05 | Promo tiles in the grid and collection FAQs with JSON-LD | 3B | shopify-hydrogen-developer | P3B-03 | IN_PROGRESS | Med | FAQs with JSON-LD built (REQ-COL-004). **Promo tiles not built (REQ-COL-003)** |
| P3B-06 | Brand collection pages and brand sections | 3B | shopify-hydrogen-developer | P3B-03, REQ-CAT-006 | TODO | Med | Not built (REQ-COL-005); the PDP brand section depends on it |
| P3B-07 | Predictive search and search results page | 3B | shopify-hydrogen-developer | P3B-04 | IN_PROGRESS | Med | Results page and suggestions built (REQ-SRCH-001/002). **Gap:** the suggestions are not a true ARIA combobox; the fix needs a change to `layout/HeaderSearch.tsx` (layout file, claim it first) |
| P3B-08 | Product page core: gallery, size selector with dimensions, live price, savings, badges, URL state | 3B | shopify-hydrogen-developer | P3B-01 | IN_REVIEW | High | REQ-PDP-001. Nested lines (V-02) and variant data on a real store unverified |
| P3B-09 | Product page content: overview, specifications, features, brand, delivery and warranty sections, FAQs, Product JSON-LD | 3B | shopify-hydrogen-developer | P3B-08 | IN_PROGRESS | Med | REQ-PDP-002 sections built. Brand section waits on P3B-06; delivery promise on P5B-03; product page slots not yet filled: reviews (P3B-12), pickup (P3B-10), add-ons (P4-03), Extend (P5A-05) |
| P3B-10 | "My store" selector, "set as my store", pickup availability and try-in-store link | 3B | shopify-hydrogen-developer | P3B-08, REQ-LOC-002 | IN_PROGRESS | Med | "Set as my store" cookie and "Try in store" link (REQ-PDP-004, partly) built. **Not built:** the header `StoreSelectorLink` does not read the `my_store` cookie, so the header display of REQ-LOC-003 is missing; pickup availability (REQ-PDP-003) |
| P3B-12 | Reviews adapter interface and the chosen provider | 3B | integration-engineer | Q-011 | TODO | Med | Not built; the product page slot and listing ratings are empty. Blocked on the provider choice (Q-011) |
| P3B-13 | Homepage sections from Shopify, reorderable in admin | 3B | shopify-hydrogen-developer | P3B-01 | IN_PROGRESS | Med | REQ-HOME-001 renders. **Gaps:** hero copy is `TODO(P3B-13)` in code; the section types the homepage needs are not yet defined under `homepage_section` in `scripts/shopify/definitions.json` (P3A-02 follow-up), so admin editing and reordering are unproven; the promotional bar text in `PageLayout.tsx` is also a placeholder |
| P3B-14 | E2E journeys, accessibility scans, performance baseline | 3B | qa-engineer | P3B-03 to P3B-13 | IN_PROGRESS | Med | After aa1a23e (agent-reported): cart, quiz and shell specs 110 pass, 31 skipped, 1 fail then fixed (telemetry console filter); page specs 116 pass; e2e no longer skips on store data. Not re-run as one full suite by the project manager. Lighthouse baseline not run |
| P4-02 | Cart drawer and page: edit size and quantity, remove, optimistic updates, errors | 4 | shopify-hydrogen-developer | P3B-08 | IN_REVIEW | High | REQ-CART-001. Commit aa1a23e adds **size swap on cart lines**. Line updates now drop attributes (security review P-L1). Cart cookie is HttpOnly, SameSite=Lax, 10 days, Secure off localhost (P-M1); `private, no-store` on cart routes (P-L3). Against mock.shop only. **Unverified without a dev store:** `cartLinesUpdate` with a new `merchandiseId` (V-16: does it keep child lines, does it merge duplicate lines) and nested lines (V-02) |
| P4-03 | Size-matched foundations, adjustable bases and frames on the product page | 4 | shopify-hydrogen-developer | P4-01 | TODO | Med | Product page add-on slot still empty (REQ-ADD-001). Needs the add-on picker (see P4-04) and product data (P4-12) |
| P4-04 | Matching protector, pillow and bedding offers in the cart | 4 | shopify-hydrogen-developer | P4-01 | IN_PROGRESS | Med | REQ-CART-003. Offers engine runs on every cart pass (aa1a23e); **the add-on picker UI is a placeholder, as are the bundle (P4-05) and gift (P4-06) pickers**; offers UI not seen live (mock.shop returns empty for `node`/`nodes`). Offer wording is placeholder, needs client approval |
| P4-07 | Free-delivery progress message | 4 | shopify-hydrogen-developer | P4-02, CLR-009 | IN_REVIEW | Low | REQ-CART-004. Built in aa1a23e on the threshold math; the threshold comes from the server-only offer config, not confirmed by the client (CLR-009); wording placeholder |
| P4-09 | Pre-checkout flow route and step planner; comfort-guarantee step | 4 | shopify-hydrogen-developer | P4-01, CLR-010 | IN_PROGRESS | High | `routes/checkout-steps.tsx` built in aa1a23e. **Only the comfort-guarantee step is supported** (`?step=`); protection (P5A-07) and haul-away (P5B-04) steps are not. Wording is placeholder for client approval |
| P4-10 | Decline recording through cart attributes; verify on a test order in admin | 4 | integration-engineer | P4-09 | IN_PROGRESS | Med | `app/lib/offers/attributes.ts` exists. **Unverified:** `cartAttributesUpdate` replace versus merge on a live cart, and a test order in admin (needs the dev store, B-02). Orchestrator to confirm what the comfort step writes |
| P4-11 | Server revalidation action and hand-off to Shopify checkout | 4 | shopify-hydrogen-developer | P4-09, P4-10 | IN_REVIEW | High | aa1a23e: every cart mutation and the new `/checkout-steps` gate re-read the cart from Shopify and run evaluate, repair, re-evaluate (max 3 passes); uncorrectable violations **block the storefront path (our cart, drawer and `/checkout-steps` gate); direct Storefront API carts are detective only (ADR-0006)**. Roles never come from the browser. Permalink `/cart/:lines` now redirects to `/checkout-steps`. Addresses security review P-M2 (pending re-verification by the running review of aa1a23e). **Design points:** a GET to `/cart` or `/checkout-steps` can repair, so write, the cart (accepted design, DEC-029); the Hydrogen mutation cart is minimal so each pass costs an extra read. **Gaps:** the delivery ZIP has no server-side store, so every haul-away line fails closed (`zip-missing`) and blocks checkout until P3B-11 and P5B-04; the Extend seam returns empty inputs until P5A-06/07; cart total equals checkout total unverified (B-13) |
| P4-12 | Configure add-on and service products and launch promotions on the development store (REQ-CAT-007, REQ-CAT-008) | 4 | integration-engineer | CLR-010, CLR-011 | IN_PROGRESS | Med | Interim seam only: offer rules come from the server-only `OFFER_CONFIG_JSON` until metaobject-based rules exist (DEC-030). Dev-store configuration not started (B-02). Retire the seam here |
| P6-03 | Quiz UI: one-tap questions, progress bar, results with Add to cart, See all matches, Retake, guidance note, entry points | 6 | shopify-hydrogen-developer | P6-02, P4-02 | IN_REVIEW | Med | Commit 8c533e2, fixture data through `app/lib/pages/data-source.ts` (REQ-QZ-001 to 003, 006, 007). Question wording is not client-approved (CLR-012) |
| P6-04 | Quiz persistence on device and in the account | 6 | shopify-hydrogen-developer | P6-03, P6-07 | IN_PROGRESS | Med | Device-only storage built (REQ-QZ-005 first half). **Account sync not built**; needs P6-07 |
| P6-05 | Product comparison from collections and product pages | 6 | shopify-hydrogen-developer | P3B-03 | IN_REVIEW | Med | REQ-CMP-001 page built on fixtures; aa1a23e adds an Add-to-compare control. `/compare` resolves fixture handles only (DEC-023). **Gap:** no compare link in the navigation (layout file) |
| P6-06 | Store locator: state, city and store pages, hours, phone, directions, map adapter | 6 | shopify-hydrogen-developer | P3A-07, Q-010 | IN_REVIEW | Med | REQ-LOC-001 on fixture stores. Hours need the `time_zone` field (P3B-16) |
| P6-10 | Quiz event hooks via `track()` (start, complete, result click) | 6 | shopify-hydrogen-developer | P6-03 | IN_REVIEW | Low | REQ-QZ-006; consent gating verified only in tests (REQ-ANL-001 not built). The one failing e2e is a CSP telemetry console error in this area |

## Deferred and open items from the reviews (recorded 2026-10-13)

| ID | Task | Phase | Owner | Depends on | Status | Priority | Notes |
|---|---|---|---|---|---|---|---|
| P5A-08 | Webhook receiver route: HMAC verification, topic routing, safe replay | 5A | integration-engineer | V-12, V-20 | TODO | Med | Route not built. Security review L-1 to apply: debounce replays per order id, set `maxAgeMs` above 4 hours, reject oversize bodies before buffering |
| P5B-05 | Detective control for over-limit or mismatched haul-away orders | 5B | integration-engineer | V-17, P5B-04 | TODO | Med | Security review M-4: the report must compare the order shipping ZIP with `isInZone`, not only the stored ZIP |
| P3B-11 | ZIP entry in the header: validator, cookie, server-side read | 3B | shopify-hydrogen-developer | P3B-01 | TODO | High | Now on the checkout path: the delivery ZIP has no server-side store, so the cart gate fails closed (`zip-missing`) and **any haul-away line blocks checkout** until this and P5B-04 land (see P4-11) |
| P7-07 | Security hardening: headers, CSP, rate limits, dependency audit, secret scan, threat-model verification | 7 | security-engineer | all | TODO | Med | Carry-over from [REVIEW-2026-10-13-pages](../docs/security/REVIEW-2026-10-13-pages.md): P-L5 (proxy-dependent `Secure` flag and origin check, verify on the chosen host, Q-003), P-L6 (response security headers), rate limiting for cart-creating GET routes (needs Q-003). P-L7 (search terms in cache keys) goes in the privacy notes |
| P6-07 | Account: sign-in, order history, order details | 6 | shopify-hydrogen-developer | V-08, Q-018 | TODO | Med | Carry-over P-L8: scaffold account routes return `error.message` to the browser (`account.addresses.tsx`, `account.profile.tsx`); replace with fixed messages |

## Placeholders and mocks to retire

Tracked so nothing mock ships. The scaffold runs on **mock.shop** (`MockShopNotice` component, mock environment values); retired in P3A-01 when the dev store is connected. Every other mock added gets a row with the task that removes it.

| Mock or placeholder | Where | Retired by |
|---|---|---|
| Fixture quiz configuration, fixture stores and the product pool for compare and quiz results | `storefront/app/lib/pages/data-source.ts` (one seam; routes do not read fixtures directly) | P3A-01 (dev store), P3A-07 (stores import), P6-01 live loader; CLR-012 and CLR-015 supply the real content |
| Catalog fixtures for tests and fixture pages | `storefront/app/lib/catalog/fixtures.ts` | Test-only once P3A-01 connects the dev store |
| Home hero copy and promotional bar placeholders (`TODO(P3B-13)`); homepage section types not yet defined | `storefront/app/routes/_index.tsx`, `storefront/app/components/layout/PageLayout.tsx`, `scripts/shopify/definitions.json` | P3B-13 |
| Extend local mock | `scripts/mocks/extend-mock.mjs` behind the feature flag (ADR-0009) | Go-live gated on Extend's written answers (P5A-12) |
| Offer rules from server-only `OFFER_CONFIG_JSON`; Extend seam returning empty inputs to the cart gate | cart and `/checkout-steps` gate code in `storefront/app/lib/` and routes (DEC-030) | P4-12 (metaobject rules); P5A-06/07 (real Extend inputs) |
| Placeholder offer, comfort-guarantee and gift/add-on picker wording and UI; header reassurance strip and footer About links that state a comfort and price guarantee the client has not provided | cart offer components, `PageLayout.tsx` and footer | Client approval of wording (CLR-010, CLR-011); the strip and links need a layout owner and decision under REQ-CNT-001 (invented claim, remove or replace) |

## Change-request candidates (not in scope; need written client approval)

| ID | Candidate | Source | Note |
|---|---|---|---|
| CR-01 | Static design mockups or Figma design work | EXC-09 | Only if the client wants designs before build |
| CR-02 | Online booking of delivery time windows | EXC-04 | |
| CR-03 | Automated email and SMS flows | EXC-03 | Signup forms are in scope |
| CR-04 | Import of existing customer reviews | EXC-05 | |
| CR-05 | Shopify Plus upgrade or an App-Store-reviewed app of our own, for in-checkout enforcement | SD-01, ADR-0006 | Client cost decision, not ours |
| CR-06 | Copywriting beyond product copy (content pages, blog) | EXC-10 | |
| CR-07 | Ongoing maintenance and hosting upkeep after handover | EXC-13 | Mandatory conversation under Option B (SOW §3) |
| CR-08 | Replace in-checkout haul-away Function with layered enforcement (SD-01) | SOW §5 | Awaiting client acknowledgement |
| CR-09 | Post-purchase and thank-you offers through a client-paid App Store app, or drop (SD-02, SD-03) | SOW §5 | Awaiting client choice |
| CR-10 | Local delivery wallet-button limitation (SD-04) | SOW §7 | Awaiting client acknowledgement |
| CR-11 | Guest order tracking limited to 60 days (SD-05) | SOW §4 | Awaiting client acknowledgement |
| CR-12 | Single delivery zone (SD-07); extra zones later | SOW §7 | Owner chose one zone; client acknowledgement |
| CR-13 | App Store quantity-limit app as an extra haul-away layer (client-paid) | SD-01 | Optional |
| CR-14 | Financing messages hidden until provider details exist (SD-11) | SOW §5, §7 | Awaiting client acknowledgement |
