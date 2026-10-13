# Project status

Updated 2026-10-13 (after the second, third and fourth build rounds: review fixes, quiz, compare and store pages, the catalog data layer and the home, collection, product, search and cart pages, then the offers wiring and page-review fixes; four local commits on branch `feat/foundation-libs-and-shell`).

## Build round of 2026-10-13

Commits `392f52f` (review fixes and the security review record), `8c533e2` (quiz, compare, store locator on fixture data) and `46e64a2` (catalog data layer, home, collection, product, search, cart pages).

- **Built, not verified on a real store:** REQ-HOME-001, REQ-COL-001/002/004, REQ-SRCH-001/002, REQ-PDP-001/002 (REQ-PDP-004 in part), REQ-CART-001, REQ-CHK-001 (plain hand-off), REQ-QZ-001 to 003, 005 (device only), 006, 007, REQ-CMP-001, REQ-LOC-001 and REQ-LOC-003 (cookie only). Tasks are `IN_REVIEW` or `IN_PROGRESS` in the backlog; none is `DONE`. Independent code and security reviews of 8c533e2 and 46e64a2 are running.
- **Local checks (agents' report, project manager did not re-run):** typecheck, lint, format:check clean; Vitest 60 files and 2470 tests pass; `node --test` over scripts 205 pass; build OK; e2e 246 pass, 31 skipped, 1 fail (`quiz.spec` full run, a console CSP telemetry error, being fixed). Details: [TEST_RESULTS](TEST_RESULTS.md) V-E1 to V-E8.
- **Not verified at all:** anything against a dev store (filters V-04, metafields V-05, nested cart lines V-02, cart total equals checkout total) and Lighthouse (B-13, B-02).
- **Not built:** collection promo tiles (REQ-COL-003), brand pages (REQ-COL-005, P3B-06), home hero copy (`TODO(P3B-13)`) and the homepage section types in definitions, product page slots (reviews P3B-12, pickup P3B-10, delivery promise P5B-03, add-ons P4-03, Extend P5A-05), header display of "my store" (P3B-10), a compare link in the navigation, quiz account sync, a true ARIA combobox for predictive search (needs `layout/HeaderSearch.tsx`), the Extend reconcile script (P5A-14) and the Extend webhook route (P5A-08).
- **Decisions for the owner or client:** acceptance of ADR-0008, a launch blocker (B-12).
- **Deferred review items (DEC-027):** M-4 shipping ZIP check in the 5B detective report, L-1 webhook replay debounce, shared guest-lookup limiter (P6-14, R-27, needs Q-003), quiz scoring as raw JSON (P6-13), `store.time_zone` (P3B-16).

## Build round 2 of 2026-10-13 (commit `aa1a23e`)

Offers engine wired into the cart, plus fixes from the page review ([REVIEW-2026-10-13-pages](../docs/security/REVIEW-2026-10-13-pages.md): no new High).

- **Built, not verified on a real store:** every cart mutation and the new `/checkout-steps` gate re-read the cart from Shopify, then evaluate, repair and re-evaluate (max 3 passes); uncorrectable violations block the storefront path (our cart, drawer and `/checkout-steps` gate); direct Storefront API carts are detective only (ADR-0006); roles never come from the browser; rules come from server-only `OFFER_CONFIG_JSON` until metaobject rules exist (P4-12). Size swap on cart lines (P4-02), free-delivery progress (P4-07), comfort-guarantee step through `?step=` (P4-09, P4-11; only that step). Cart cookie HttpOnly, SameSite=Lax, 10 days, Secure off localhost; `private, no-store` on cart routes; line updates drop attributes; permalink `/cart/:lines` redirects to `/checkout-steps`. Page fixes: search filtered zero-results keeps reset; price reads cached 60s/300s (DEC-024); fixture pages `noindex`; `PUBLIC_SITE_URL` canonical origin; discount links merge codes; Add-to-compare control; e2e no longer skips on store data. Decisions: DEC-028 to DEC-031.
- **Local checks (orchestrator; project manager did not re-run):** typecheck, lint, format:check clean; Vitest 71 files and 2587 tests pass; `node --test` 205 pass; build OK; framework validator OK before this record update. Agent-reported e2e: cart, quiz and shell 110 pass, 31 skipped, 1 fail then fixed; page specs 116 pass. Details: [TEST_RESULTS](TEST_RESULTS.md) V-E9 to V-E16.
- **Cannot be verified without a dev store (B-13):** nested lines (V-02); `cartLinesUpdate` with a new `merchandiseId` (V-16: child lines kept? duplicate lines merged?); `cartAttributesUpdate` replace versus merge; cart total equals checkout total; offers UI live (mock.shop returns empty for `node` and `nodes`).
- **Gaps:** the delivery ZIP has no server-side store, so haul-away fails closed (`zip-missing`) and any haul-away line blocks checkout until P3B-11 and P5B-04; the Extend seam returns empty inputs (P5A-06, P5A-07); a GET to `/cart` or `/checkout-steps` can repair (write) the cart (DEC-029); offers wording is placeholder for client approval; gift, add-on and bundle pickers are placeholders (P4-04 to P4-06); `/compare` resolves fixture handles only (DEC-023); the Hydrogen mutation cart is minimal so each pass costs an extra read. The header reassurance strip and footer About links still show a comfort and price guarantee the client has not supplied: needs a layout owner and a decision (REQ-CNT-001).
- **Security:** P-M1 and P-L1 to P-L4 addressed, P-M2 addressed by the wiring; re-verification by the running security review of `aa1a23e` is pending. Deferred: P-L5 and P-L6 headers (P7-07), P-L7 privacy notes, P-L8 account routes (P6-07); rate limiting needs the hosting answer (Q-003).

## Summary

**Phase 0 closing, Phase 1 started; Phase 3B, 4 and 6 page work begun on fixtures and mock.shop.** Node 22 is installed (fnm), the Hydrogen storefront is scaffolded in `storefront/` on mock.shop and its lint, type check and build pass. The owner's answers are recorded: SOW final, **Shopify Basic**, everything pre-checkout, single delivery zone, Extend built regardless of the client's account, design follows the reference site. The Basic plan forces six SOW changes, listed in [SOW_DEVIATIONS](../docs/requirements/SOW_DEVIATIONS.md) with a client-facing pack ready to send. One engineering risk is open: the scaffold's react-router has known advisories (ADR-0008).

## What exists

| Area | State |
|---|---|
| Requirements | 104 requirements (91 functional, 13 non-functional); statuses revised 2026-10-12; 18 client responsibilities, 13 exclusions, 10 assumptions |
| Open questions | Q-001 to Q-019: answered or decided where the owner gave direction; remaining client data is in the pack |
| Basic-plan analysis | [BASIC_PLAN_WORKAROUNDS](../docs/research/BASIC_PLAN_WORKAROUNDS.md) (16 workarounds), [SOW_DEVIATIONS](../docs/requirements/SOW_DEVIATIONS.md) (SD-01 to SD-10), [CLIENT_QUESTION_PACK](../docs/requirements/CLIENT_QUESTION_PACK.md), ADR-0006 to ADR-0009 |
| Plans | Master plan, roadmap, 12 phase plans (142 tasks), backlog, risk register (26 risks), acceptance criteria |
| Claude Code framework | 10 agents, 15 skills, 6 rules, project settings; validator `scripts/validate-framework.mjs` now also checks the toolchain |
| Docs | Architecture, data model, 9 ADRs, feasibility file (41 verified facts F-01 to F-41, 4 source discrepancies, 25 open verifications), integration contracts, Extend contract, readiness checklist, threat model, test strategy, deployment, handover, reference-site patterns |
| Code | `storefront/`: Hydrogen 2026.4.7, react-router 7.16.0, React 18, Vite 8, Tailwind 4, TypeScript 5.9. Library layers (Extend with mock, offers, delivery, quiz, stores, catalog), design shell, and as of 2026-10-13 the home, collection, product, search, cart, quiz, compare and store pages on mock.shop and fixtures. No page has run against a dev store. Offers are wired into the cart and the `/checkout-steps` gate (comfort step only); Extend and delivery are not wired (Extend seam returns empty inputs, delivery ZIP has no server-side store) |
| Repository | git, branch `feat/foundation-libs-and-shell` with local commits (latest `aa1a23e`), working tree clean when these records were updated. Local commits are authorised (DEC-022); pushes are owner-only |

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
3. **Agents (unblocked, in order):** finish the independent code and security reviews of `aa1a23e` and fix findings; then P3B-11 server-side delivery ZIP and P5B-04 haul-away step (haul-away blocks checkout until then); P4-04 to P4-06 real offer pickers; the unbuilt page items that need no dev store: P3B-05 promo tiles, P3B-06 brand pages, P3B-10 header "my store" (needs a layout file claim), the predictive search combobox (layout file claim), P3B-13 homepage section types and copy. **Owner or orchestrator:** decide the header reassurance strip and footer About links that show an unsupplied comfort and price guarantee (REQ-CNT-001, needs a layout owner).
4. **Review:** independent review of P1-03, P0-06, P0-07, P0-08, P1-13 (still IN_REVIEW), plus the new rows in the backlog's Sprint 3 block.
5. **Orchestrator:** run `node scripts/validate-framework.mjs` after these record updates and record the result in TEST_RESULTS (V-E16).

## Gate status

Phase 0: not yet evaluated (blocked items remain). No phase gate has been passed.
