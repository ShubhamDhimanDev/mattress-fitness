---
name: playwright-e2e-testing
description: "Writes, runs and debugs repeatable Playwright Test end-to-end and accessibility specs for storefront journeys, and uses Playwright MCP for exploration and reproduction, with evidence recorded against requirement IDs. Use when a feature needs e2e coverage, a defect must be reproduced, browser behaviour must be checked, or test evidence is needed for a phase gate."
---

# Playwright end-to-end testing

## When to use

Verifying a requirement in a browser, adding or fixing a spec, reproducing a defect, or assembling evidence. Strategy and journey list: `docs/testing/TEST_STRATEGY.md` and `PLAYWRIGHT_WORKFLOW.md`. Rules: `.claude/rules/testing.md`.

## Steps

1. **Pick the requirement and criteria.** Read the row in `docs/requirements/REQUIREMENTS.md` and the planned spec name in `TRACEABILITY.md`.
2. **Explore first (optional).** With the Playwright MCP connected, load the page on the local dev server or staging (never production), take an accessibility snapshot and note the real roles, labels and states. Exploration is not a test.
3. **Write the spec** in `storefront/tests/e2e/<spec>.spec.ts`: one behaviour per test; synthetic unique data; role, label and text locators; web-first assertions with auto-waiting; no fixed sleeps; a describe title that contains the requirement ID.
4. **Cover the unhappy paths.** Invalid input, empty and error states, tampered or over-limit input for money paths, and failure injection: route third parties (Extend, reviews, maps, chat, analytics) to fail or time out and assert shopping and the checkout hand-off still work.
5. **Accessibility and console.** Run axe on each page state and assert zero serious or critical violations; assert no console errors and no request to a tracker before consent.
6. **Checkout safety.** Stop at Shopify's hosted checkout page and compare lines and totals with the cart. Never submit payment on a live store.
7. **Run.** `npm run e2e` in `storefront/` (all projects) or `npm run e2e -- <spec>`; on failure read the trace (`npx playwright show-trace`) before changing the test; fix the product or the test for the right reason.
8. **Record.** Append the run to `progress/TEST_RESULTS.md` (command, date, build, results, links to traces and screenshots); update the traceability row state only when the run passes.
9. **Defects.** Report with grade, requirement ID, steps, expected versus actual, evidence; keep the failing spec with the fix.

## Outputs

Specs and fixtures, a recorded run, updated traceability, defect reports, and screenshots or traces for the gate review.

## Validation

The suite passes in a clean run on the configured projects; the spec fails when the behaviour is broken (mutate the behaviour or reason about it to confirm the assertion bites); no skipped or weakened tests; no secrets or personal data in fixtures; results reported as they are, including failures.
