# Shopify store setup: the checkout side (admin configuration checklist)

Drafted 2026-10-26 for P5B-05 to P5B-11, REQ-CHK-002 to 006, the configuration side of REQ-DEL-001/002, and REQ-POST-001/002. **Nothing on this page has been run on any Shopify store.** The development store `mattressfitness-1iakxuvz.myshopify.com` holds one product and no configuration (REAL_STORE_FINDINGS), and there is no Admin token yet (B-02). Everything below was read from Shopify's public documentation on 2026-10-26 or from this repository.

## How to read this page

- **Who**: **C** = the client's team in Shopify admin; **W** = we, on the development store only; **O** = the project owner (decisions, accounts, written go-ahead). We never change the client's live store without the owner's written authorisation (CLAUDE.md).
- **`[ADMIN, NOT SEEN]`** = a menu, button or field name I could not confirm in Shopify's documentation. Do not trust it; correct this page with what the admin shows. **`[NOT SEEN]`** = a behaviour or fact that no source I read states. Counts are at the end of the page.
- **"Values we need"** lists questions only. No price, threshold, ZIP list, wording or policy on this page is the client's real one. Placeholders from `docs/integrations/OFFER_SETUP_DEVSTORE.md` are marked as such and must never reach the client's store.
- **Basic-plan limits** (ADR-0006, SD-01 to SD-11): we cannot ship our own Functions, checkout UI extensions or post-purchase extensions; all offer logic runs before checkout; enforcement after that is detective only. A development store is **not plan-gated** (V-26): a pass there proves behaviour, not that Basic allows it. Plan claims below come from documentation only and need a read-only check on the client's store before go-live.
- **Test order procedure** (used by every "Verify" row below, called TOP):
  1. Run the storefront against the development store (DEV_DATA.md) and build the cart through our pages.
  2. Go through our pre-checkout steps, then Shopify's hosted checkout. Stop before any real payment: use a test payment method only (section 3).
  3. Use Shopify Payments test mode if the store allows it: card `4242 4242 4242 4242`, a name of at least two words, a future expiry, a 3-digit security code (Shopify help, "Testing Shopify Payments"). Whether a development store offers test mode or needs the Bogus gateway is `[ADMIN, NOT SEEN]`.
  4. In admin open the order and record: delivery method, tax lines, discount lines, line properties, custom attributes (`delivery_choice`, `offer_declined_*`).
  5. Cancel and refund the order (REQ-ACPT-002): Orders, open the order, cancel and refund. Exact button labels `[ADMIN, NOT SEEN]`.
  6. Write the order number, date and result in `progress/TEST_RESULTS.md`. Never record a customer's real name, address or card.

## Summary

| Step | What | Requirement and task | Who | Blocked on |
| --- | --- | --- | --- | --- |
| 1 | Checkout and accounts branding | REQ-CHK-002, P5B-06 | C or W | brand kit (CLR-013) |
| 2.1 | Locations and stock | REQ-CHK-003, REQ-DEL-001 | C | client's store list |
| 2.2 | Local delivery, one zone | REQ-DEL-001/002, REQ-CHK-003, P5B-07 | C (W on the dev store) | ZIP list, fee, threshold (CLR-009, Q-008) |
| 2.3 | Store pickup and ready-for-pickup email | REQ-CHK-003, P5B-07 | C | store list, pickup wording |
| 2.4 | Parcel shipping rates | REQ-CHK-003, P5B-07 | C | which items ship by parcel, rates |
| 2.5 | Haul-away service product | REQ-PRE-003, P5B-04 | C or W | price, maximum, tax treatment |
| 2.6 | Haul-away check as a Shopify Flow rule | REQ-PROMO-003, P5B-05, V-17 | C or W | V-17, owner acceptance of ADR-0006 |
| 3 | Payments | REQ-CHK-004, P5B-08 | C | CLR-007 activations |
| 4 | Checkout features and taxes | REQ-CHK-005, P5B-09 | C | legal and tax answers |
| 5 | Customer emails in brand | REQ-CHK-006, P5B-10 | C or W | brand kit, wording |
| 6 | Gift and bundle discounts | REQ-PROMO-001/002, P4-12 | C or W | real rules (CLR-011, Q-020) |
| 7 | Customer accounts | REQ-ACC-001/002 | C then O | domain, channel choice (Q-003) |
| 8 | Headless or Hydrogen channel permissions | REQ-HOST-002/003 | C or O | Q-003 |
| 9 | Post-purchase options | REQ-POST-001/002, P5B-11 | O decides | client reply to CR-09 |
| 10 | Dev store verification script | V-xx | W | Admin token (B-02) |

---

## 1. Checkout and accounts branding (REQ-CHK-002, P5B-06, SD-06, F-25)

| | |
| --- | --- |
| Purpose | Shopify's hosted checkout, thank-you page, order status page and new customer account pages carry the client's logo, colours and font. |
| Where in admin | Settings, **Checkout** is the confirmed page (it is the Checkout settings page in Shopify help). The editor itself is called the **checkout and accounts editor** and is separate from the theme editor; the button that opens it from Settings, Checkout is `[ADMIN, NOT SEEN]` (likely "Customize"). It covers checkout, thank-you, order status and customer account pages. |
| Controls | Shopify help: add the brand's logo, add a background colour or image, change the colours and the font. A Shopify changelog entry of 2026-05-13 (read as a search summary, not opened) says logo, colours, typography and section styles are shared across checkout, customer accounts and sign-in, with a reusable palette of up to 20 colours and per-page logo or background overrides. Names of individual fields, whether a custom font file can be uploaded, and the draft and publish step (Shopify help mentions "managing your active and draft checkout configurations") are all `[ADMIN, NOT SEEN]`. |
| Values we need | Logo files in the sizes the client approves (header and favicon if the editor asks); the brand colours as hex values (background, accent, button, text, error); the font choice. Does the client have a licensed font, or will a font from Shopify's list do? (CLR-013; the brand kit is on hold, owner note 5.8 of the question pack.) |
| Who | C in the editor, or W on the dev store once the brand kit exists. The ui-ux-designer reviews the screenshots. |
| Verify (dev store) | Add an item through our site, reach Shopify checkout, then the thank-you page (after a test order, TOP) and the order status page. Sign in to the customer account pages. Screenshot all four at 375 px and 1280 px and compare to the brand kit. Record anything that cannot be styled. |
| Basic-plan limits | Standard editor branding is available on Basic or higher. The **Checkout Branding API** and the advanced "Checkout and Accounts Configuration API" are **Plus only**, as are apps on the information, shipping and payment pages (Shopify help, plan table). SD-06: advanced per-section styling is not delivered. The older Checkout Blocks branding editor is Plus only and scheduled for removal on 2026-12-31 (F-25, secondary source): never use it. |

## 2. Delivery

### 2.1 Locations and stock (prerequisite for 2.2 and 2.3)

| | |
| --- | --- |
| Purpose | Local delivery and pickup depend on the stock location. Shopify shows Local delivery only if **all physical products can ship from one location that has stock for the whole order** (Shopify help, F-28). |
| Where | Settings, **Locations** (named in `ADMIN_GUIDE.md` 5.2; not re-confirmed in Shopify's help this session `[ADMIN, NOT SEEN]`). |
| Values we need | Which locations exist (stores, warehouse); which one fulfils online orders; where each product's stock lives. Does any product ship from a different place than the rest (that breaks Local delivery for mixed carts)? |
| Who | C |
| Verify | In a dev-store order whose items are stocked at two locations, note whether Local delivery is offered (expected: not). TOP. |
| Basic-plan limits | None stated on the help page. |

### 2.2 Local delivery: the single zone (REQ-DEL-001/002, REQ-CHK-003, P5B-07, SD-04, SD-07, ADR-0007)

| | |
| --- | --- |
| Purpose | Shopify's checkout offers in-home ("white-glove") delivery only inside the client's ZIP list, at the client's fee, free from the client's threshold. |
| Where in admin | Confirmed (Shopify help, Local delivery): Settings, **Shipping and delivery**, then **Local delivery** in the **Additional delivery methods** section. Select the location and turn on **"Deliver orders to customers directly from this location"** in **Location status**. In **Delivery zones** choose **Use postal codes** (not a radius). Fields: **Zone name**, the postal codes, **Minimum order price** (optional), conditional pricing (optional), **Delivery information** (optional message), **Delivery price** (enter 0 for free). Save. |
| Postal code rules | Codes separated by a comma and a space, at most **3,000 characters**. A `*` after a prefix matches every code that starts with it. Up to 10 zones per location and up to 3 extra price-based rules per zone. If a customer falls into several zones or rules, they are charged the lowest applicable price. |
| Values we need | The ZIP list (or the prefixes) for the one zone; the delivery fee; whether delivery is free from an order amount and which amount; whether a minimum order applies; the wording of the **Delivery information** message (client-approved, it appears in the order confirmation email for local delivery orders); the zone's name. Does the list fit in 3,000 characters (about 430 five-digit codes)? Is the "zone" really whole states (then a normal shipping rate replaces Local delivery, SD-04)? What should a cart do that mixes in-home items and parcel items (Shopify makes this impossible in one order; pack question 9)? |
| Keep the two lists identical | The storefront reads the zone from `OFFER_CONFIG_JSON` (`zone.postalCodes`, `feeCents`, `freeOverCents`). Export that list to a JSON file, copy the Local delivery list into a second file, and run `node scripts/shopify/check-delivery-parity.mjs --zone zone-export.json --local local-delivery-export.json` (exit 0 means identical; wildcards understood; samples in `scripts/shopify/sample/`). Run it on every list change (ADMIN_GUIDE section 8). The dev-store placeholder list `60601, 60602, 60603, 60645`, fee `$149.00` and free-over `$999.00` in `OFFER_SETUP_DEVSTORE.md` 4.3 are made up: never use them on the client's store. |
| Who | C enters the values in admin; W runs the parity script and tests. |
| Verify (dev store) | (1) Parity script exits 0. (2) TOP with a shipping address inside the zone: Local delivery is offered at the fee. (3) Address outside the zone: not offered. (4) A cart exactly at the free-over amount, one cent below and above: the storefront treats free as starting **at** the threshold; whether Shopify's minimum is "at or above" is unverified (V-06). (5) Express buttons: note which appear on the first checkout step for an in-zone address (R-22, V-06b). (6) Items from two locations or a mixed parcel and local cart: note what the shopper sees. |
| Basic-plan limits | Help page states no plan restriction (F-28). **Local delivery works with Shop Pay but not with other accelerated checkouts: Apple Pay, Google Pay, Amazon Pay, PayPal.** Shipped and locally delivered items cannot be combined in one order. Customers need a Google-verified address inside the listed codes. B2B checkout does not support it. Third-party shipping apps may conflict. The option shows as "Local delivery", not "white-glove". We cannot add our own delivery customisation (a Function) on Basic. |
| Open item | We cannot restrict haul-away or any rule by the address typed at Shopify's checkout: our server only sees the ZIP the shopper entered on our pages (SD-01). Local delivery's postal list is the only native ZIP gate. B-17, B-18. |

### 2.3 Store pickup and the ready-for-pickup email (REQ-CHK-003, P5B-07)

| | |
| --- | --- |
| Purpose | Each retail store is a pickup location; the customer gets a "ready for pickup" email when staff mark the order ready. |
| Where in admin | Confirmed (Shopify help): Settings, **Shipping and delivery**, then **Pickup in store** in **Additional delivery methods**; click the location and turn on **"Let customers pick up orders directly at this location"** in **Location status**. Other sections: **Expected pickup date** (processing time customers see), **Store transfers** (supply a missing item from another location), **Ready for pickup notification** (pickup instructions; replaces the old `email_body` customisation), **Checkout preview**. Save. Staff mark an order: Orders, open the order, **Ready for pickup**, **Mark as ready for pickup**; later **Mark as picked up**. The email template is named **Ready for pickup** under Settings, **Notifications** (section 5). |
| Requirements | At least one location that fulfils online orders; the store uses the latest checkout; by default pickup is offered only when the **whole order** is in stock at the pickup location. |
| Values we need | Which stores offer pickup; the pickup processing time to show per store; the pickup instructions wording (client-approved); whether store transfers are allowed (and who moves stock). The store's location name must match the **Shopify location** field of its Store metaobject exactly (ADMIN_GUIDE 5.2). |
| Who | C. W sets one location up on the dev store. |
| Verify | TOP with the pickup method; check the checkout preview and the order; mark ready, then picked up; read the test emails (section 5). Product page: pickup answer for a size with known stock (needs the storefront permission in section 8). |
| Basic-plan limits | Custom pickup apps and "ship and pickup in one order" are Plus only. Standard pickup is not restricted. |

### 2.4 Parcel shipping rates (REQ-CHK-003, P5B-07)

| | |
| --- | --- |
| Purpose | Items that ship by parcel (not in-home) have a rate in checkout: carrier-calculated or flat. |
| Where in admin | Settings, **Shipping and delivery**. Shopify help says rates "are gradually moving to shipping options by market" and that a country must be in an active market. A Shopify changelog entry of 2026-03-26 (search summary) says a shipping option can offer free shipping above a minimum order value. The exact rate screens, labels for a flat rate, "free over" condition and carrier rates are `[ADMIN, NOT SEEN]`: read your admin first. |
| Values we need | Which products ship by parcel; flat rate or carrier-calculated (which carrier accounts); rate amounts; is there a free-parcel threshold, and is it the same number as the in-home free-over amount (the storefront cart message uses one number, `freeDelivery.thresholdCents`, `OFFER_SETUP_DEVSTORE.md` 4.3: if the parcel rule differs, tell the owner so the message is changed in code); package weights and dimensions on products if carrier-calculated; US-only. |
| Who | C |
| Verify | TOP with a parcel-only cart: rate shown and charged; threshold behaviour at, below and above. |
| Basic-plan limits | Carrier-calculated rates at checkout may depend on the plan `[NOT SEEN]`. We build no delivery customisation. |

### 2.5 Haul-away service product (REQ-PRE-003, P5B-04)

| | |
| --- | --- |
| Purpose | The paid haul-away service is an ordinary product line that our pre-checkout step adds (ADR-0003). |
| Where | Products, Add product (ADMIN_GUIDE 2.8 and 4.1). Title **Recycle and disposal service**, one variant and **no options**, status Active, available to the Headless or Hydrogen sales channel, tag **`offer-only`** (and the importer does not add the tag). The variant id goes into `OFFER_CONFIG_JSON` as `rules.haulAway.variantId` together with `maxPieces`. |
| Values we need | The service price; the maximum pieces per order; whether sales tax applies to the service (client's accountant); whether it is a physical product. Suggested design question, unverified: mark the service as not a physical product so it does not count toward the "all items from one location" test for Local delivery (the checkbox label is `[ADMIN, NOT SEEN]`); the dev store must show whether a physical, untracked service line changes Local delivery eligibility (V-06). |
| Who | C or W |
| Verify | Product exists only as the service; not purchasable alone (our gate refuses it); not in search or the sitemap (V-27c); TOP: an in-zone cart with 1 piece, then the cap. |
| Basic-plan limits | The cap is enforced by our server and UI before checkout; inside checkout it cannot be enforced (SD-01). |

### 2.6 Haul-away check as a Shopify Flow rule (P5B-05, REQ-PROMO-003, REQ-PRE-003, V-17, V-18)

**Detective only (ADR-0006).** The rule runs after the order exists. It cannot stop an over-limit or wrongly delivered order; it tells staff. Today the code-based check (`app/lib/detective/`, runs on `orders/paid` and `orders/updated`) writes only a log line: it tags nothing and emails nobody (ADMIN_GUIDE 4.6). The Flow rule below is the only planned control that notifies staff, so it matters.

| | |
| --- | --- |
| Availability on Basic | Shopify help: **Shopify Flow is a free app on the Basic, Grow, Advanced and Plus plans.** Install it from the Shopify App Store; it opens at `admin.shopify.com/apps/flow` (a link on the help page; the menu path "Apps, Flow" is `[ADMIN, NOT SEEN]`). **Send HTTP request is not available on Basic** (Grow or higher), so Flow cannot call our webhook. Usage limits vary by plan and follow the API limits; the Basic figure is `[NOT SEEN]`. |
| Trigger | **Order created** (confirmed in Flow's trigger list; fires when a customer places an order; also when a draft order is marked paid). It provides the `order` object (Admin API Order). |
| Condition for "too many pieces" | Conditions on lists use **At least one of**, **None of**, **All of**; to test several fields on one line choose **Add criteria for same item** on the line items list, then combine with AND (Flow help). The Admin API `LineItem` has `quantity`, `sku`, `title`, `product` and `variant` (shopify.dev). **Whether Flow's condition builder offers `quantity` as a field is not stated on any help page read: `[NOT SEEN]`, this is V-17.** Fallbacks, all names confirmed in Flow's action list: use **For each loop** over the line items with **Count** or **Sum** and compare the total, or **Run code**. |
| Condition for "haul-away with pickup or parcel" | Needs the delivery method or our `delivery_choice` attribute on the order. Whether Flow exposes order custom attributes or the shipping line title is `[NOT SEEN]` (V-17, V-27e). |
| Actions | **Add order tags** (confirmed) with a tag the client picks (our suggestion: `haul-away-check`; a name, not a business rule) and **Send internal email** (confirmed): fields are the recipient address (fixed text; variables cannot be used there; several addresses separated by commas), **Subject** and **Message**. Whether the message may use order variables (order number) `[NOT SEEN]`. |
| Values we need | Staff email address(es) for the alert; the maximum pieces (the same number as `maxPieces`; **two places to keep equal**, ADMIN_GUIDE 4.6; the report script compares them in code when it exists); the tag name; the client's policy for handling a flagged order (ADMIN_GUIDE 4.6 step 6 says "Client policy: TO BE DEFINED"); who watches the inbox. |
| Who | W on the dev store first (to settle V-17); C on the live store afterwards (needs the owner's written go-ahead). |
| Verify (dev store) | Build an over-limit cart that our site would refuse: use a direct Storefront API `cartCreate` with the service variant at quantity above the cap (do this only against the dev store), check out with a test payment (TOP), then check: the tag appears on the order, the internal email arrives, a normal order is not flagged. Cancel and refund. Repeat for a pickup order that holds a service line. Record what Flow showed for each condition. |
| Basic-plan limits | No Function, no Flow action from a custom partner app (Plus). The optional App Store quantity-limit apps (CartWisp, Limit: Purchase Order Quantity, UR: Order/Quantity Limits, Common Sense Checkout Rules; CR-13, client-paid) are not confirmed for Basic or for Storefront-API carts (F-32, V-18). Do not install one without a dev-store test. |

---

## 3. Payments (REQ-CHK-004, P5B-08, CLR-007, Q-016)

Each option is **subject to activation by the client**; the requirement says non-activated options are not shown and every activated one completes a test payment. Open Settings, **Payments** (confirmed path).

| Option | Where and how | What the client must provide | Test | Notes and limits |
| --- | --- | --- | --- | --- |
| Cards, Shop Pay, Apple Pay, Google Pay (Shopify Payments) | Settings, Payments, **Shopify Payments** section (activation steps are on a page I could not read: `[ADMIN, NOT SEEN]`). Two-step authentication on the account is required (Shopify help). Accelerated checkouts (Shop Pay, Apple Pay, Google Pay, Amazon Pay, PayPal) show in an **Express Checkout** section at the start of Shopify's checkout. | Business and bank details, identity verification for the owner of the account; confirmation the store qualifies in the US `[NOT SEEN]` | Test mode: Settings, Payments, Shopify Payments **Manage**, **Test mode**, **Enable test mode**, Save. Test cards in the TOP. Test mode needs a paid plan and finished setup, must never be switched on for a live store, and test orders must not be fulfilled (a shipping label would be charged). Apple Pay and Google Pay still work in test mode and the page warns they use real cards, so use a test card and never a real wallet on any store in test mode. Shop Pay test: enter `test_card` at the start of the Nickname field of the test card. | Wallet buttons do not appear with Local delivery on the first step (section 2.2). |
| PayPal | **PayPal Express Checkout is not available to merchants in the United States** (Shopify help). US stores use **PayPal Wallet through Shopify Payments** (third-party summaries only; the official page and its activation path are `[ADMIN, NOT SEEN]`). The SOW says "PayPal": confirm the client means PayPal Wallet. | Nothing separate if it rides Shopify Payments; the client should check eligibility in admin | **PayPal Wallet does not appear at checkout in Shopify Payments test mode** (Shopify help). It therefore cannot be tested with test cards: its evidence needs a PayPal sandbox arrangement `[NOT SEEN]` or a small live order that needs the owner's and client's written authorisation. Record it as unverifiable until then. | Not available as an express button for in-zone Local delivery carts. |
| Affirm (direct) | Settings, Payments, **Alternative Payments** section, **Choose alternative payment**, select **Affirm**, tick **Use test mode** for the sandbox, enter the `public_api_key` and `private_api_key` from the Affirm merchant dashboard, **Activate** (Affirm's guide; Shopify's own page for this is `[ADMIN, NOT SEEN]`; third-party posts name the buttons differently). Affirm asks for promotional messaging to be set up first. | The client's own approved Affirm merchant account and keys. **The keys are typed into Shopify admin by the client; they never go into this repository, a chat or a test file.** Minimum and maximum order values `[NOT SEEN]` | Sandbox with Affirm's test mode and Affirm's sandbox identities (from Affirm). | US and USD (secondary sources). Ask whether the client wants both Affirm and Shop Pay Installments, which is also powered by Affirm (F-38): double financing messages confuse shoppers. |
| Shop Pay Installments | Settings, Payments, Shopify Payments **Manage**, in the **Shop Pay** section select **Shop Pay Installments**, Save. If the option is missing the store does not meet the requirements. Optional **Manage** under Shop Pay Installments for premium financing. | Nothing extra beyond Shopify Payments and Shop Pay being active; business entity in the US and USD | **Not available in Shopify Payments test mode, and test cards do not work with it** (Shopify help): it cannot be test-ordered on a dev store. | Order range conflict: $35 to $30,000 on the overview page versus $50 to $20,000 in a search summary of the activation page (F-38): ask Shopify admin what it shows. The headless messaging component is not documented (V-25), so our financing message slot stays hidden and uses text only (SD-11). |

| Values we need from the client | |
| --- | --- |
| Which of the six are activated | CLR-007, Q-016, pack Part 2 item 15. |
| Store credit card programme | Is there one? Which lender, how does a shopper apply, what disclosure wording? (we never write it). |
| Compliance wording | Who approves financing wording? (content page question 5.9.) |

**Who**: C activates and owns every account; W only tests on the dev store. **Basic-plan limits**: we cannot hide or reorder payment methods with a Payment Customization Function (Plus only; Shopify help). The set of methods is whatever the admin shows.

---

## 4. Checkout features and tax verification (REQ-CHK-005, P5B-09, SD-04, R-22)

| Feature | Where and what | Values we need | Verify | Limits |
| --- | --- | --- | --- | --- |
| Discount codes | The discount box is part of Shopify's hosted checkout; no toggle found `[ADMIN, NOT SEEN]`. Our `/discount/<code>` route applies a code to the cart. Codes are created at Discounts, **Create discount** (section 6). Shopify help mentions a limit of 5 discount codes per order. | Which codes the client will run; combination rules | TOP: a valid code, an invalid code, a code combined with an automatic discount (note the order of savings in cart and checkout, section 6). | Combination behaviour between two automatic discounts and a code `[NOT SEEN]` (V-03). |
| Email and SMS marketing opt-in | Settings, **Checkout**, **Marketing opt-in** section: **Email**, **SMS** (dropdown set to "Checkout only" adds the SMS checkbox), WhatsApp. Email preselect: **Regions recommended by Shopify** (follows local rules) or **Regions you choose** (default selects none, so never preselected). Editable **Marketing opt-in text**. **Shipping address phone number** (Customer information section) optional or required. | Legal answers: opt-in or preselected, by region; consent wording approved by the client's legal adviser (pack 5.3 and 5.4); is SMS used and with which tool; is a phone number required (carriers for Local delivery need one: Shopify asks for it at checkout for Local delivery) | TOP: the checkbox shows as set; after the test order the customer record shows the right consent status. | We do not write legal text. Klaviyo sync of checkout consent is separate (`docs/integrations/KLAVIYO.md`). |
| Express buttons | See section 3: they appear at the top of Shopify's checkout, ordered dynamically. Our pages render none of Shopify's accelerated-checkout buttons (the only match in the code is the financing text message). | Which wallets the client activates | TOP: open checkout for (a) a parcel cart and (b) an in-zone Local delivery cart, screenshot the Express Checkout area for each. | Local delivery: only Shop Pay survives; Apple Pay, Google Pay, Amazon Pay and PayPal do not work on the first step (R-22, SD-04). The client must approve this in writing (CR-10) or choose a normal shipping zone rate instead. |
| Taxes | Settings, **Taxes and duties**. In the United States entry under **Manage sales tax collection**, **Regions you're collecting in**, **Collect sales tax**; enter the sales tax ID for each registered state (it may be left blank and filled later). **Global settings** section: whether prices include tax and whether tax applies to shipping. **Tax rates and exemptions** for product overrides. Source: search summaries of Shopify help (US tax pages); the exact labels are `[ADMIN, NOT SEEN]`. Shopify says tax is the merchant's responsibility; in the US the choice is Shopify Tax or manual tax rates. | States where the client collects tax and the registration numbers; Shopify Tax or manual; tax on shipping and on delivery fees; taxability of the haul-away service and protection plans (accountant); prices tax-exclusive (US norm) | Place TOP orders to addresses in a state with registration, one without, and an in-zone Local delivery address; compare the tax lines with figures from the client's accountant for the same cart. Check the order and the confirmation email. | Not tax advice. We do not set rates. |

---

## 5. Customer notification emails in brand (REQ-CHK-006, P5B-10)

| | |
| --- | --- |
| Purpose | Order confirmation, shipping, pickup-ready and refund emails render in the client's brand. |
| Where in admin | Confirmed (Shopify help): Settings, **Notifications**. Global logo and colours: **Customer notifications**, **Customize email template**. One template: click the notification type, then the notification, **Edit code**, edit **Email subject** and **Email body (HTML)**, **Save**. **Preview** shows unsaved changes; **Send test email** sends to the address you log in with; **Revert to** a default or previous version restores the template and keeps logo and colour settings. |
| Template names | Confirmed by Shopify help pages: **Order confirmation**, **Order refund**, **Ready for pickup** (the pickup page names it; instructions text for it comes from the location, section 2.3). Also on the page: Order invoice, Abandoned checkout, Contact customer, Customer activation, Draft order invoice. **Shipping confirmation** and any shipping update, out-for-delivery or delivered template: named by third-party sources only, `[ADMIN, NOT SEEN]` (they may be checkboxes in a Shipping section). Local delivery orders use **Order confirmation** with the **Delivery information** text and the Liquid variable `delivery_instructions`. |
| Values we need | Logo and accent colour; the sender email address (set up and verified in Notifications, label `[ADMIN, NOT SEEN]`); reply-to; footer text and business address; any wording changes, approved by the client; which delivery notifications to turn on. |
| Who | The technical-writer or W drafts on the dev store; C copies to the live store. |
| Verify | **Send test email** for each of the four to a test mailbox; read on desktop and a phone client. Then a full TOP: place the order (confirmation), fulfil it (shipping), mark a pickup order ready (pickup-ready), refund it (refund), and confirm the right mail arrived each time. Note any placeholder text left (`[Client policy ...]`). |
| Basic-plan limits | None found for template editing `[NOT SEEN]`. Keep the standard Liquid variables; do not put keys, internal URLs or staff addresses in templates. Our code sends no email of its own (Klaviyo is separate). |

---

## 6. Discounts for gifts and bundles (REQ-PROMO-001/002, REQ-CART-002, P4-12, SD-09)

The storefront expects these titles. **The development-store rules are placeholders and must never be copied to the client's store** (`OFFER_SETUP_DEVSTORE.md`, DEC-082). Production rules and titles come from the client (CLR-011, Q-020) and are set in `OFFER_CONFIG_JSON`.

| | Gift: free pillow | Bundle: sleep set |
| --- | --- | --- |
| Admin location (confirmed) | **Discounts**, **Create discount**, **Buy X get Y** | **Discounts**, **Create discount**, **Amount off products** |
| Method | **Automatic discount** (Method choice on the Amount off products screen; the Buy X get Y automatic choice is the same idea `[ADMIN, NOT SEEN]` for that screen) | Automatic discount |
| Title the storefront expects | Any title; shoppers see it on the line. It equals the rule name: `Free pillow with a queen or larger mattress (placeholder)`. The storefront checks that the gift line costs $0, not the title. | **Exactly** `Sleep set 10% off (placeholder)`: it is `discountTitle` in all three bundle rules. The saving shows only when an automatic discount allocation with this title is on the lines (capitals and extra spaces ignored). |
| Settings | **Customer buys**: minimum quantity of items 1, the `luxe-hybrid` and `luxe-foam` products (not `cloudmere-hybrid`). **Customer gets**: quantity 1, `sample-gift-pillow`, **At a discounted value: Free**. Tick **Set the maximum number of uses per order**: 1 (must equal `maxQuantity`). **Combinations**, **Active dates**. | **Discount value**: Percentage, 10. **Applies to**: Specific products (five products). **Minimum requirements**: Minimum quantity of items 3. **Combinations**, **Active dates**. |
| Values we need | Real gift rule (which products qualify, the gift, quantity, dates); real bundle rule and discount; the exact titles; dates; who may change them; wording the shopper reads. Is "one of each" required (see limits)? | Same. |
| Who | C or W | C or W |

Confirmed this session (Shopify help): the Buy X get Y "get" item is **never added to the cart automatically** (our server adds the gift); free items need stock; a maximum of **25 active automatic discounts** applies, including app-based ones (F-31 is now backed by Shopify help, no longer only secondary); minimum purchase counts product prices only.

**Verify (dev store, V-03, V-27a):** follow `OFFER_SETUP_DEVSTORE.md` section 5 step by step: gift priced $0 in the Storefront cart and identical at checkout; removing the mattress removes the gift; Add all shows the bundle saving with the titled allocation; a code or a different titled discount shows no bundle saving; record whether two automatic discounts combine and whether the allocation `title` is exposed. Only after V-03 passes does the owner set `PUBLIC_GIFT_PICKER_ENABLED=true`.

**Basic-plan limits:** no Function, so Shopify cannot require "one of each": any three units of the five products earn 10% (known gap, `OFFER_SETUP_DEVSTORE.md` 4.2). More than 25 rules means moving to codes applied by our server (SD-09). A rule that native discounts cannot express goes to a change request, not to price code in the storefront.

---

## 7. Customer accounts (REQ-ACC-001/002, Q-018, V-08, F-39)

| | |
| --- | --- |
| Purpose | Shoppers sign in on our site with Shopify's hosted login; orders, profile, addresses and the saved quiz come from the Customer Account API. |
| Step 1: turn on new customer accounts | Confirmed (shopify.dev): Settings, **Customer accounts**, edit the **"Accounts in online store and checkout"** section, choose **Customer accounts**, save. The Customer Account API requires this. Sign-in options per Shopify help: passwordless (one-time 6-digit code), Sign in with Shop (needs Shop Pay), Google and Facebook sign-in; a custom identity provider is Plus only. Which options the client wants and the admin labels for them are `[ADMIN, NOT SEEN]`. |
| Step 2: the Customer Account API application | Headless channel: Sales channels, **Headless**, select the storefront, **Customer Account API settings**. Hydrogen channel: open the storefront, **Storefront settings**, **Customer Account API**, then under **Application setup** click **Edit**. Choose client type **Public** (needed for Hydrogen; without it the JavaScript origin and Logout fields do not show). Field labels differ between two Shopify pages: "Callback URI(s)" or "Callback URL(s)", "JavaScript origin(s)" or "Javascript origins", "Logout URI" or "Logout URL". HTTPS only; `localhost` is not supported, use a tunnel for local work; wildcards are not supported (third-party guide), so register each origin on its own. |
| Values for this app | Our callback route is `account_.authorize.tsx`, i.e. `/account/authorize` (Hydrogen's default). `<PROD>` is the live origin (Q-003 and the domain are open). **Callback URI(s):** `https://<PROD>/account/authorize`. **JavaScript origin(s):** `https://<PROD>`. **Logout URI:** `https://<PROD>` (Hydrogen's `logout()` sends the shopper to the current app origin by default and that address must be in the Logout field; our logout route then redirects to `/`). If the shop is reachable on both `www` and the bare domain, register both and make one canonical (`PUBLIC_SITE_URL`). Add the same three for each staging host and each tunnel host (`https://<STAGING>`, `https://<TUNNEL>`). Remove tunnel entries before go-live. |
| Scopes | The Customer Account API scopes in Shopify's table: `customer_read_orders` (order list and detail: `account.orders.*`), `customer_read_customers` and `customer_write_customers` (profile, addresses, and the quiz metafield). Hydrogen's client asks for `openid email` at login and exchanges the code for the `customer-account-api:full` scope (read from the installed `@shopify/hydrogen` 2026.4.7, not from Shopify docs). Where scope selection happens in the channel UI is `[ADMIN, NOT SEEN]`. The quiz metafield `custom.quiz_result` (customer, json) must have Customer Account API access **READ_WRITE** and Storefront access NONE: `scripts/shopify/definitions.json` already says so; apply it with `scripts/shopify/apply-definitions.mjs` (dry run first). |
| Values we need | The live domain; the client's choice of sign-in methods; the sender and branding of the login emails (the editor in section 1 styles the account pages). |
| Environment | `PUBLIC_CUSTOMER_ACCOUNT_API_CLIENT_ID` (under **Customer Account API Credentials**), `PUBLIC_CUSTOMER_ACCOUNT_API_URL`, `SHOP_ID` (server only), plus the four base variables (DEPLOYMENT.md). |
| Who | C turns accounts on and approves; W/O register URIs on the dev store and later on the client's channel. |
| Verify (dev store) | Through a tunnel: sign in, see orders after a test order (TOP), edit an address, save a quiz result and read it back, sign out (lands on `/`). Try a callback from an unregistered origin: it must fail. Note whether `customer_write_customers` is granted (V-08). |
| Basic-plan limits | New customer accounts and the Customer Account API are not plan-limited in the pages read. Custom identity provider and Multipass-style SSO are not available to us (Plus; Multipass is not supported by the Customer Account API). mock.shop does not support it, so only a real store can verify. |

---

## 8. Headless or Hydrogen channel: Storefront API permissions (REQ-HOST-002/003, V-05, V-07)

| | |
| --- | --- |
| Where | Sales channels, **Headless**, **Add storefront** (confirmed). Each storefront has its own tokens; open it, find the **Storefront API permissions** card, click **Edit**, tick, **Save** (confirmed). Permissions and Admin permissions are shared across all storefronts of the channel. A default set is created when the channel is installed; its contents are not in the page read, so compare the defaults with the table. Private token: the **Storefront API tokens** card, **Generate new token** to rotate. Where the public token is shown is `[ADMIN, NOT SEEN]`. Which channel (Headless or Hydrogen) the client needs is Q-003. |
| Principle | Least privilege. Enable what the table says the code uses, and nothing else. The private token is server-only (`PRIVATE_STOREFRONT_API_TOKEN`). |

Derived by searching `storefront/app/` for Storefront API operations on 2026-10-26. Scope names and their meaning are from shopify.dev "access scopes".

| What the code reads | Where | Scope to enable | Confidence |
| --- | --- | --- | --- |
| Products, variants, collections, search, predictive search, availability, product recommendations in queries | `lib/shopify/queries.ts`, `routes/search.tsx`, `routes/collections.*` | `unauthenticated_read_product_listings` | scope grants "Product and Collection objects" |
| Product tags (`offer-only`, `extend-coverage`: `products(query: "tag:...")` and the tag field) | `lib/shopify/offer-only.ts`, `lib/extend/coverage-catalog.ts` | `unauthenticated_read_product_tags` | scope grants the tags field; whether tag search needs it is V-27c |
| Inventory (`availableForSale`, quantity fields) | product queries, `lib/shopify/pickup-data.ts` | `unauthenticated_read_product_inventory` | `quantityAvailable` per the scope table |
| Pickup availability per store (`ProductVariant.storeAvailability`, `Location`) | `lib/shopify/pickup-data.ts`, `routes/api.pickup-availability.tsx` | `unauthenticated_read_product_pickup_locations` | confirmed scope table and F-29 |
| Metaobjects: `brand`, `homepage_section`, `promo_tile`, `quiz_question`, `quiz_option`, `quiz_scoring_rule`, `site_settings`, `store` (also defined: `faq`, `offer_rule`, `delivery_zone`, not read yet) | `lib/shopify/*-data.ts` | `unauthenticated_read_metaobjects`; **each definition also needs Storefront access "PUBLIC_READ"** (`definitions.json` sets it; verify after `apply-definitions`) | confirmed |
| Product, variant and collection metafields (`custom.*`: comfort, type, faqs, dimensions, brand, extend_category, related_*) | `lib/shopify/queries.ts`, `lib/extend/coverage-facts.ts` | Storefront access on each metafield definition (set to PUBLIC_READ in `definitions.json`); no scope row | confirmed in the file; effect unverified (V-04, V-05) |
| Blogs and articles | `routes/blogs.*` | `unauthenticated_read_content` | scope grants Article, Blog, Comment |
| Pages (`page(handle)`), navigation menu (`menu(handle)`), shop policies (`shop { privacyPolicy ... }`) | `routes/pages.$handle.tsx`, `lib/shopify/menu-data.ts`, `routes/policies.*` | probably `unauthenticated_read_content`, **`[NOT SEEN]`**: the scope table lists only Article, Blog and Comment | read the error on first run and compare |
| Cart: create, lines add, update, remove, attributes, discount codes, buyer identity | `lib/cart/*`, `routes/cart.*`, `routes/discount.$code.tsx` | `unauthenticated_write_checkouts` and `unauthenticated_read_checkouts` | confirmed ("Write access to Cart", "Read access to Cart") |
| Cart buyer identity with customer fields (`buyerIdentity { customer { ... } }` in the cart fragment) | `lib/fragments.ts` | `unauthenticated_read_customers` **only if** Shopify returns an access error; we sign in with the Customer Account API, not Storefront customer tokens | `[NOT SEEN]`: enable only on evidence |
| Customer privacy / consent banner (Hydrogen consent) | `lib/analytics/privacy.ts`, `PUBLIC_CHECKOUT_DOMAIN` | no scope listed; the checkout domain variable must be right | `[NOT SEEN]` |
| **Not used, leave off** | selling plans, bundles, Shop Pay Installments pricing, customer tags | `unauthenticated_read_selling_plans`, `unauthenticated_read_bundles`, `unauthenticated_read_shop_pay_installments_pricing`, `unauthenticated_read_customer_tags` | grep found no use |

**Admin API app (separate from the storefront token; never in browser code).** A Dev Dashboard app with custom distribution on the client's store (legacy custom apps cannot be created since 2026-01-01, F-30, V-20). Scopes named in the repository docs, all `UNVERIFIED`: `read_orders` only, for the server token (webhook order read and guest lookup); `read_all_orders` only if the client approves a window longer than 60 days; the importer's own token in a developer's shell only: `read_products`, `write_products`, `read_metaobjects`, `write_files`, `write_publications` (with `--publication`), `read_metaobject_definitions`, `write_metaobject_definitions` (`CATALOG_IMPORT_GUIDE.md`, `RUNBOOKS.md` 6.2). Webhook topics the route handles: `orders/paid`, `orders/updated`, `orders/cancelled`, `refunds/create`, `fulfillments/create`, delivered to `https://<PROD>/webhooks/shopify` and verified with the app's client secret (`SHOPIFY_APP_CLIENT_SECRET`); no subscription exists yet (V-12, V-20).

Values we need: which channel (Q-003); the live domain; confirmation of who creates the Dev Dashboard app and approves the install (Q-022).

---

## 9. Post-purchase options (REQ-POST-001/002, P5B-11, SD-02, SD-03, CR-09, V-19)

**Facts (Shopify documentation, F-23, F-24).** Post-purchase checkout extensions are in beta; on a live store the app's developer must request access, with review "up to seven days"; **all merchants can install App Store apps that use them; only Plus merchants can install custom apps that use them.** Thank-you and order-status page extensions work on all plans except Starter. The post-purchase build guide does **not** mention headless checkouts, the Storefront API, Hydrogen or custom carts. Nothing in Shopify's documentation says whether a post-purchase page appears after a checkout opened from a Storefront-API cart (V-19).

**Candidates, from public listings read 2026-10-26** (not installed, not tested):

| App | What the listing says | Pricing as listed (USD) | Basic plan | Headless |
| --- | --- | --- | --- | --- |
| ReConvert Post Purchase Upsell (Upsell.com, `apps.shopify.com/reconvert-upsell-cross-sell`) | One-click post-purchase upsell and thank-you page offers; rating 4.8 from 3,121 reviews; no Built for Shopify badge seen | Free: up to 50 orders or $50 upsell revenue; $9.99/mo (51 to 100 orders); $19.99/mo (101 to 200); $39.99/mo (201 to 500); 14-day trial | Plans not listed; "checkout upsells need Shopify Plus" | No mention on the listing. A vendor help article for the older Upsell.com product claims post-purchase and thank-you offers work on headless stores because they extend Shopify Checkout (unofficial, vendor statement, legacy product, not verified) |
| One Click Upsell, Zipify OCU (`apps.shopify.com/zipify-oneclickupsell`) | Post-purchase one-click upsell, thank-you offers via PostProfit; rating 4.5 from 570 reviews; Built for Shopify badge | Free for development and partner stores only; $9.95/mo up to $200 monthly upsell revenue; $25/mo for $200 to $2,500; $149/mo above $2,500 (never past $999); 30-day trial | Plans not listed; in-checkout upsells need Plus | No mention |
| Aftersell (Rokt) | The Shopify listing page fetched says "This app is not currently available on the Shopify App Store"; the vendor's own price page lists Post-Purchase (upsells and thank-you offers) | Post-Purchase $34.99/mo for 200 orders; Complete $79.99/mo for 500 orders; Pre-Purchase $59.99/mo; Rokt Thanks (partner promotions on the confirmation page) free; 30-day trials | Not listed; checkout upsells are Plus only | No mention |
| Nosto post-purchase extension | Runs through Shopify's post-purchase framework; the merchant selects it as the "Post-purchase page" app in checkout settings (Nosto's docs; label `[ADMIN, NOT SEEN]`); not for secondary currencies; unsupported payment providers or gift-card-only orders can block it | Not read | Not read | Not addressed |

**Recommendation: drop REQ-POST-001 and REQ-POST-002 at launch (CR-09, "drop").** Reasons: (1) we cannot build our own on Basic, so the feature would be a third-party app the client pays for monthly (EXC-12) and Shopify must enable; (2) no source we found shows any of them works with a Storefront-API cart's checkout, and the only claim is an unofficial vendor statement; (3) a post-purchase line is added after payment, outside our server, so our rules (delivery eligibility, haul-away cap, protection linked to its item) and the detective check cannot govern what it sells, and a mattress-sized offer needs delivery rules; (4) paid tiers scale with orders or revenue and the client has not asked for a price; (5) a payment method that cannot be charged again later (a wallet or alternative method) may not show the offer `[NOT SEEN]`. Reinstating it later is cheap: V-19 takes ten minutes on a development store (section 10) and the free tier of ReConvert costs nothing to try there. **Install instead only if the client asks in writing after seeing the prices above and accepts that it is client-managed.** This recommendation is the owner's to take to the client; nothing was asked of the client yet.

**Draft change-request wording (SOW §11, CR-09, SD-02, SD-03; the owner edits and sends; price in brackets is the owner's):**

> Change request CR-09. Scope of Work section 5, "After purchase": the one-click offer between payment and the confirmation page (REQ-POST-002) and the follow-up offer on the order confirmation page (REQ-POST-001) are removed from the delivered scope. Reason: your Shopify plan is Basic. We cannot build checkout or post-purchase extensions on that plan, and the only route is a third-party app from the Shopify App Store, which you would pay for monthly, which Shopify must enable for your store, and which we have found no written evidence will work with our custom storefront's checkout. Effect: no post-purchase or confirmation-page offer at launch. Cost effect: [owner to state: credit, or none]. You may install an App Store app yourselves later; configuration and support by us would need a new change request. Please confirm in writing that you accept this change.

---

## 10. Dev store verification script (each open V-xx as a 10-minute check)

Prerequisites: the Admin token exists (B-02), the development store has the sample catalog (`OFFER_SETUP_DEVSTORE.md` section 2), the storefront runs against it, the store password is off for checkout checks. Dev store results prove behaviour only (V-26). Record every result in `progress/TEST_RESULTS.md` and update the V row in `TECH_FEASIBILITY.md` and `READINESS_CHECKLIST.md`. V-11 (Extend), V-13 (host), V-14 (resolved), V-22 (Klaviyo reference) and V-24 (Inbox, not verifiable) do not need this store and are left out.

| V | Check (about 10 minutes) | Pass looks like | Needs |
| --- | --- | --- | --- |
| V-01, V-21 | Read Settings, Plan in the client's admin as a collaborator and count staff seats used (read only). | Basic confirmed; collaborator access does not use a staff seat `[NOT SEEN]` | Client store access (B-02) |
| V-02, V-16 | Add a covered item with a coverage line (mock on): change the parent's quantity, remove the parent, reload; after a TOP order read the order lines for the parent relationship and line properties. | Child follows or is removed as F-26 says; relationship survives in the order | Extend mock on |
| V-03, V-27a | `OFFER_SETUP_DEVSTORE.md` section 5 gift and bundle steps. | Gift $0 in cart and checkout; allocation title readable; both automatic discounts combine as hoped; count against 25 | Section 6 discounts created |
| V-04 | Add one filter (comfort level) in the Search and Discovery app (name `[ADMIN, NOT SEEN]`), query a collection with `productFilters` through the Storefront API. | Filter values and counts return | Metafield definitions applied |
| V-05 | Create one entry of each metaobject type; fetch `metaobjects(type: "store", first: 5)` with the public token; check the `offer-only` tag sitemap exclusion at `/sitemap.xml` (V-27c). | Entries returned; offer-only products absent from the sitemap | `apply-definitions.mjs`, section 8 permissions |
| V-06a | Read Local delivery on the dev store and on a paid Basic trial store if the owner allows one. | Same screen, no plan error | Owner authorisation for any trial store |
| V-06b | Section 2.2 step 5: screenshot the Express Checkout area for an in-zone cart and a parcel cart. | Only Shop Pay with Local delivery (R-22) | Wallets active |
| V-06c | Try to read Local delivery postal codes through the Admin API (`deliveryProfiles` or locations; the field is `[NOT SEEN]`); if absent, record "export by hand". | Known answer either way | Admin token |
| V-06d | Query a cart's `deliveryGroups` with only a ZIP in `buyerIdentity.deliveryAddressPreferences` (F-20). | Options for a bare ZIP, or the documented refusal | Cart through the API |
| V-06e | Add a shipping rate conditioned on the ZIP in the dev admin. | Possible or not | Section 2.4 |
| V-07 | Request `storeAvailability` for a variant with stock at one location; compare with the Store metaobject's location name. | Right "ready for pickup" answer | Section 8 pickup scope, Store entry |
| V-08 | Section 7 verify row. | Sign-in, orders, address edit, quiz write all work | Tunnel, accounts on |
| V-09 | Place a guest order (TOP); call `POST /track-order` with its number and email; try one wrong email. | Right order found; same generic failure otherwise; rows older than 60 days not found | `read_orders` token |
| V-10, V-19 | Install the ReConvert free plan on the dev store, configure a one-click offer, run TOP from our cart and see whether the post-purchase page and the thank-you offer show. Uninstall after. | Offer shows (or does not) for a Storefront-API cart | Dev store only; no cost |
| V-12, V-20 | Create a webhook subscription for `orders/paid` pointing at a tunnel to `/webhooks/shopify`; place a TOP order; read `webhook.*` log lines; resend with a bad signature. | Valid delivery accepted; bad signature rejected; replay safe | Dev Dashboard app, secret in the shell |
| V-15 | Run the importer on 20 products and read the cost fields in the GraphQL response. | Stays under 100 points per second | Admin token |
| V-17 | Section 2.6 verify row. | Tag and email on the flagged order only; record which condition fields exist | Flow app installed |
| V-18 | Install one free quantity-limit app (CartWisp or Limit: Purchase Order Quantity), create a limit of 2, then add 3 through a direct Storefront API cart. | The app stops it, or it does not (Storefront carts) | Dev store; uninstall after |
| V-23 | Call the Judge.me API on the free plan from the adapter (`REVIEWS.md`). | Reviews returned, or the plan blocks it | Judge.me account |
| V-25 | On a product page with Shop Pay Installments active, look for financing text from our slot and read the Storefront field `shopPayInstallmentsPricing` if the scope is given. | Known: component or none | Shopify Payments active |
| V-27c | `products(query: "tag:offer-only OR tag:extend-coverage")` returns hidden products. | Returned | Section 8 tag scope |
| V-27e | After a TOP order with pickup and one with Local delivery, read the order: custom attributes, null shipping address for pickup, the shipping line title. | As the detective assumes | TOP |
| V-27f, g | `cartAttributesUpdate` with one key, read back; two tabs add a gift and an add-on in the same second. | Merge or replace known; `cart-changed` behaviour known | Cart API |
| V-28 | Check the listing of what is not built: pickup, guest lookup, account API flows, metaobject reads: they become V-05, V-07, V-08, V-09 above. | n/a | n/a |

---

## Counts and what needs the owner or the client

- `[ADMIN, NOT SEEN]` markers: 21 uses in the steps (counted 2026-10-26, legend and this line excluded). Re-count with `grep -o` after edits.
- `[NOT SEEN]` markers: 16 uses in the steps (same method).
- **Owner**: acceptance of ADR-0006 and the detective-only Flow rule (B-17, B-18); written go-ahead before anything on the client's store or any live test order; decision on CR-09; Admin token and Dev Dashboard app (B-02, Q-022); hosting and domain (Q-003); the free-parcel threshold question for the cart message.
- **Client**: every "Values we need" row above; payment accounts and activations (CLR-007); legal answers; tax registrations; brand kit (CLR-013); the Part 5 questions in `CLIENT_QUESTION_PACK.md` 5.10.

## Sources read 2026-10-26

Shopify help: checkout customize configurations and checkout extensibility pages; Local delivery; Pickup in store; Shopify Flow, its triggers, actions, conditions, Order created and Send internal email pages; notification templates edit page; Shop Pay Installments pages; Shopify Payments testing page; PayPal Express page; accelerated checkouts; Marketing opt-in page; discounts (Buy X get Y, Amount off products, automatic discounts, combining); taxes pages; shopify.dev: access scopes, Headless channel management, Customer Account API getting started and Hydrogen guide, post-purchase offer guide, `LineItem`; Affirm's Shopify configuration guide; ReConvert, Zipify OCU and Aftersell listings and price pages; installed `@shopify/hydrogen` 2026.4.7 type docs. Unofficial or second-hand and labelled where used: third-party posts on PayPal Wallet and Affirm labels, search summaries of two Shopify changelog entries, a vendor help article on headless compatibility, Nosto's documentation.
