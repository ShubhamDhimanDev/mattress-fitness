# Delivery-zone approach: options and recommendation

Task P0-07 (research only). Decides nothing: the decision is taken in P3A-10 after Q-008 and Q-002 are answered. Facts are from Shopify documentation fetched 2026-10-11; everything else is marked *(verify)*.

## Owner decision (2026-10-12)

The store is on **Basic** and the owner chose **one delivery zone for now**. Result: model the zone once as a metaobject and use **Shopify Local delivery** with the same postal-code list as the checkout mechanism (option 1 with a generated mirror and a parity test), because the Delivery Customization Function (option 2) is not available to us on Basic. Whole-state zones would use a normal shipping rate instead. See [ADR-0007](../decisions/ADR-0007-single-delivery-zone-local-delivery.md), SD-04 and SD-07. The detailed comparison below is kept as the evidence.

## The problem

The SOW wants white-glove in-home delivery offered only when the shopper's ZIP is inside the client's delivery area, with the client's ZIP list and fee rules (free above a threshold, flat fee below) (SOW §7). The storefront must show a delivery promise by ZIP on the product page (REQ-DEL-002), offer haul-away only inside the area (REQ-PRE-003), and checkout must offer or hide white-glove consistently. If the storefront and checkout use different lists, shoppers see promises that checkout rejects (R-09).

## Verified facts

| # | Fact | Source |
|---|---|---|
| F-18 | **Shopify local delivery** can serve "within a set distance" or "for certain postal codes". A postal-code zone is a list separated by a comma and a space, up to **3,000 characters**, with `*` wildcards for ranges; up to **10 zones per location**; each zone has a price (0 allowed), an optional minimum order, and up to 3 extra price rules; the lowest applicable price wins. It is configured **per location**. At checkout it appears as a shipping option whose name **cannot be changed**, and it works with Shop Pay but **not with Apple Pay, Google Pay, Amazon Pay or PayPal in the first checkout step**. The page does not state which plans support it. | https://help.shopify.com/en/manual/shipping/setting-up-and-managing-your-shipping/local-methods/local-delivery |
| F-19 | The **Delivery Customization Function API** can hide, reorder and rename delivery options at checkout. Its input includes the delivery address `zip`, cart lines, cart attributes and shop metaobjects. At most 25 delivery customization functions per store. The page does not state plan or app-type restrictions (the general rule in F-07 applies: custom apps with Functions need Plus; public apps work on any plan). | https://shopify.dev/docs/api/functions/latest/delivery-customization |
| F-20 | The Storefront API Cart exposes `deliveryGroups` based on the buyer identity's delivery address preference or the signed-in customer's default address; carrier rates need `withCarrierRates`. The page **does not confirm** that delivery options can be read for a bare ZIP before checkout. | https://shopify.dev/docs/api/storefront/latest/objects/Cart |
| (note) | Third-party apps exist that restrict delivery by ZIP and claim any-plan compatibility; at least one requires Plus for the new checkout. **Unofficial and unverified** against the apps' own pages, so not recorded as a fact. | forum and directory search results |

## Options

| # | Option | Single source of truth | Checkout enforcement | Cost and plan | Main risks |
|---|---|---|---|---|---|
| 1 | **Local delivery postal-code zones** (native) as the checkout truth; the storefront reads a mirrored list | No: two lists, kept aligned by a script and a parity test | Native | no extra app; plan support to verify | 3,000 characters per zone and 10 zones per location may be too small; fixed option name; **express wallet buttons (Apple Pay, Google Pay, PayPal) do not work with it in the first step, which conflicts with SOW §7's express buttons (R-22)**; per-location setup; ZIP-to-eligibility for the storefront has no documented native read (F-20) |
| 2 | **Metaobject `delivery_zone` as the single source of truth**, read by the storefront, and by a **Delivery Customization Function** that hides white-glove outside the list | Yes | Function in checkout | Function needs Plus (custom app) or a public app; client edits one list in admin | Eligibility (Q-002); needs a shipping rate for white-glove that the Function hides when ineligible |
| 3 | Option 2 as a data model, with a script that also writes the Local Delivery postal codes | Mostly (one editable list, generated copies) | Native | needs the Admin API to write local delivery settings *(verify)* | unverified API; same wallet limitation as option 1 |
| 4 | **Third-party ZIP-restriction app** | App's own list | App | monthly fee outside the SOW (EXC-12), lock-in | vendor dependency; storefront still needs the list |
| 5 | Storefront-only gating of the UI | Yes | **None** | none | checkout would offer white-glove anywhere: not acceptable (T-02) |

## Recommendation (provisional)

1. **Model the zone list once as a metaobject** whichever option is chosen (the storefront needs it either way, and the quiz, haul-away and promise rules read it). This keeps the storefront decision independent of the checkout mechanism.
2. If Q-002 shows **Plus** (or a public-app route is acceptable to the client): choose **option 2**. It gives one list, parity by construction and clean enforcement.
3. If **not Plus**: choose **option 1 or 3** with a generated copy and a parity test in CI, and put the express-wallet limitation (R-22) to the client for an explicit decision, because it affects a feature the SOW lists. Consider representing white-glove as a flat or conditional **shipping rate** instead of local delivery if V-06 shows ZIP-level rate conditions are available *(verify)*.
4. Always keep the **server-side** eligibility check for the haul-away step and a reconciliation report, regardless of option.

## To verify (extends V-06)

- V-06a: Is local delivery available on the client's plan, and does it work with the client's checkout (Plus note in search results suggests plan-specific conditions)?
- V-06b: Do express wallet buttons really disappear or fail for carts where local delivery is the only method, in the *current* checkout? Test on the development store.
- V-06c: Can the Admin API read and write local delivery postal codes (for option 3)?
- V-06d: Can the Storefront API return delivery options for a ZIP before checkout (cart delivery address mutations plus `deliveryGroups`)? If not, eligibility for the product-page promise must come from our own list.
- V-06e: Can a shipping rate be conditioned on ZIP natively (zones refined by postal code)? Community answers conflict.

## Questions for the client (Q-008)

How many ZIPs, over how many warehouses or store locations? Does white-glove ship from every store or from specific ones? How are fees set (threshold and flat fee)? Who maintains the list and how often? Is losing express wallet buttons on white-glove carts acceptable?
