---
name: code-review-storefront
description: "Independent review checklist for storefront changes: acceptance criteria and scope, correctness and edge cases, type safety, security, accessibility, performance, maintainability and test quality, with a fixed report format. Use for gate G4, before merging significant changes, and for release candidates. Named to avoid the built-in code-review command; the code-reviewer agent preloads it."
---

# Storefront code review

## When to use

After any significant change, before a phase gate (G4), and on a release candidate. The reviewer must not be the author. The role is described in `.claude/agents/code-reviewer.md`; this is the checklist.

## Steps

1. **Establish scope.** Identify the commit range or files, the task ID, the requirement IDs and their acceptance criteria. Read the diff completely, then the callers and tests it touches.
2. **Traceability and scope.** Does every change trace to a requirement or an approved decision? Anything matching an exclusion (EXC-01 to EXC-13) or beyond the task? Is anything promised that is Blocked or unverified?
3. **Correctness.** Walk each acceptance criterion through the code. Check boundaries, empty and error states, concurrency (double submit, stale state), pagination and cursors, size changes, quantity limits, rounding and currency, and what happens when Shopify or a provider returns errors, warnings or nulls.
4. **Money and eligibility.** Prices, discounts, limits and eligibility come from Shopify data on the server; no client-trusted values; offers and linked lines handle tampering, removal and quantity changes (T-01, T-02, T-06).
5. **Types and structure.** No `any`, unsafe casts or non-null assertions without justification; discriminated unions for states; pure logic separated from framework code; no circular imports; names that say what things are.
6. **Security.** Secrets only server-side; inputs validated at the boundary; content sanitised; redirects allow-listed; logs free of personal data; webhook verification; new dependencies justified (`.claude/rules/security.md`).
7. **Accessibility and UI.** Semantic elements, labels, focus management, keyboard path, states, tokens only, responsive behaviour (`.claude/rules/ui-implementation.md`).
8. **Performance.** Client bundle impact, lazy loading, image sizing and layout shift, cache strategy and key, waterfalls in loaders.
9. **Tests.** Do they fail if the code is wrong? Are negative and hostile cases covered? Any skipped, weakened or flaky tests? Traceability row updated? Run lint, type check and tests to confirm claims.
10. **Documentation.** Docs, ADRs, requirement status and backlog updated; no TODO without a task ID; no secrets or personal data in docs or fixtures.
11. **Report** in this format: scope (commit or files, what you ran); findings, each `[Blocker|Major|Minor|Nit] path:line, problem, failure scenario, suggested fix`; checks performed; verdict `CHANGES REQUESTED` or `APPROVED WITH NOTES`.

## Outputs

A review report returned to the orchestrator (who records it in the phase evidence) with findings ranked and evidence for every check claimed.

## Validation

You ran or read what you cite; every finding has a concrete failure scenario; an approval lists the checks performed; you did not edit the code under review; Blockers are not downgraded to pass a gate.
