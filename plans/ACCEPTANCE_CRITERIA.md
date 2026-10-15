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

### Where the project criteria stand (2026-10-15)

Nothing below is met yet, and no gate has been passed. The criteria themselves are unchanged; this table records what exists so the gap is visible. Everything built ran on mock.shop, fixtures, fakes or the local Extend mock (B-13).

| # | Criterion | Standing today | What closes it |
|---|---|---|---|
| 1 | Sign-off against SOW sections 4 to 8 | No row is `PASSING` against real data. Pages, cart, offers, pickers, Extend UI, delivery steps, SEO and headers are built and `IN_REVIEW` at most. Items changed by the Basic plan are **not deliverable as written** until the client acknowledges SD-01 to SD-05, SD-07 and SD-11 ([SOW_DEVIATIONS](../docs/requirements/SOW_DEVIATIONS.md); the pack has not been sent, B-08, B-11). A deviated item is signed off against its acknowledged wording, not the SOW's | Dev store (B-02), the client's written replies, then independent review and a dev-store verification record per row |
| 2 | Zero open Blockers at go-live | Open items that would grade as Blocker if left: the gift-not-free gate unverified (B-21, K-M1), ADR-0008 and react-router advisories (B-12, R-23), host rate limiting and production configuration (B-19), haul-away ZIP residual risk and the ADR-0006 limit without the owner's acceptance (B-17, B-18). The defect log lives in the single shared issue list (REQ-ACPT-001), not yet opened | Each item cleared or accepted in writing; defect log started at Phase 8 |
| 3 | Test order per delivery method, add-on and payment type, then cancelled and refunded | **Not possible yet:** no store, no payment activation (CLR-007), no Extend account. The detective check has never run on a real order. Offers and haul-away success paths are proved only against fakes | Dev or sandbox store, never a live order; evidence per order as listed in criterion 3 |
| 4 | Review cadence | No staging URL exists (B-07), so no daily note or weekly demo has been delivered to the client | Staging host, named decision-maker (Q-013) |
| 5 | Handover | Not started (Phase 9). Client-owned repository needs the GitHub organisation (Q-014); history must be scanned for secrets before transfer (REQ-HAND-001); the admin guide still lacks the `offer-only` tag step and the discount-title step (Q-020) | Phase 9 |
| 6 | Provider-dependent features | **Extend:** switched off by default; built on the mock; reported as **not live** until the client's approved account and Extend's written answers exist (REQ-EXT-004 is `Blocked`). **Post-purchase and thank-you offers (REQ-POST-001/002):** not built, App Store route or drop (Q-007). **Affirm and Shop Pay Installments:** slot hidden until the provider is active (SD-11). **Shopify Payments, PayPal:** inactive. None may be shown to the client as delivered | Provider approvals and activation (CLR-006, CLR-007) |

## Evidence rules

- A criterion is met only when evidence exists: a test run, a recorded manual check with date and tester, a screenshot, an order ID, or a document with an approval. "It works on my machine" is not evidence.
- Evidence is linked from [TEST_RESULTS](../progress/TEST_RESULTS.md); approvals from [DECISIONS](../progress/DECISIONS.md).
- A failing or skipped test is reported as failing or skipped. Waivers need written approval from the project owner (and the client where it affects scope).
- **Label the environment.** Evidence from mock.shop, fixtures, fakes or the Extend mock is recorded as such. It supports `IN_REVIEW` and never `DONE`; `DONE` needs an independent review and a development-store verification record (DEC-025). Test counts reported by an agent and not re-run by the orchestrator are marked "agent-reported".
- **Detective controls prove detection, not prevention.** Where a rule is enforced only by the detective check (direct Storefront API carts, ADR-0006), the evidence is a test that the check finds the violation after the order, and the criterion is met only with the owner's written acceptance of that limit (B-18) and the client's acknowledgement of SD-01.
- **Fail-closed behaviour counts when it is tested.** A missing rule value, unreadable coverage catalog or missing ZIP must pause checkout with an explanation (DEC-030, DEC-031, DEC-034); the evidence is a failing-first test, and a gate pass needs the same behaviour seen on a production build.
- **Gate checks the security reviews added:** response security headers on every response behind the real host, including redirects, 404 and 500 pages (P7-07); a two-cookie test showing no shared-cache leakage of the ZIP-driven header (R-29); the CSP report-only period reviewed before it is enforced; dependency audit with no unaccepted High (R-23).

## Definition of done for any task

1. Behaviour matches the linked requirement's acceptance criteria.
2. Format, lint, type check and relevant tests pass locally and in CI.
3. New behaviour has tests at the layers named in the traceability matrix.
4. Independent code review done; findings fixed or recorded.
5. Security and accessibility checks applied where the task touches them.
6. Docs, requirement status, traceability and backlog updated.
7. No secrets, customer data or production-only configuration added.
8. A task that depends on a platform fact not yet proved on a store (V-xx) stays `IN_REVIEW` at most and names the unverified item; it does not move to `DONE` on mock evidence.

## Non-negotiables

Shopify stays the source of truth; Shopify's hosted checkout stays in place; no client-supplied price is trusted (gift and bundle prices come only from Shopify discounts, DEC-046, DEC-047); no production change without recorded approval; no content copied from the reference site; no content the client has not supplied or approved is shown as fact (B-15); a deviated SOW item is not described as delivered until the client has acknowledged it.
