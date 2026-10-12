# Phase 8: End-to-end acceptance testing, UAT and defect resolution

## Objective

Prove the whole shopping journey works as the SOW describes, let the client accept it, and reach "zero open blockers" (SOW §11). **Business outcome:** go-live is a decision backed by evidence, not hope.

## Scope

In: browser and device matrix, full regression, a test order for every delivery method, add-on and payment type (then cancel and refund), UAT using the shared issue list and the SOW's grading, defect resolution, final accessibility and security re-checks, asset provenance check, go-live readiness decision.
Out: new features (change requests only), production launch itself (Phase 9).

## Prerequisites

Phases 2 to 7 gates passed; Q-012 matrix approved (NFR-009); all client content and rules loaded; payment methods activated in a test mode (CLR-007); Extend sandbox approved or production-approved per Phase 5A.

## Requirement IDs

REQ-ACPT-001, REQ-ACPT-002, REQ-ACPT-003, NFR-007, NFR-009

## Architecture and design decisions

- The e2e suite is the executable acceptance contract: each SOW section 4 to 8 deliverable maps to specs through [TRACEABILITY](../../docs/requirements/TRACEABILITY.md).
- Test orders run in a test or development environment first. A **live-store test order requires explicit written authorisation** from the client, a refund plan and a named observer.
- Feedback is collected as one consolidated round per page type in a single shared issue list (SOW §11); grading uses the SOW table (Blocker, Major, Minor).

## Tasks

| ID | Task | Owner | Depends on | Output and expected files |
|---|---|---|---|---|
| P8-01 | Agree the supported browser and device matrix and encode it as Playwright projects plus a manual device list | qa-engineer | Q-012 | `docs/testing/BROWSER_MATRIX.md`, Playwright config |
| P8-02 | Full regression: all e2e specs on the matrix, with traces and screenshots for failures | qa-engineer | P8-01 | evidence in `progress/TEST_RESULTS.md` |
| P8-03 | Test-order matrix: each delivery method times each add-on type times each activated payment type (reduced by a documented pairwise plan); cancel and refund each | qa-engineer | P5B-12 | evidence table with order IDs, Extend and Shopify records |
| P8-04 | UAT preparation: shared issue list with grading, client walkthrough scripts per page type, access to staging | project-manager | none | `plans/UAT_ISSUES.md` (created at this phase) |
| P8-05 | UAT rounds: one consolidated feedback round per page type; triage and grade | project-manager | P8-04 | graded issue list |
| P8-06 | Defect resolution: fix Blockers, fix or defer Majors in writing, schedule Minors; retest | shopify-hydrogen-developer | P8-05 | closed issues, regression evidence |
| P8-07 | Asset and copy provenance review against the reference site and client-supplied rights (NFR-007, ASM-04) | code-reviewer | none | `docs/handover/ASSET_PROVENANCE.md` |
| P8-08 | Final accessibility and security re-check on the release candidate | security-engineer | P8-06 | updated reviews |
| P8-09 | Go-live readiness review using the deployment-readiness skill; record go or no-go | project-manager | P8-02 to P8-08 | decision in `progress/DECISIONS.md` |

## Dependencies and blockers

UAT cannot complete while any CLR content item is outstanding. Blocked requirements from earlier phases (post-purchase, in-checkout haul-away limit, Extend approval) must each be resolved, delivered or formally deferred with the client's written agreement.

## Security considerations

Test data uses synthetic customers; no real payment instruments except the payment provider's documented test credentials; refunds are verified; staging is not indexed (robots and auth); no production secrets in test runs. Any live test order is authorised, observed and refunded (T-15).

## Testing

This phase is testing. Exit evidence: regression pass on the full matrix, test-order evidence per combination, defect log with zero open Blockers, signed deferrals for any open Majors, accessibility and security re-checks without new High findings.

## Acceptance criteria

REQ-ACPT-001 to REQ-ACPT-003, NFR-007 and NFR-009 criteria met; the client signs acceptance against SOW sections 4 to 8.

## Definition of done

Gates G1 to G8 ([MASTER_PLAN](../MASTER_PLAN.md#phase-gates)) plus: client acceptance recorded; defect log archived; go-live readiness decision recorded.

## Review and sign-off

`qa-engineer` signs the regression and test-order evidence; `code-reviewer` signs the release candidate diff since the last review; `security-engineer` signs the final check; the client's decision-maker signs acceptance.

## Rollback and recovery

No production changes. If the release candidate fails readiness, freeze, fix on a branch, and rerun the affected evidence; do not waive tests.
