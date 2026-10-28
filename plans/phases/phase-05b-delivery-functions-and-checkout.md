# Phase 5B: Delivery eligibility, haul-away, checkout configuration and post-purchase options (Basic plan)

## Objective

Make delivery promises and haul-away rules true in the storefront and, as far as the Basic plan allows, at checkout; configure Shopify's hosted checkout (brand, delivery, payments, emails); and settle post-purchase options without building any Shopify Function or extension of our own ([ADR-0006](../../docs/decisions/ADR-0006-basic-plan-pre-checkout-logic.md)). (File name kept for stable links; the phase no longer builds Functions.) **Business outcome:** shoppers see accurate delivery options, and over-limit or mismatched haul-away is prevented before checkout and flagged after it.

## Scope

In: single delivery zone, eligibility module, product page delivery promise, haul-away step, layered haul-away enforcement with a detective Flow or webhook check, Local delivery configuration and parity check, checkout branding, delivery methods, payments, checkout features, customer emails, post-purchase options via an App Store app (client's choice), test orders on the dev store.
Out: custom checkout content (EXC-01, EXC-02), any Function, checkout UI extension or post-purchase extension of our own, delivery time-window booking (EXC-04), more than one delivery zone (SD-07).

## Prerequisites

Phase 4; Phase 3A delivery-zone data model; the ZIP list, fee and free threshold (CLR-009, Q-008); haul-away rules (CLR-010); payment activations (CLR-007); brand kit (G-2); V-06a to V-06e, V-17, V-18, V-19 verified on the dev store.

## Requirement IDs

REQ-DEL-001, REQ-DEL-002, REQ-PRE-003, REQ-PROMO-003, REQ-POST-001, REQ-POST-002, REQ-CHK-002, REQ-CHK-003, REQ-CHK-004, REQ-CHK-005, REQ-CHK-006

## Architecture and design decisions

- **One delivery zone, stored once** as a metaobject and mirrored by Shopify Local delivery postal codes; a parity script and CI test keep them equal ([ADR-0007](../../docs/decisions/ADR-0007-single-delivery-zone-local-delivery.md)). If the zone is whole states, a shipping rate replaces Local delivery.
- **Haul-away enforcement in layers** ([BASIC_PLAN_WORKAROUNDS](../../docs/research/BASIC_PLAN_WORKAROUNDS.md) item 1): UI cap, server cap in every action, revalidation before the redirect, then a detective control after the order (Shopify Flow on *Order created* if V-17 confirms the conditions, else the webhook receiver from Phase 5A). An App Store quantity-limit app is an optional extra layer chosen by the client (V-18).
- **Delivery choice step:** the pre-checkout flow asks "in-home delivery or store pickup", stores it as a cart attribute and offers haul-away only for in-home delivery inside the zone.
- **Post-purchase and thank-you offers** are an App Store app route (client installs and pays), configured by us if the client wants it; otherwise the requirements are dropped by change request (SD-02, SD-03).
- Checkout configuration is a checklist with before and after screenshots, because it is Shopify admin configuration, not code.

## Tasks

| ID | Task | Owner | Depends on | Output and expected files |
|---|---|---|---|---|
| P5B-01 | Delivery eligibility module for the single zone (ZIP to eligibility, fee, free-delivery status) with ZIP fixtures | integration-engineer | P3A-10, CLR-009 | `storefront/app/lib/delivery/*` |
| P5B-02 | Parity script and test between the metaobject zone list and Local delivery postal codes | integration-engineer | P5B-01, V-06c | `scripts/shopify/check-delivery-parity.mjs` |
| P5B-03 | Product page delivery promise for the saved ZIP | shopify-hydrogen-developer | P5B-01 | component and client-approved wording |
| P5B-04 | Pre-checkout delivery choice and haul-away step: eligibility, quantity cap, "Recycle and disposal service" line, server cap | shopify-hydrogen-developer | P5B-01, CLR-010 | `app/routes/checkout-steps.tsx` extension |
| P5B-05 | Detective control: Flow rule (or webhook check) that tags and notifies over-limit or mismatched haul-away orders; admin-guide note to keep the cap in sync | integration-engineer | V-17, P5B-04 | Flow screenshots and config notes, or `app/lib/orders/haul-away-check.ts` |
| P5B-06 | Checkout branding: logo, background, colours, fonts in the checkout and accounts editor | ui-ux-designer | G-2 | admin configuration checklist and screenshots |
| P5B-07 | Delivery methods: Local delivery zone with price and minimum-order rules, store pickup with ready-for-pickup email, parcel shipping rates | integration-engineer | P5B-01, REQ-LOC-002 | configuration checklist |
| P5B-08 | Payments: cards, Shop Pay, Apple Pay, Google Pay, PayPal, Affirm as activated by the client | integration-engineer | CLR-007 | configuration checklist |
| P5B-09 | Checkout features and tax verification: discount codes, marketing opt-in, express buttons, wallet behaviour for in-zone carts | integration-engineer | P5B-07 | verification notes and screenshots for SD-04 |
| P5B-10 | Customer email templates in brand: confirmation, shipping, pickup-ready, refund | technical-writer | G-2 | template changes and test sends |
| P5B-11 | **PARKED by the owner 2026-10-28 (DEC-139): not started, not in the Phase 5B gate until reinstated.** Post-purchase options: evaluate an App Store app on the dev store (V-19), present results, configure if chosen, or record the drop | integration-engineer | Q-007, V-19 | evaluation note, configuration or change request |
| P5B-12 | Test orders on the dev store for every delivery method and each activated payment option; cancel and refund each | qa-engineer | P5B-04 to P5B-10 | evidence in `progress/TEST_RESULTS.md` |
| P5B-13 | Phase gate review | project-manager | all | gate record |

## Dependencies and blockers

REQ-POST-001/002 and REQ-PROMO-003 are `Pending approval` until the client acknowledges SD-01 to SD-03. REQ-CHK-004 is Blocked by CLR-007. REQ-DEL-001/002 need the ZIP list and wording (Q-008).

## Security considerations

No app or Function token is created in this phase. Server caps must hold against direct cart API calls only as far as the architecture allows: the detective control and reconciliation are the backstop, and the residual risk is written in the admin guide (T-02). Test orders on live stores only with explicit written authorisation and always refunded.

## Testing

Unit: eligibility (boundaries, ZIP+4, invalid), haul-away caps, promise rules. Integration: parity between the metaobject list and Local delivery. E2E: eligible and ineligible ZIPs through the delivery choice and haul-away step to the checkout hand-off; direct-API over-limit cart on the dev store is flagged by the detective control. Manual: one test order per delivery method and payment option in a test environment.

## Acceptance criteria

REQ criteria met for all non-blocked items; the detective control demonstrably flags an over-limit order; SD-04 wallet behaviour documented with screenshots; post-purchase item is either configured with an App Store app or formally dropped.

## Definition of done

Gates G1 to G8 ([MASTER_PLAN](../MASTER_PLAN.md#phase-gates)) plus: checkout configuration checklist signed by the client; every test order cancelled and refunded; SD-01, SD-02, SD-03 and SD-04 acknowledged in writing.

## Review and sign-off

`security-engineer` reviews the enforcement layers and the detective control; `code-reviewer` reviews the eligibility code; `qa-engineer` signs test-order evidence; the client approves delivery wording, checkout appearance and the SD rows.

## Rollback and recovery

Checkout settings changes are recorded with before and after screenshots so they can be reversed in admin. A Flow rule can be switched off in admin. Delivery rule changes revert by restoring the previous zone version (keep the last good copy of both lists).
