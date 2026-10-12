# Phase 4: Cart, matching add-ons, bundles, gifts and pre-checkout offer orchestration

## Objective

Build the cart and the pre-checkout steps that raise order value, with every offer arriving at Shopify checkout as a normal order line and every price agreeing with Shopify's. **Business outcome:** protectors, add-ons, bundles and gifts are sold on our pages without breaking the "cart price equals checkout price" promise.

## Scope

In: cart drawer and page, add-on and bundle offers, gift with purchase, free-delivery message, financing message slots, pre-checkout flow (comfort guarantee), decline recording, server-side revalidation, hand-off to checkout, add-on products and launch promotions configured.
Out: haul-away step (5B), accident-protection step (5A), checkout configuration (5B), post-purchase (5B).

## Prerequisites

Phase 3B product pages; Phase 3A data; CLR-010 and CLR-011 business rules (sample rules suffice to start); V-02 and V-03 verified; CLR-009 threshold for the free-delivery message; Q-016 for financing messages.

## Requirement IDs

REQ-ADD-001, REQ-ADD-002, REQ-CART-001, REQ-CART-002, REQ-CART-003, REQ-CART-004, REQ-CART-005, REQ-PRE-001, REQ-PRE-002, REQ-PRE-005, REQ-PRE-006, REQ-PROMO-001, REQ-PROMO-002, REQ-CHK-001, REQ-CAT-007, REQ-CAT-008

## Architecture and design decisions

- **One pure offer engine.** `evaluateOffers(cart, rules, context)` returns which offers apply, which lines are valid, and which must be corrected. It runs in the UI for display and again on the server before checkout (REQ-PRE-006). It is the main unit-test target.
- **Rules come from Shopify** (metaobjects and product relations from the data model), not code. Changing a rule in admin changes the offer without a deploy.
- **Prices are never sent from the browser.** The browser sends variant IDs and quantities; Shopify prices them. Gift and bundle prices come from Shopify automatic discounts so the cart and checkout agree ([cart and checkout boundaries](../../.claude/skills/shopify-cart-and-checkout-boundaries/SKILL.md)).
- **Decline recording** uses cart attributes written when the shopper declines; they surface on the order. Attribute names are fixed in `app/lib/offers/attributes.ts` and documented.
- **Linked lines** use Shopify **nested cart lines** (`parent` on `cartLinesAdd`, removed with the parent, F-26) if V-02 and V-16 confirm the behaviour on a Basic-equivalent dev store, otherwise a line attribute pair checked by our server; the same linking model is reused for Extend (5A), so decide it once here (ADR-0009).
- Pre-checkout steps are a small server-driven flow (one route, step in the URL) so back, reload and deep links are safe.
- Hand-off is to the cart's Shopify `checkoutUrl`; no custom checkout (EXC-02). **Basic plan** (ADR-0006): no Function or checkout extension is built; all of this logic stays before checkout.
- Cart writes go through server actions with the **private** Storefront token; the browser never needs write access to the cart.
- **Gift removal rule:** when the qualifying line leaves the cart, our server removes the gift line too (Shopify only drops the discount, it would otherwise charge full price for the gift).

## Tasks

| ID | Task | Owner | Depends on | Output and expected files |
|---|---|---|---|---|
| P4-01 | Offer engine types and `evaluateOffers`, with table-driven tests for tampered and edge carts | solution-architect | P3A-02 | `storefront/app/lib/offers/*` |
| P4-02 | Cart drawer and page: edit size and quantity, remove, optimistic updates, errors | shopify-hydrogen-developer | P3B-08 | `app/components/cart/*`, `app/routes/cart.tsx` |
| P4-03 | Size-matched foundations, adjustable bases and frames on the product page | shopify-hydrogen-developer | P4-01 | components and loader additions |
| P4-04 | Matching protector, pillow and bedding offers in the cart | shopify-hydrogen-developer | P4-01 | cart offer components |
| P4-05 | Bundles ("frequently bought together") with Add all and Shopify bundle discounts | integration-engineer | P4-01, V-03 | batch add action, discount spec |
| P4-06 | Gift with purchase: automatic discount setup, size picker, removal sync | integration-engineer | P4-01, V-03, CLR-011 | gift component, discount spec |
| P4-07 | Free-delivery progress message | shopify-hydrogen-developer | P4-02, CLR-009 | component and unit tests |
| P4-08 | Store-card and Affirm message slots (hidden when inactive) | integration-engineer | Q-016 | `app/components/cart/FinancingMessage.tsx` |
| P4-09 | Pre-checkout flow route and step planner; comfort-guarantee step | shopify-hydrogen-developer | P4-01, CLR-010 | `app/routes/checkout-steps.tsx` |
| P4-10 | Decline recording through cart attributes; verify on a test order in admin | integration-engineer | P4-09 | `app/lib/offers/attributes.ts` |
| P4-11 | Server revalidation action and hand-off to Shopify checkout; preserve discounts and customer identity | shopify-hydrogen-developer | P4-09, P4-10 | action in the checkout-steps route |
| P4-12 | Configure add-on and service products and launch promotions on the development store (REQ-CAT-007, REQ-CAT-008) | integration-engineer | CLR-010, CLR-011 | configuration spec and admin checklist |
| P4-13 | E2E and negative tests: tampered carts, removed qualifying item, size changes, declines | qa-engineer | P4-02 to P4-11 | `storefront/tests/e2e/{cart,gifts,addons,precheckout,checkout-handoff}.spec.ts` |
| P4-14 | Phase gate review | project-manager | all | gate record |

## Dependencies and blockers

REQ-CART-005 is Blocked by Q-016 and CLR-007/008; the message slot ships hidden. If V-03 shows automatic discounts cannot express a client rule, raise a change request instead of improvising pricing in code.

## Security considerations

Price tampering and discount abuse are the main threats ([THREAT_MODEL](../../docs/security/THREAT_MODEL.md) T-01, T-02): never accept client-supplied prices or discount amounts; revalidate eligibility server-side; limit quantities server-side; validate variant IDs belong to the allowed offer set; protect actions against CSRF with same-site cookies and origin checks; no PII in logs.

## Testing

Unit: `evaluateOffers` (every rule, orphan lines, over-limit quantity, gift without qualifier), bundle and gift price expectations. Integration: cart mutations against the development store, including partial failure of Add all. E2E: full journey to the Shopify checkout page, stopping before payment; assertions that cart lines and totals equal the checkout's. Manual: compare cart total to checkout total on three sample baskets.

## Acceptance criteria

All listed REQ acceptance criteria are met on staging; cart total equals checkout total for the sampled baskets; a tampered cart is corrected or rejected before checkout; declined offers appear on the test order in Shopify admin.

## Definition of done

Gates G1 to G8 ([MASTER_PLAN](../MASTER_PLAN.md#phase-gates)) plus: offer rules documented for the admin guide; no known pricing mismatch open.

## Review and sign-off

`code-reviewer` focuses on pricing and eligibility logic; `security-engineer` reviews the revalidation action and abuse cases; `qa-engineer` signs the negative tests; client approves offer wording and rules.

## Rollback and recovery

Offers are driven by Shopify configuration: disable an offer by deactivating its discount or rule in admin without a deploy; the code path degrades to "no offers". Code changes revert through git. A mispriced promotion is stopped by deactivating the discount first, then fixing.
