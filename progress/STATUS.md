# Project status

Updated 2026-10-14 (after the build rounds of 2026-10-13 and 2026-10-14: review fixes, quiz, compare and store pages, the catalog data layer and the home, collection, product, search and cart pages, the offers wiring, then Extend webhook, offers route and coverage seam, delivery ZIP and haul-away steps, brand pages, homepage sections and the search combobox; local commits on branch `feat/foundation-libs-and-shell`, latest `d068db6`).

## Completion by phase (2026-10-14)

**Verified completion is zero requirements.** A requirement is `PASSING`, and a task `DONE`, only with dev-store evidence (B-13, B-02); nothing built so far has run against a real Shopify store, a real webhook delivery or Extend's demo host. Of 104 requirements, 58 have code under way (`IN_PROGRESS` in TRACEABILITY) and 46 are `NOT_STARTED`; 0 are `PASSING`. Of 146 phase-plan tasks, 3 are `DONE` (Phase 0 and 1 environment tasks), 40 `IN_REVIEW` and 12 `IN_PROGRESS`.

Rough "built, unverified" share: about 29% of all tasks (43 of 146, `DONE` plus `IN_REVIEW`) are built and waiting on review or a dev store, about 38% (55 of 146) if partly built `IN_PROGRESS` tasks are counted. For the feature phases 2 to 6 including 5A and 5B (93 tasks) the figures are 31% (29 of 93, all `IN_REVIEW`) and 43% (40 of 93) with partial work. Treat these as a rough guide: tasks differ greatly in size, and `IN_REVIEW` research tasks in Phase 0 count the same as a page. Task counts come from the phase plans (`plans/phases/*.md`) against `plans/BACKLOG.md`, which is the only place status lives.

| Phase | Tasks | DONE | IN_REVIEW | IN_PROGRESS | BLOCKED | TODO | Not yet in backlog | State |
|---|---|---|---|---|---|---|---|---|
| P0 Discovery and feasibility | 11 | 1 | 5 | 1 | 3 | 1 | 0 | Research and records done; dev store, Extend answers and the client pack outstanding |
| P1 Foundation and CI | 13 | 2 | 6 | 0 | 3 | 2 | 0 | Scaffold, tests and CI workflow built; staging, ADR-0008 migration and the gate blocked |
| P2 Design system and shell | 10 | 0 | 1 | 0 | 0 | 0 | 9 | Tokens, components and shell built; most tasks not tracked yet |
| P3A Shopify connectivity and catalog data | 12 | 0 | 4 | 0 | 0 | 1 | 7 | Importer, validator and definitions built on fakes; no dev store, no live run |
| P3B Catalog experience | 16 | 0 | 8 | 4 | 0 | 2 | 2 | Most pages built on mock.shop and fixtures; reviews, pickup, brand links open |
| P4 Cart and pre-checkout offers | 14 | 0 | 4 | 4 | 0 | 1 | 5 | Cart, engine and gate built; offer pickers are placeholders |
| P5A Extend protection | 14 | 0 | 4 | 1 | 0 | 0 | 9 | Mock, offers, webhook, reconcile and cart seam built; no PDP slot or step; mock only |
| P5B Delivery and checkout | 13 | 0 | 2 | 1 | 0 | 1 | 9 | Eligibility, ZIP, PDP promise and steps built; detective check P5B-05 and all checkout configuration open |
| P6 Quiz, compare, stores, account, content | 14 | 0 | 6 | 1 | 0 | 3 | 4 | Quiz, compare and stores built on fixtures; account and content not built |
| P7 Analytics, SEO, a11y, performance, security | 9 | 0 | 0 | 0 | 0 | 1 | 8 | Not started (hardening items recorded as carry-overs) |
| P8 Acceptance and UAT | 9 | 0 | 0 | 0 | 0 | 0 | 9 | Not started |
| P9 Launch and handover | 11 | 0 | 0 | 0 | 0 | 0 | 11 | Not started |
| **Total** | **146** | **3** | **40** | **12** | **6** | **12** | **73** | No phase gate passed |

## Build rounds of 2026-10-14

Commits `1173d79` (Extend and delivery), `6f34eaf` (storefront pages), `17e0f0e` (delivery fixes) and `d068db6` (Extend and review fixes). Local only; pushes remain owner-only.

- **Built, not verified on a real store or Extend host:**
  - *Extend (mock only, behind `PUBLIC_EXTEND_ENABLED`):* `/webhooks/shopify` with HMAC on raw bytes, a 6-hour freshness window, a per-order coalescer and background sync through `waitUntil` only when `EXTEND_ORDER_SYNC=self`; `/api/extend/offers`; the coverage seam `loadExtendCartInputs` wired into `offers-runtime/server.ts` `prepareRuntime`, so the cart gate can correct orphan, oversized or wrong-price coverage; `scripts/extend/reconcile.mjs` (dry run by default). P5A-04, P5A-06 (in progress), P5A-08, P5A-14.
  - *Delivery:* signed HttpOnly `delivery_zip` cookie, `/delivery` route, check-delivery control on the PDP and cart, server-side ZIP in the header, PDP promise limited to in-zone yes/no, delivery-choice and haul-away steps at `/checkout-steps`. P3B-11, P5B-03 (in progress), P5B-04.
  - *Pages (6f34eaf):* ARIA combobox search (P3B-07), header my-store (P3B-10, pickup still open), admin-ordered homepage sections with 8 types and fallbacks (P3B-13; signup renders nothing until P7-02), brand pages `/brands` and `/brands/:handle` on fixtures with `noindex` (P3B-06), collection promo tiles (P3B-05); header and footer guarantee claims hidden through `awaitingContent` until REQ-CNT-001 content (B-15).
- **Fixes (17e0f0e, d068db6):** separate `DELIVERY_COOKIE_SECRET` (32 characters minimum; `SESSION_SECRET` under 32 refused in production only); capped form reads and 32 KiB cart action bodies; pickup removes haul-away lines; decline refused while a service line exists or the step does not apply; shoppers with no ZIP are not asked at the gate; coverage price checked against the parent quote (`coverage-price-mismatch`); quotes per price band; a catalog read failure with the flag on pauses checkout; coverage recognised by plan name even with the flag off; webhook order id from the payload shape, a missing `X-Shopify-Triggered-At` treated as absent, a foreign shop domain ignored; offers route `Sec-Fetch-Site` guard and a 60 distinct variants per minute cap; `reconcile --resend --live` to the demo host needs an explicit flag; `parseExtendConfig` requires an explicit production boolean. Decisions: DEC-032 to DEC-035.
- **Local checks:** orchestrator-run after d068db6: typecheck, lint and Prettier clean; Vitest 102 files and 3126 tests pass; `node --test` over scripts 218 pass; build OK; framework validator OK. Agent-reported e2e: layout, search, home, brands and catalog 147 pass, 31 skipped, 0 failed; `delivery.spec` 28 pass, 2 skipped (desktop 10 of 10 after the final fixes, mobile not re-run). Details: [TEST_RESULTS](TEST_RESULTS.md) V-E17 to V-E26.
- **Independent reviews:** code review of 1173d79 CHANGES REQUESTED, three Majors, fixed in d068db6. Security review [REVIEW-2026-10-14-extend-delivery](../docs/security/REVIEW-2026-10-14-extend-delivery.md): PASS WITH CONDITIONS, no High. The fixes in d068db6 and the commits 6f34eaf and 17e0f0e have no independent review yet.
- **Open security items:** E-M2 (offers memo key includes quantity; real rate limiting needs Q-003, B-19); E-M3 (haul-away uses a shopper-typed ZIP; needs P5B-05, a Shopify checkout zone restriction and the owner's written acceptance at the 5B gate, B-17); O-M3 (owner acceptance of the ADR-0006 detective-only limit, B-18); E-L8 (a separate `read_orders`-only Admin token for the webhook read); E-L9 smaller items; H-1 / ADR-0008 (B-12).
- **Known gaps:** no browser action adds the Extend coverage line (P5A-05 PDP slot, P5A-07 step); P5B-05 detective ZIP check not built; the cart drawer's `/cart` fetch is not refreshed after a ZIP change; haul-away and delivery-choice steps tested only against fakes (mock.shop cannot answer `nodes()`); promo bar text still placeholder; brand pages not in the sitemap and the PDP brand section not linked; `SHOPIFY_DATA_MODEL.md` and `scripts/shopify/README.md` lack `link_label` and the section types; `SearchResultsPredictive.tsx` is unused template code.
- **Production must set:** `DELIVERY_COOKIE_SECRET` (32 or more characters) and `PUBLIC_SITE_URL`; `OFFER_CONFIG_JSON` and `OFFERS_ENABLED`; a separate `read_orders`-only Admin token for the webhook read; the webhook subscription created on the app (V-20, IR-04, IR-11).

## Build round of 2026-10-13

Commits `392f52f` (review fixes and the security review record), `8c533e2` (quiz, compare, store locator on fixture data) and `46e64a2` (catalog data layer, home, collection, product, search, cart pages).

- **Built, not verified on a real store:** REQ-HOME-001, REQ-COL-001/002/004, REQ-SRCH-001/002, REQ-PDP-001/002 (REQ-PDP-004 in part), REQ-CART-001, REQ-CHK-001 (plain hand-off), REQ-QZ-001 to 003, 005 (device only), 006, 007, REQ-CMP-001, REQ-LOC-001 and REQ-LOC-003 (cookie only). Tasks are `IN_REVIEW` or `IN_PROGRESS` in the backlog; none is `DONE`. Independent code and security reviews of 8c533e2 and 46e64a2 are running.
- **Local checks (agents' report, project manager did not re-run):** typecheck, lint, format:check clean; Vitest 60 files and 2470 tests pass; `node --test` over scripts 205 pass; build OK; e2e 246 pass, 31 skipped, 1 fail (`quiz.spec` full run, a console CSP telemetry error, being fixed). Details: [TEST_RESULTS](TEST_RESULTS.md) V-E1 to V-E8.
- **Not verified at all:** anything against a dev store (filters V-04, metafields V-05, nested cart lines V-02, cart total equals checkout total) and Lighthouse (B-13, B-02).
- **Not built at that date** (collection promo tiles, brand pages, the homepage section types, the delivery promise, header "my store", the ARIA combobox, the Extend reconcile script and webhook route were built on 2026-10-14: see the section above): product page slots for reviews (P3B-12), pickup (P3B-10), add-ons (P4-03) and Extend (P5A-05), a compare link in the navigation, quiz account sync. Home hero copy and the promo bar text are still placeholders.
- **Decisions for the owner or client:** acceptance of ADR-0008, a launch blocker (B-12).
- **Deferred review items (DEC-027):** M-4 shipping ZIP check in the 5B detective report (still open: P5B-05, B-17); L-1 webhook replay debounce (applied in the webhook route, 1173d79); shared guest-lookup limiter (P6-14, R-27, needs Q-003); quiz scoring as raw JSON (P6-13); `store.time_zone` (P3B-16).

## Build round 2 of 2026-10-13 (commit `aa1a23e`)

Offers engine wired into the cart, plus fixes from the page review ([REVIEW-2026-10-13-pages](../docs/security/REVIEW-2026-10-13-pages.md): no new High).

- **Built, not verified on a real store:** every cart mutation and the new `/checkout-steps` gate re-read the cart from Shopify, then evaluate, repair and re-evaluate (max 3 passes); uncorrectable violations block the storefront path (our cart, drawer and `/checkout-steps` gate); direct Storefront API carts are detective only (ADR-0006); roles never come from the browser; rules come from server-only `OFFER_CONFIG_JSON` until metaobject rules exist (P4-12). Size swap on cart lines (P4-02), free-delivery progress (P4-07), comfort-guarantee step through `?step=` (P4-09, P4-11; only that step). Cart cookie HttpOnly, SameSite=Lax, 10 days, Secure off localhost; `private, no-store` on cart routes; line updates drop attributes; permalink `/cart/:lines` redirects to `/checkout-steps`. Page fixes: search filtered zero-results keeps reset; price reads cached 60s/300s (DEC-024); fixture pages `noindex`; `PUBLIC_SITE_URL` canonical origin; discount links merge codes; Add-to-compare control; e2e no longer skips on store data. Decisions: DEC-028 to DEC-031.
- **Local checks (orchestrator; project manager did not re-run):** typecheck, lint, format:check clean; Vitest 71 files and 2587 tests pass; `node --test` 205 pass; build OK; framework validator OK before this record update. Agent-reported e2e: cart, quiz and shell 110 pass, 31 skipped, 1 fail then fixed; page specs 116 pass. Details: [TEST_RESULTS](TEST_RESULTS.md) V-E9 to V-E16.
- **Cannot be verified without a dev store (B-13):** nested lines (V-02); `cartLinesUpdate` with a new `merchandiseId` (V-16: child lines kept? duplicate lines merged?); `cartAttributesUpdate` replace versus merge; cart total equals checkout total; offers UI live (mock.shop returns empty for `node` and `nodes`).
- **Gaps at that date** (the delivery ZIP store and haul-away step landed and the Extend seam was wired on 2026-10-14, so haul-away no longer fails closed for shoppers with a saved ZIP; no browser action adds a coverage line yet): a GET to `/cart` or `/checkout-steps` can repair (write) the cart (DEC-029); offers wording is placeholder for client approval; gift, add-on and bundle pickers are placeholders (P4-04 to P4-06); `/compare` resolves fixture handles only (DEC-023); the Hydrogen mutation cart is minimal so each pass costs an extra read. The header reassurance strip and footer About links showed a comfort and price guarantee the client has not supplied; they are hidden since 6f34eaf until REQ-CNT-001 content exists.
- **Security:** P-M1 and P-L1 to P-L4 addressed, P-M2 addressed by the wiring; re-verification by the running security review of `aa1a23e` is pending. Deferred: P-L5 and P-L6 headers (P7-07), P-L7 privacy notes, P-L8 account routes (P6-07); rate limiting needs the hosting answer (Q-003).

## Summary

**Phase 0 closing, Phase 1 started; Phase 3B, 4, 5A, 5B and 6 work begun on fixtures, mocks and mock.shop.** Node 22 is installed (fnm), the Hydrogen storefront is scaffolded in `storefront/` on mock.shop and its lint, type check and build pass. The owner's answers are recorded: SOW final, **Shopify Basic**, everything pre-checkout, single delivery zone, Extend built regardless of the client's account, design follows the reference site. The Basic plan forces six SOW changes, listed in [SOW_DEVIATIONS](../docs/requirements/SOW_DEVIATIONS.md) with a client-facing pack ready to send. One engineering risk is open: the scaffold's react-router has known advisories (ADR-0008).

## What exists

| Area | State |
|---|---|
| Requirements | 104 requirements (91 functional, 13 non-functional); statuses revised 2026-10-12; 18 client responsibilities, 13 exclusions, 10 assumptions |
| Open questions | Q-001 to Q-019: answered or decided where the owner gave direction; remaining client data is in the pack |
| Basic-plan analysis | [BASIC_PLAN_WORKAROUNDS](../docs/research/BASIC_PLAN_WORKAROUNDS.md) (16 workarounds), [SOW_DEVIATIONS](../docs/requirements/SOW_DEVIATIONS.md) (SD-01 to SD-10), [CLIENT_QUESTION_PACK](../docs/requirements/CLIENT_QUESTION_PACK.md), ADR-0006 to ADR-0009 |
| Plans | Master plan, roadmap, 12 phase plans (146 tasks), backlog, risk register (26 risks), acceptance criteria |
| Claude Code framework | 10 agents, 15 skills, 6 rules, project settings; validator `scripts/validate-framework.mjs` now also checks the toolchain |
| Docs | Architecture, data model, 9 ADRs, feasibility file (41 verified facts F-01 to F-41, 4 source discrepancies, 25 open verifications), integration contracts, Extend contract, readiness checklist, threat model, test strategy, deployment, handover, reference-site patterns |
| Code | `storefront/`: Hydrogen 2026.4.7, react-router 7.16.0, React 18, Vite 8, Tailwind 4, TypeScript 5.9. Library layers (Extend with mock, offers, delivery, quiz, stores, catalog), design shell, and the home (admin-ordered sections), collection (with promo tiles), brand, product, search (ARIA combobox), cart, quiz, compare and store pages on mock.shop and fixtures. Offers are wired into the cart and the `/checkout-steps` gate (comfort-guarantee, delivery-choice and haul-away steps); the Extend webhook route, offers route, coverage seam and reconcile script exist behind `PUBLIC_EXTEND_ENABLED` against the mock only; the delivery ZIP is a signed server-side cookie. No page or route has run against a dev store, a real webhook or Extend's demo host. Not wired: the protection slot and step (P5A-05, P5A-07), the detective ZIP check (P5B-05) |
| Repository | git, branch `feat/foundation-libs-and-shell` with local commits (latest `d068db6`), working tree clean when these records were updated. Local commits are authorised (DEC-022); pushes are owner-only |

## Environment (verified 2026-10-12)

| Item | Value |
|---|---|
| Node via fnm | v22.23.3, npm 10.9.9 (fnm 1.39.0). Git Bash loads it from `~/.bashrc`. PowerShell still resolves system Node 25.8.2 until fnm is added to its profile |
| Not installed | Shopify CLI (used through `npx shopify` inside `storefront/`), GitHub CLI |
| Claude Code | extension 2.1.296 (bundled `claude.exe`) |

## MCP servers

| Server | Configured | Connected |
|---|---|---|
| Figma | `.mcp.json` | Connected and authenticated in a headless run (read-only policy; View seat, 20 calls per month). Not needed now: no Figma file expected |
| Playwright (`@playwright/mcp@0.0.83 --isolated`) | `.mcp.json` | Not connected in Claude Code yet (approval pending); server itself works over stdio |

## Next actions (in order)

1. **Owner:** review and send [CLIENT_QUESTION_PACK](../docs/requirements/CLIENT_QUESTION_PACK.md); create or share a Shopify Partner account so we can make a development store (B-02).
2. **Owner:** approve the project MCP servers with `/mcp` (B-04); accept or reject ADR-0008 for development (B-12); listing price freshness is decided (B-14 cleared, DEC-024).
3. **Agents (unblocked, in order):** independent review of 6f34eaf, 17e0f0e and d068db6 and re-verification of the security fixes (E-M1, E-L1 to E-L7) and of aa1a23e; **P5B-05** detective shipping-ZIP check (High); P5A-05 and P5A-07 so a coverage line can be added from the browser; P4-04 to P4-06 real offer pickers; cart drawer refresh after a ZIP change; brand sitemap entry and PDP brand link; documentation of `link_label` and the section types. **Owner:** accept or decline B-17 (haul-away ZIP residual, at the 5B gate) and B-18 (ADR-0006 detective-only limit) in writing, alongside ADR-0008 (B-12).
4. **Review:** independent review of P1-03, P0-06, P0-07, P0-08, P1-13 (still IN_REVIEW), plus the new rows in the backlog's Sprint 3 block.
5. **Orchestrator:** run `node scripts/validate-framework.mjs` after these record updates and record the result in TEST_RESULTS (V-E26).

## Gate status

Phase 0: not yet evaluated (blocked items remain). No phase gate has been passed.
