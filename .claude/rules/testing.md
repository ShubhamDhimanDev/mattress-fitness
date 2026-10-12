---
paths:
  - "storefront/tests/**/*"
  - "**/*.test.{ts,tsx}"
  - "**/*.spec.ts"
---

# Testing rules

Strategy: [TEST_STRATEGY](../../docs/testing/TEST_STRATEGY.md). Playwright: [PLAYWRIGHT_WORKFLOW](../../docs/testing/PLAYWRIGHT_WORKFLOW.md). Coverage plan: [TRACEABILITY](../../docs/requirements/TRACEABILITY.md).

- Every test names the requirement it proves (ID in the `describe` title or a comment); update the traceability row when a test lands.
- Unit-test pure logic with table-driven cases: normal, boundary, invalid, and the **tampered or hostile** case for anything touching money, eligibility or limits.
- Integration tests use recorded fixtures or the development store; Extend tests use the sandbox only. Never run against production.
- E2E: web-first assertions and auto-waiting; no fixed sleeps. Prefer role, label and text locators; `data-testid` only when no accessible locator exists. One behaviour per test, independent, using synthetic uniquely named data.
- Stop at Shopify's hosted checkout page; never submit real payments. Test orders on a test environment are cancelled and refunded and recorded as evidence.
- Include accessibility (axe, zero serious or critical) and console-error checks in page specs. Failure-injection tests mock third parties at the network layer.
- A flaky test is fixed or quarantined with an owner and date; never retried until green and ignored. Never delete or weaken a test to make a phase pass.
- A failing test result is reported as failing, with output. Record runs in [TEST_RESULTS](../../progress/TEST_RESULTS.md).
- Keep fixtures free of real personal data and secrets.
