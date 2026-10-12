# Test strategy

Purpose: make every requirement verifiable, repeatable and tied to evidence. The matrix of what is tested where is [TRACEABILITY](../requirements/TRACEABILITY.md); browser workflow is [PLAYWRIGHT_WORKFLOW](PLAYWRIGHT_WORKFLOW.md); results are recorded in [../../progress/TEST_RESULTS.md](../../progress/TEST_RESULTS.md).

## Principles

1. **Test the contract, not the framework.** Pure logic (offers, scoring, eligibility, filters, linking, snapshot building) gets fast unit tests; Shopify and Extend boundaries get integration tests with recorded or sandbox responses; user journeys get end-to-end tests.
2. **Money paths get negative tests.** Tampered carts, over-limit quantities, orphaned coverage, replayed webhooks, expired quotes.
3. **Tests are deterministic.** No dependence on live catalog contents: use fixtures and a development store with a known seed; no sleeps, use auto-waiting assertions.
4. **MCP exploration is not a test.** Playwright MCP is for investigation; anything worth keeping becomes a Playwright Test spec that runs in CI.
5. **Never test destructively against production.** Development stores and sandboxes only. A live-store test order needs written authorisation, a named observer and an immediate refund.
6. **Evidence or it did not happen.** A result without a run ID, trace, screenshot or order ID is not evidence.

## Layers and tools (proposed in ADR-0001, set up in Phase 1)

| Layer | Tool | Location | Runs |
|---|---|---|---|
| Static | ESLint, Prettier, TypeScript | `storefront/` | pre-merge and CI |
| Unit | Vitest | colocated `*.test.ts` | every change, CI |
| Integration | Vitest with recorded fixtures or a development store; Extend sandbox for Phase 5A | `storefront/tests/integration/` | CI (fixtures); scheduled or manual (live sandbox) |
| End to end | Playwright Test | `storefront/tests/e2e/*.spec.ts` | CI on a built app against fixtures or the development store |
| Accessibility | axe via `@axe-core/playwright` inside e2e specs, plus manual keyboard and screen-reader passes | same | CI plus Phase 7 manual |
| Performance | Lighthouse CI budgets on home, collection, product, cart | `storefront/` config | CI where practical, Phase 7 audit |
| Security | dependency audit, secret scan, header and CSP checks, abuse tests | CI and Phase 7 | CI plus review |
| Manual and acceptance | scripted walkthroughs, test orders, admin edits | evidence in progress files | Phase 8 |

## Environments and data

Local dev server with the development store (or `mock.shop` in Phase 1 and 2); staging on our server with the development store; a Shopify test payment environment for test orders; Extend sandbox. Test customers are synthetic. Shopify's documented test payment credentials only.

## Browser and device coverage

Defined with the client in Phase 8 (Q-012, NFR-009). Proposal: Chromium desktop and mobile emulation, WebKit (Safari), Firefox; viewports 360, 768, 1280 and 1536 px; real-device manual pass on one iOS and one Android phone before acceptance.

## Journeys that must exist as e2e specs

Browse and filter; search; product size change and add to cart; cart quantity and removal; gift eligibility and removal; add-on offers; each pre-checkout step accept and decline; protection offer accept, decline, quantity change, removal; delivery eligibility by ZIP; haul-away limit; hand-off to checkout (stop at Shopify's page); quiz; compare; store selection; account sign-in and orders; guest tracking; content and blog; consent gating; failure of each third party (see playwright workflow).

## Defect handling

Defects use the SOW grades (Blocker, Major, Minor). Each has: ID, grade, requirement ID, steps, expected and actual result, evidence (trace, screenshot, console output), environment, status. Blockers stop the phase gate. A reproduction as a failing test is preferred before the fix.

## Entry and exit

A phase's tests are written alongside its tasks, not after. Exit requires gates G1 to G3 ([MASTER_PLAN](../../plans/MASTER_PLAN.md#phase-gates)): acceptance criteria met, automated tests passing, QA review done. Flaky tests are fixed or quarantined with an owner and a date, never ignored.
