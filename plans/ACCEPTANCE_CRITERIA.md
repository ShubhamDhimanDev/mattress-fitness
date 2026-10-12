# Acceptance criteria

Three levels: per requirement (in [REQUIREMENTS](../docs/requirements/REQUIREMENTS.md), never duplicated here), per phase (gates G1 to G8 in [MASTER_PLAN](MASTER_PLAN.md#phase-gates), plus the "Acceptance criteria" of each phase plan), and for the project as a whole, which is what this file defines. The project-level criteria come from SOW §11.

## Project acceptance (SOW §11)

1. The client signs off against **SOW sections 4 to 8** (storefront, offers, Extend, checkout and delivery, catalog and content). The sign-off table is built from [TRACEABILITY](../docs/requirements/TRACEABILITY.md): every in-scope row is `PASSING` or has a written, signed deferral.
2. **Zero open Blockers** at go-live. Grading:

   | Grade | Meaning | Before go-live |
   |---|---|---|
   | Blocker | Stops a shopper from finding, buying or paying | Must be fixed |
   | Major | A listed deliverable does not work as described | Fixed, or deferred by written agreement |
   | Minor | Cosmetic or wording | May be fixed after go-live |

3. **Test orders:** before go-live, a test order is placed for every delivery method, add-on and payment type, then cancelled and refunded (REQ-ACPT-002). Evidence per order: order ID, delivery method, lines, payment type, Extend record where relevant, refund confirmation.
4. **Review cadence followed** (REQ-ACPT-001): staging link and a short change note each working day, a weekly demo, one consolidated feedback round per page type in a single shared issue list.
5. **Handover delivered** (REQ-HAND-001 to REQ-HAND-005): client-owned repository, import tool and completed product sheet, admin guide, training session, go-live support.
6. **Provider-dependent features** (Extend, Affirm, Shopify Payments, post-purchase) go live **once approved by those providers** (SOW §13). A feature that is not approved is reported as not live, with the reason; it is not faked or silently removed.

## Evidence rules

- A criterion is met only when evidence exists: a test run, a recorded manual check with date and tester, a screenshot, an order ID, or a document with an approval. "It works on my machine" is not evidence.
- Evidence is linked from [TEST_RESULTS](../progress/TEST_RESULTS.md); approvals from [DECISIONS](../progress/DECISIONS.md).
- A failing or skipped test is reported as failing or skipped. Waivers need written approval from the project owner (and the client where it affects scope).

## Definition of done for any task

1. Behaviour matches the linked requirement's acceptance criteria.
2. Format, lint, type check and relevant tests pass locally and in CI.
3. New behaviour has tests at the layers named in the traceability matrix.
4. Independent code review done; findings fixed or recorded.
5. Security and accessibility checks applied where the task touches them.
6. Docs, requirement status, traceability and backlog updated.
7. No secrets, customer data or production-only configuration added.

## Non-negotiables

Shopify stays the source of truth; Shopify's hosted checkout stays in place; no client-supplied price is trusted; no production change without recorded approval; no content copied from the reference site.
