# Shopify Basic plan: constraints and workarounds

Owner decisions of 2026-10-12: the client store is on the **Shopify Basic** plan; "everything is pre-checkout"; one delivery zone for now; Extend is implemented whether or not the client has an account yet; look and function follow the reference site. This document turns those into concrete designs. Verified facts carry a `F-` ID in [TECH_FEASIBILITY](TECH_FEASIBILITY.md); anything unverified is marked *(verify)* and has a `V-` task. SOW changes that follow from this are listed in [SOW_DEVIATIONS](../requirements/SOW_DEVIATIONS.md) and need client acknowledgement.

## 1. What Basic means for this project

| Capability | Basic | Evidence |
|---|---|---|
| Storefront API, Customer Account API, Hydrogen, hosted checkout | Available; metaobject Storefront access to be proven (V-05) | F-05, F-06, F-39 |
| Shopify Functions inside **our own** (custom or custom-distribution) app | **No**: custom apps with Function APIs are Plus only. Functions inside **public App Store apps** work on any plan except Starter | F-07, F-22 |
| Checkout UI extensions on the information, shipping and payment steps | **No** (Plus only) | F-23 |
| Thank-you and order-status page extensions (App Store apps) | Yes, all plans except Starter | F-23 |
| Post-purchase extensions | Only through **App Store** apps; custom apps need Plus; live stores need Shopify's access approval | F-24 |
| Checkout branding (logo, colours, fonts, background) | Yes, through the checkout and accounts editor. The **Checkout Branding API** is Plus only | F-25 |
| Nested cart lines (`parent` on `cartLinesAdd`) | No plan restriction stated in the docs *(verify on the dev store)* | F-26 |
| Automatic discounts (buy X get Y, amount off) | Yes per secondary sources *(verify V-03)*; **25 active** at a time | F-31 |
| Local delivery (postal codes or radius), local pickup | No plan restriction stated | F-28 |
| Shopify Flow | Yes, free; the **Send HTTP request** action needs Grow or higher | F-41 |
| Web pixels (Customer events) for checkout tracking | Yes, all plans except Starter | F-22 |
| Admin API rate limit | 100 points per second (standard) | F-30 |
| Legacy "custom apps" created in admin | **Cannot be created since 2026-01-01**; use a Dev Dashboard app | F-30 |

## 2. Design principle: three places logic can live

1. **Before checkout, in our storefront server** (cart, offers, pre-checkout steps, revalidation). This is where almost everything lives (owner decision).
2. **As native Shopify configuration**: automatic discounts, shipping and local delivery, pickup, notification templates, checkout branding, Shopify Flow, Search and Discovery filters.
3. **After the order, as a detective or corrective control**: Shopify Flow on Basic, or a webhook receiver that we already need for Extend.

We never claim a rule is enforced inside checkout. Where the SOW says it is, [SOW_DEVIATIONS](../requirements/SOW_DEVIATIONS.md) records the layered replacement.

## 3. Workaround matrix

| # | SOW promise | Constraint on Basic | Workaround adopted | Residual risk the client accepts | Requirements |
|---|---|---|---|---|---|
| 1 | Haul-away maximum enforced inside checkout by a Shopify Function (§5) | Own Function = Plus only (F-07) | **Layered enforcement**: UI cap, server-side cap in every cart action, full revalidation before the checkout redirect, plus a **detective control after the order**: a Shopify Flow on *Order created* that tags and emails when haul-away quantity exceeds the maximum *(verify the line-item quantity condition and an internal-email action on the dev store)*, with the Extend sync webhook as the code-based alternative. Optional belt and braces: the client installs an App Store quantity-limit app (see section 5), at its own fee | A shopper who builds a cart by calling Shopify's public Storefront API directly can exceed the maximum. Impact is low (they pay for the extra pieces) and the order is flagged and corrected by staff | REQ-PRE-003, REQ-PROMO-003 |
| 2 | Haul-away only for in-home delivery inside the zone (§5) | Checkout lets the shopper pick pickup after our step | The pre-checkout step asks "in-home delivery or store pickup", stores the choice as a cart attribute, offers haul-away only for in-home delivery inside the zone. Flow tags orders that have a haul-away line but a pickup or parcel delivery method | Shopper can change the method inside checkout; flagged afterwards | REQ-PRE-003, REQ-DEL-001 |
| 3 | One-click post-purchase offer between payment and confirmation (§5) | Our own extension needs Plus; App Store apps are allowed on any plan with Shopify's access approval | **Not built by us.** Evaluate an App Store post-purchase app on the dev store (candidates in section 5); the client installs and pays for it, we configure it. If the client declines, the item is removed by change request | Third-party fees (EXC-12); headless compatibility unverified; relies on provider approvals (SOW §13) | REQ-POST-002 |
| 4 | Follow-up offer on the thank-you page (§5) | Same | Same app route (thank-you extensions are allowed from App Store apps on Basic) | Same | REQ-POST-001 |
| 5 | Extend accident protection (§6) | No impact on Extend's Offers and Orders APIs. The quoted price must exist as a Shopify variant price because Basic has no cart-transform price override | **Extend Price Points model** (at most 250 coverage SKUs named `Extend-Protection-Plan-<price>`; plan title, product ID and term as line properties). **Nested cart lines** link coverage to the covered item and Shopify removes the child when the parent is removed (F-26). Quantity is kept in step by our server. **Own order sync** (webhook, then `PUT /orders`) because the storefront is headless. Everything sits behind an adapter and a feature flag so it can be built and tested against a **local mock of the documented Extend API** before the client has an account | Needs Extend's written approval of a headless custom UI and its answer on price points and double order sync (Q-005). A direct-API cart could add a cheaper price-point SKU on its own or attach an arbitrary plan ID, so the sync **cross-checks the paid price against the plan and flags mismatches** instead of reporting them. Without an Extend account the feature is switched off; nothing else depends on it | REQ-EXT-001 to REQ-EXT-005, REQ-ADD-003, REQ-PRE-004 |
| 6 | Delivery by ZIP with fee rules (§7) | Native ZIP gating is **Local delivery**, which does not work with Apple Pay, Google Pay or PayPal in the first checkout step and cannot be combined with shipped items (F-28) | **Single delivery zone** (owner decision) stored once as a metaobject; **Shopify Local delivery with the same postal-code list** is the checkout mechanism; its zone price, minimum order and up to three extra price rules cover "free above a threshold, flat fee below". A parity script and test keeps the two lists identical. If the zone turns out to be whole states, a native shipping zone and flat rate replaces local delivery and removes the wallet limitation | Express wallet buttons may not appear for in-zone carts *(verify V-06b)*; Shop Pay still works; all items must ship from one location and shipped and local items cannot be combined (F-28); the option shows under Shopify's name "Local delivery" | REQ-DEL-001, REQ-DEL-002, REQ-CHK-003, REQ-CHK-005 |
| 7 | Checkout styled with logo, colours and fonts (§7) | Branding API is Plus; editor branding is available | Use the checkout and accounts editor: logo, background, colours, fonts | No advanced per-surface overrides | REQ-CHK-002 |
| 8 | Gift with purchase and bundle savings applied by Shopify discounts (§5) | 25 active automatic discounts; the discounted item is **not** added to the cart by Shopify | Our server adds the gift line (size picker) and **removes it again when the qualifying line goes** (otherwise the shopper would be charged full price for the gift). Bundles use automatic buy-X-get-Y rules; if the client needs more than 25 active rules, rules move to discount codes applied by our server *(verify V-03)* | Rule count limit; a code applied by the server can still be typed by a shopper but only benefits a qualifying cart. The gift picker (off until `PUBLIC_GIFT_PICKER_ENABLED=true`) assumes the gift is priced $0 by a line-level automatic discount (unverified, V-03): if Shopify prices it otherwise, the cart gate pauses checkout for every cart that holds a gift until the discount is fixed or the gift removed | REQ-CART-002, REQ-PROMO-001, REQ-PROMO-002 |
| 9 | Guest order tracking by number and email (§4) | The Storefront API cannot look up guest orders | Server route using the Admin API (`read_orders`) with a generic failure message and rate limiting. Default window is the **last 60 days** unless `read_all_orders` is granted; older orders: sign in, or use the order-status link in the confirmation email | Orders older than 60 days need an account or the email link | REQ-ACC-003 |
| 10 | Reviews and chat (§2) | None (client choice open) | Reviews: adapter with **Judge.me** as the default (server-side proxy, key never in the browser) *(verify the Hydrogen library)*; chat: **Shopify Inbox**, which Hydrogen supports per Shopify's July 2026 preview notes *(verify setup)*; either can be swapped | Client may choose another provider | REQ-PDP-005, REQ-ANL-004 |
| 11 | Store locator map (§4) | None | Leaflet with OpenStreetMap tiles on store pages only (low traffic, visible attribution, no prefetching), address and a keyless Google Maps directions link as fallback; swap for a hosted tile provider if traffic grows | OSM may withdraw access for commercial use at any time (F-37) | REQ-LOC-001 |
| 12 | Financing and Affirm messages (§5, §7), SD-11 | Provider rules unverified | Message slot built and hidden until activated; default copy points to **Shop Pay Installments** (Affirm-powered, US, needs Shopify Payments and Shop Pay). No monthly-payment figures unless a provider component supplies them | Compliance wording needs the provider's text and client legal review | REQ-CART-005, REQ-CHK-004 |
| 13 | Klaviyo, GA4, Meta (§2) | None | Klaviyo onsite script plus its native Shopify integration for checkout events; GA4 and Meta in the storefront through Hydrogen analytics and in checkout through Customer events pixels; consent gating | Access needed from client | REQ-ANL-001 to REQ-ANL-003 |
| 14 | Our team has staff access to the Shopify store (§10) | Basic has few staff seats | Request **collaborator access** through the Partner Dashboard *(verify it does not use a staff seat)* | None | CLR-002 |
| 15 | Product import of up to 400 products (§8) | Admin API 100 points per second | Importer uses Shopify **bulk operations** and throttles | None | REQ-CAT-002 |
| 16 | Admin API token for import, guest lookup and webhooks | Legacy custom apps no longer creatable | A **Dev Dashboard app with custom distribution** (no Functions or extensions, so no Plus needed); authorization-code grant on the client's store because client-credentials works only within the same organisation *(verify)* | One-time merchant approval | REQ-CAT-002, REQ-EXT-003, REQ-ACC-003 |

## 3a. As built (2026-10-15)

Built and mock-green, not verified on a store: the layers before checkout for row 1 and 2 (UI cap, server cap in every cart action, the `/checkout-steps` gate with up to three repair passes, delivery-choice step, haul-away step, `delivery_choice` attribute); row 5 (nested coverage lines, price-point matching, own order sync, cross-check, flag and mock); row 6 (zone and ZIP logic on the `OFFER_CONFIG_JSON` seam, signed ZIP cookie, parity script over two JSON exports); row 8 (the gift picker ships **dark** behind `PUBLIC_GIFT_PICKER_ENABLED=true` because the $0 gift price depends on V-03; a gift line not priced at 0 pauses checkout; a bundle saving is shown only from a titled automatic discount allocation). The **code-based detective control is built** (`app/lib/detective/`, run on `orders/paid` and `orders/updated`, plus `scripts/detective/report.mjs`) and is now the primary after-the-order control for row 1 and 2; the Shopify Flow rule described in row 1 is an optional second layer and is not configured (V-17). The detective only logs: no tag, email or alert, and it has never run on a real order. Not built: row 3 and 4 (post-purchase app, by decision), row 9 (guest order lookup), rows 10 to 13 (reviews, chat, maps, Affirm, Klaviyo, GA4, Meta: placeholders only), row 15 beyond the importer scripts. Residual risk acceptance by the client and the Shopify checkout ZIP restriction are open (B-17, B-18, SD-01).

## 4. Layered enforcement for haul-away (detail)

```
Shopper UI  ->  server action  ->  revalidation before checkout  ->  Shopify checkout  ->  order created
 cap in UI       cap + eligibility    evaluateOffers(cart) again       (no custom rule)      Flow or webhook:
                 (private token)      correct or reject                                      tag + email if over limit
```

- All cart changes from our site go through server actions using the **private** Storefront token, so the browser never needs write access. The public token still exists (Hydrogen design), which is why the layers after the server are detective rather than preventive.
- The cap value is **designed** to live in `site_settings.haul_away_max`, with the Flow condition holding its own hand-set copy (the admin guide says to change both together, and a reconciliation report compares them). **As built the code reads it from `rules.haulAway.maxPieces` in `OFFER_CONFIG_JSON`** (DEC-030) until P4-12; no Flow rule and no cap-comparison report exist yet.
- This is a deviation from the SOW sentence "enforced inside checkout by a Shopify Function" and must be acknowledged by the client (SD-01 in SOW_DEVIATIONS).

## 5. Third-party apps we may recommend (client pays; verify on the dev store before recommending)

| Need | Candidates seen in App Store listings | What is unverified |
|---|---|---|
| Maximum quantity per order (belt and braces for item 1) | CartWisp: Checkout Validation (free tier), Limit: Purchase Order Quantity (free plan), UR: Order/Quantity Limits, Common Sense Checkout Rules | Whether each works on **Shopify Basic** (listings use "Basic" for their own pricing tiers), and whether they apply to carts created through the Storefront API |
| Post-purchase upsell (items 3 and 4) | Aftersell (post-purchase upsell stated available on all plans), SpurIT | Headless compatibility; ReConvert and others were not checked |

## 6. When to revisit (triggers for a Plus conversation)

- The client insists on enforcement or custom content **inside** checkout (EXC-01 and the SOW's Function sentence).
- More than 25 concurrent automatic discounts are needed.
- Advanced checkout branding or checkout-step extensions are wanted.

A public (App Store reviewed) app of our own could also carry a Function on any plan, but it needs Shopify's app review and is out of scope; record as a change request if ever wanted.

## 7. Verification tasks created

**Development stores are not plan-gated (V-26):** an experiment that works on one does not prove Basic can do it. Dev stores prove API behaviour; plan-dependent claims come from Shopify documentation and are checked on the client's store (read-only) or a paid Basic trial store before go-live.

V-16 Nested-line behaviour on a Basic dev store (child quantity updates, removal, `instructions`). V-17 Flow on Basic: line-item quantity condition and internal-email action. V-18 App Store quantity-limit apps on Basic with Storefront-API carts. V-19 Post-purchase app compatibility with a headless checkout. V-20 Dev Dashboard custom-distribution app: Admin API token path on the client's store and webhook subscription. V-21 Collaborator access versus Basic staff seats. See [TECH_FEASIBILITY](TECH_FEASIBILITY.md) section 3.
