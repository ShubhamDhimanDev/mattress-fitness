# ADR-0006: Basic plan: all offer logic runs before checkout; no Functions or checkout extensions built by us

- **Status:** Accepted by the owner (2026-10-12); client acknowledgement pending ([SOW_DEVIATIONS](../requirements/SOW_DEVIATIONS.md))
- **Date:** 2026-10-12
- **Deciders:** project owner; solution-architect
- **Requirements:** REQ-PRE-001 to REQ-PRE-006, REQ-PROMO-001 to 003, REQ-POST-001/002, REQ-CHK-002
- **Related:** F-07, F-22 to F-26, F-31, Q-002, Q-006, Q-007, SD-01 to SD-03, R-02

## Context

The client's store is on **Shopify Basic**. Functions inside our own custom or custom-distribution app, checkout UI extensions on the checkout steps, and our own post-purchase extension all need Shopify Plus. Only public App Store apps can bring those capabilities to a Basic store. The SOW (§5) nonetheless promises an in-checkout Function for the haul-away maximum and post-purchase offers. The owner decided: "everything is pre-checkout; find workarounds".

## Decision

1. All offer logic (comfort-guarantee protector, haul-away, Extend coverage, gifts, bundles, add-ons) runs on our pages and in our server actions before the hand-off to Shopify's hosted checkout (this extends ADR-0003).
2. We build **no** Shopify Function, checkout UI extension or post-purchase extension, and we do not create a Shopify app project for them (`shopify-app/` is not created).
3. Where the SOW promised enforcement inside checkout, we deliver **layered prevention before checkout plus a detective control after the order** (Shopify Flow on Basic, or our webhook receiver), and we say so plainly (SD-01).
4. Post-purchase and thank-you offers are delivered, if at all, by an **App Store app the client installs and pays for**; otherwise dropped by change request (SD-02, SD-03).
5. Pricing stays Shopify's: gifts and bundles are Shopify discounts; the storefront never computes or accepts a price.
6. If the client later moves to Plus or wants a reviewed public app of our own, we revisit this ADR (triggers in [BASIC_PLAN_WORKAROUNDS](../research/BASIC_PLAN_WORKAROUNDS.md) section 6).

## Consequences

Easier: no app review, no extension toolchain, no Plus dependency, a simpler repository, fewer moving parts to hand over. Harder: a determined shopper who calls Shopify's public Storefront API directly can create carts our server never saw, so enforcement after the fact (tags, emails, reconciliation) becomes part of operations and of the admin guide. Shopify prices every line, so a shopper cannot change a price. A direct-API cart can still add a cheaper add-on SKU on its own or attach an arbitrary plan ID as a line attribute, so integrations that act on such lines (the Extend sync, ADR-0009) must **cross-check what was paid against what is claimed** and flag mismatches.

## Alternatives considered

Upgrade to Plus: client cost decision, offered as an option, not assumed. Publish our own unlisted public app to carry a Function: needs Shopify's app review, out of scope. Block checkout through an App Store validation app: possible as an optional extra layer, but its Basic compatibility is unverified (V-18) and it adds a recurring fee.

## Verification

P5B tests: direct-API over-limit cart is flagged on a dev-store test order; Flow rule proven (V-17); tamper tests in Phase 4 prove server revalidation; client acknowledgement recorded in `progress/DECISIONS.md`.
