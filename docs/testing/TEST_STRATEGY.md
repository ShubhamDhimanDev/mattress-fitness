# Test strategy

Purpose: make every requirement verifiable, repeatable and tied to evidence. The matrix of what is tested where is [TRACEABILITY](../requirements/TRACEABILITY.md); browser workflow is [PLAYWRIGHT_WORKFLOW](PLAYWRIGHT_WORKFLOW.md); results are recorded in [../../progress/TEST_RESULTS.md](../../progress/TEST_RESULTS.md).

## Principles

1. **Test the contract, not the framework.** Pure logic (offers, scoring, eligibility, filters, linking, snapshot building) gets fast unit tests; Shopify and Extend boundaries get integration tests with recorded or sandbox responses; user journeys get end-to-end tests.
2. **Money paths get negative tests.** Tampered carts, over-limit quantities, orphaned coverage, replayed webhooks, expired quotes.
3. **Tests are deterministic.** No dependence on live catalog contents: use fixtures and a development store with a known seed; no sleeps, use auto-waiting assertions.
4. **MCP exploration is not a test.** Playwright MCP is for investigation; anything worth keeping becomes a Playwright Test spec that runs in CI.
5. **Never test destructively against production.** Development stores and sandboxes only. A live-store test order needs written authorisation, a named observer and an immediate refund.
6. **Evidence or it did not happen.** A result without a run ID, trace, screenshot or order ID is not evidence.

## Layers and tools (ADR-0001; as set up on 2026-10-15)

Commands run in `storefront/` unless noted: `npm run format:check`, `lint`, `typecheck`, `test`, `build`, `e2e`; `npm run check` chains format check, lint, typecheck, test and build. Scripts tests run from the repository root: `node --test "scripts/**/*.test.mjs"`. CI (`.github/workflows/ci.yml`) mirrors these but has not yet run on a remote repository.

| Layer                 | Tool                                                                                                                                                                                             | Location                                                                     | Runs                                                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Static                | ESLint, Prettier, TypeScript                                                                                                                                                                     | `storefront/` (`npm run lint`, `format:check`, `typecheck`)                  | pre-merge and CI                                                                                                                                                       |
| Unit                  | Vitest                                                                                                                                                                                           | `storefront/app/**/*.test.ts(x)` colocated and `storefront/tests/unit/`      | every change, CI                                                                                                                                                       |
| Integration           | Vitest with fixtures and the local Extend mock (`scripts/mocks/extend-mock.mjs`); no live sandbox run yet                                                                                        | `storefront/tests/integration/extend/`                                       | CI (fixtures); live sandbox not run                                                                                                                                    |
| Tooling               | Node's built-in test runner                                                                                                                                                                      | `scripts/**/*.test.mjs`                                                      | CI job `framework`                                                                                                                                                     |
| End to end            | Playwright Test                                                                                                                                                                                  | `storefront/tests/e2e/*.spec.ts`                                             | CI on the dev server against mock stores; the production-build check `b20-production.spec` is run by hand against `shopify hydrogen preview` (see PLAYWRIGHT_WORKFLOW) |
| Accessibility         | axe via `@axe-core/playwright` inside e2e specs, plus manual keyboard and screen-reader passes                                                                                                   | same                                                                         | CI plus Phase 7 manual                                                                                                                                                 |
| Performance           | Lighthouse CI budgets on home, collection, product, cart                                                                                                                                         | **not set up yet** (P7-06; see `docs/testing/PERFORMANCE.md` when it exists) | CI where practical, Phase 7 audit                                                                                                                                      |
| Security              | dependency audit (report only in CI, ADR-0008), header and CSP checks (`security-headers.test.ts`, `seo-headers.spec`), log redaction and no-direct-console tests; **a tree scan for token-shaped strings runs in CI through the framework job (`validate-framework.mjs`); a history scan and a dedicated scanner are not in CI yet** | CI and Phase 7                                                               | CI plus review                                                                                                                                                         |
| Manual and acceptance | scripted walkthroughs, test orders, admin edits                                                                                                                                                  | evidence in progress files                                                   | Phase 8                                                                                                                                                                |

## What counts as evidence today

Every result so far comes from unit tests, fakes, the local Extend mock, fixtures, `mock.shop` and `bedding.mock.shop`. **No requirement is `PASSING`**: that needs a development store (B-13). Mock stores answer no `nodes(ids)` lookups, so offer success paths are unit-tested only. See [PLAYWRIGHT_WORKFLOW](PLAYWRIGHT_WORKFLOW.md) for what runs where and [DEV_DATA](../../storefront/DEV_DATA.md) for what needs the development store.

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
