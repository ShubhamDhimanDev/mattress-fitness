---
name: shopify-cart-and-checkout-boundaries
description: "Decides and implements what runs in the cart and pre-checkout pages versus inside Shopify's hosted checkout: cart mutations, offer lines, decline recording, server-side revalidation, hand-off to the checkout URL, and the rule that prices always come from Shopify. Use for cart, add-on, bundle, gift, haul-away and protection work, and whenever someone proposes customising checkout."
---

# Cart and checkout boundaries

## When to use

Any change to the cart, the pre-checkout steps, offers, or the hand-off; any proposal to change something "in checkout". Background: `docs/decisions/ADR-0003-hosted-checkout-and-offers.md`, `docs/architecture/ARCHITECTURE.md` sections 4 and 5.

## Steps

1. **Classify the need.** Can it be an ordinary cart line, a Shopify discount or a cart attribute handled before checkout? Then build it on our pages. Needs custom content or logic *inside* checkout? That is excluded (EXC-01, EXC-02); the only options are a Shopify Function or checkout/post-purchase extension **if eligibility is verified** (V-10, `shopify-promotions-and-functions`), otherwise report the limitation and the fallback.
2. **Cart mutations.** Use Hydrogen's cart handler and route actions. Send variant IDs and quantities only. Batch with the 250-line limit in mind (F-09). Always handle `userErrors` and `warnings`; make partial failure visible and recoverable.
3. **Offers as lines.** Protector, haul-away service, Extend coverage and add-ons are ordinary products. Gifts and bundle savings are Shopify discounts so the cart and checkout totals agree. Linked lines use the mechanism chosen in P4-01 (verify V-02).
4. **Single offer engine.** Display and enforcement both use `evaluateOffers(cart, rules, context)`; it is pure and unit-tested with tampered inputs (orphaned add-ons, over-limit quantities, expired gifts, ineligible ZIP).
5. **Decline recording.** Write cart attributes with the documented names; verify they appear on a test order in admin.
6. **Revalidate before hand-off.** On the server, rebuild eligibility from Shopify data; correct or reject invalid carts; never rely on client state. Then redirect to the cart's `checkoutUrl`, preserving discount codes and customer identity.
7. **Tests.** Unit for the engine; integration for mutations; e2e through to Shopify's checkout page, stopping before payment, comparing lines and totals with the cart; negative tests for tampering.

## Outputs

Cart and step code, the engine and its tests, attribute and discount specifications, an e2e spec, and a note of any behaviour that cannot be enforced inside checkout.

## Validation

Cart total equals checkout total on sampled baskets; a tampered cart is corrected or rejected before checkout; declines appear on the order; no custom checkout exists; no price or discount is read from the browser; every failure path leaves the shopper able to continue.
