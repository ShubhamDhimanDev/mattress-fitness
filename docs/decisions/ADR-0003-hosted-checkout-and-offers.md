# ADR-0003: Shopify hosted checkout; offers run before checkout as normal order lines

- **Status:** Accepted (mandated by SOW §5 and §7)
- **Date:** 2026-10-11
- **Deciders:** SOW; solution-architect
- **Requirements:** REQ-PRE-001 to REQ-PRE-006, REQ-PROMO-001/002, REQ-CHK-001, REQ-EXT-002, EXC-01, EXC-02
- **Related:** F-07, F-08, F-09, R-10, R-11

## Context

The SOW keeps Shopify's secure hosted checkout, excludes custom content inside checkout steps and any custom checkout (EXC-01, EXC-02), and requires every offer to run on the client's pages before checkout so that each add-on arrives as a normal order line. Gift and bundle prices must come from Shopify discounts so cart and checkout agree.

## Decision

- Never build or embed a replacement checkout. Hand off to the cart's Shopify checkout URL.
- Model every offer as ordinary cart lines (protector, haul-away service product, Extend coverage line, gift at $0 via discount, bundle via discount).
- Implement offer logic as one pure, tested function (`evaluateOffers`) used for display and again on the server before the hand-off. Prices are never accepted from the browser; the browser sends variant IDs and quantities.
- Record declined offers as cart attributes so they appear on the order.
- Use Shopify Functions only where eligibility is verified (F-07); otherwise fall back to server-side enforcement plus reconciliation, and report the limitation plainly.

## Consequences

Easier: pricing and tax stay Shopify's; no payment-scope exposure. Harder: no checkout-side enforcement without Functions, so the storefront must be the strict layer and a reconciliation report the detective control; behaviour must be tested at the boundary where the cart becomes a checkout.

## Alternatives considered

Custom checkout or checkout extensions for upsells: excluded by the SOW and gated by plan. Computing prices in the storefront: breaks "cart price equals checkout price".

## Verification

Phase 4 e2e compares cart and checkout totals for sampled baskets; tamper tests prove the server revalidation; the threat model T-01, T-02 and T-06 mitigations are verified in Phase 7.

## Implementation note (2026-10-15, as built)

Built as decided: no replacement checkout; the hand-off is a redirect to the cart's https `checkoutUrl` from `/checkout-steps` after the server gate (`app/lib/cart/checkout.ts`). `evaluateOffers` is one pure function (`app/lib/offers/evaluate.ts`) used for the view and, through `revalidateCartGate`, for the repair passes (max 3) after every cart action, on `/cart` and on `/checkout-steps` (DEC-029). The browser sends ids, quantities, codes and plan keys only. Declines are cart attributes (`offer_declined_comfort_guarantee`, `offer_declined_haul_away`, `offer_declined_protection`) plus `delivery_choice`. Gift price: a gift line not priced at 0 pauses checkout and the picker ships off (`PUBLIC_GIFT_PICKER_ENABLED`, DEC-047); a bundle saving is shown only from a titled automatic discount allocation (DEC-046). "Use Shopify Functions only where eligibility is verified" resolved to none (ADR-0006). The cart-versus-checkout total comparison in the verification section has not run (no store); the unit, mock-store e2e and tamper tests in `storefront/tests/` cover the server side only. No divergence.
