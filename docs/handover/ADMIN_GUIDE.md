# Admin guide: running the store from Shopify admin

**Draft 1, dated 2026-10-12.** For the client's store managers, merchandisers and customer service. Deliverable H-03 (REQ-HAND-003, NFR-005).

## Read this first

**Status of this draft.** The storefront is still being built. As of this date, the project records show no development store connected and nothing live for shoppers. This guide describes how each task **will** work once the feature is built, using the project's design documents. It has **not** yet been tested by a non-developer, and it has no real screenshots yet. Treat every step as a draft until the final version is dated.

**Tags you will see**

| Tag | Meaning |
|---|---|
| `(verify on the dev store)` | The step relies on a Shopify screen or behavior we have not yet seen on a development store. Names and menu paths may differ. |
| `UNVERIFIED` | A whole feature (for example a Shopify Flow rule) that we have not yet proven works as described. |
| `PLANNED` | The feature is designed but not built yet. |
| `TO BE CONFIRMED` | A number or rule that is not decided yet. |
| `[Screenshot: ...]` | A real screenshot from a development store (with made-up data) goes here. |

**Shopify menu names change from time to time.** If you cannot find a screen, use the search at the top of Shopify admin `(verify on the dev store)`.

**What this guide does not cover:** server and hosting tasks (see `docs/handover/RUNBOOKS.md`, for developers); payment, tax and shipping-rate settings other than the delivery zone; order fulfillment in general; email and SMS marketing (Klaviyo); analytics; writing page text; Extend claims (Extend handles them).

**Who to call** (filled in at handover, deliverable H-05)

| Situation | Contact |
|---|---|
| The site or checkout is down, or shoppers cannot buy (a **Blocker** in the project's grading) | [Name, phone, email: TO BE FILLED AT HANDOVER] |
| Something does not work as this guide says (a **Major**) | [Name, email: TO BE FILLED AT HANDOVER] |
| Wording or a cosmetic problem (a **Minor**) | [Shared issue list: TO BE FILLED AT HANDOVER] |
| Shopify account, billing or Shopify features | Shopify support |
| Extend claims or contract questions | Extend |

## What works today and what is waiting

| Area | Status on 2026-10-12 | What it is waiting for |
|---|---|---|
| Product import tool | Written. Not yet run against a Shopify store. | A development store (no store is connected yet) |
| Prices, sales, products in admin | Standard Shopify. The storefront that shows them is being built. | Storefront build |
| Gift with purchase, bundles | Designed. The storefront part is `PLANNED`. | Storefront build; your launch rules |
| Add-on offers (haul-away, protectors, matching add-ons) | Designed. `PLANNED`. | Storefront build; your haul-away price and maximum |
| Haul-away over-limit check | `UNVERIFIED`. This replaces the "enforced inside checkout" sentence in the scope of work. | Your written acknowledgement (change request CR-08); a test of Shopify Flow on the development store |
| Stores, homepage, FAQs, menus | Designed. `PLANNED`. | Storefront build; your store list |
| Sleep quiz | Matching and question-checking logic written, with unit tests in the repository (not re-run for this draft). The quiz page is `PLANNED`. | Storefront build; your approval of the questions |
| Single delivery zone | Designed. `PLANNED`. | Your ZIP list, fee and free-delivery amount; your acknowledgement (CR-10, CR-12) |
| Extend accident protection | Built against a **practice copy** of Extend's documented system. **Switched off.** | An approved Extend account and Extend's written approval |
| Post-purchase and thank-you offers | **Not built by us.** An App Store app you would install and pay for. | Your decision (CR-09) |
| Financing messages | Hidden until a provider is active. | Provider details (CR-14) |

---

## 1. Where things live in Shopify admin

Shopify is the one place your data lives. The website reads it; it keeps no copy of its own. Most changes need no developer.

| What you want to change | Where to go in Shopify admin | Notes |
|---|---|---|
| Products, sizes, prices, sale prices, product facts | **Products** `(verify on the dev store)` | One product per mattress model; one variant per size |
| Collections | **Products > Collections** `(verify on the dev store)` | Collections fill themselves from rules (see 2.5) |
| Stores, homepage sections, promo tiles, FAQs, brands, quiz, offer rules, site settings, delivery zone | **Content > Metaobjects** `(verify on the dev store)` | Each is a list of entries (see the table below) |
| Gift and bundle promotions | **Discounts** `(verify on the dev store)` | Automatic discounts only |
| Menus | **Online Store > Navigation** `(verify on the dev store)` | Drives the main menu |
| Content pages (Delivery, Warranty, FAQ and so on) | **Online Store > Pages** `(verify on the dev store)` | |
| Store locations and pickup | **Settings > Locations** `(verify on the dev store)` | Pickup availability comes from stock at each location |
| Delivery ZIP list and fee | **Settings > Delivery and shipping > Local delivery** `(verify on the dev store)` | Also kept in a metaobject (see section 8) |
| Automatic flagging of orders | **Flow** app `(verify on the dev store)` | `UNVERIFIED` (see 4.6) |
| What shoppers declined | **Orders**, then the order page | See 4.5 |

[Screenshot: Shopify admin left menu with Products, Orders, Content, Discounts and Settings highlighted]

### The metaobject lists you will use

| Name in admin | What each entry is | Section |
|---|---|---|
| Brand | A brand: name, URL name ("slug"), logo, about text, warranty terms | 6.5 |
| FAQ | One question and answer, and where it applies | 6.3 |
| Store | One retail store: address, phone, hours, photo, pickup on or off | 5 |
| Homepage section | One block on the homepage | 6.1 |
| Promo tile | One tile inside a collection's product grid | 6.2 |
| Quiz question and Quiz option | A quiz question and one answer with its scoring rules | 7 |
| Offer rule | An add-on offer: haul-away, comfort-guarantee protector, matching add-ons | 4 |
| Site settings | One entry: promo bar text and link, free-delivery amount, haul-away maximum, financing text | 4.1, 6.4 |
| Delivery zone | One entry: the ZIP list, fee text, free-over amount, delivery promise wording | 8 |

[Screenshot: Content > Metaobjects list showing the ten entry types]

### Please do not change these

- **Product handles and SKUs** after the first import. The import tool uses them to recognize products. Renaming one makes the tool treat it as a new product or stop with an error.
- **The "Size" option name and the size names** (Twin, Twin XL, Full, Queen, King, California King, Split California King). Add-ons, gifts and the quiz match on them.
- **Products named "Extend-Protection-Plan-..."** and the **"Recycle and disposal service"** product's structure (one variant). Change only its price (see 4.1). Never add the Extend products to collections.
- **Field names or the structure of a metaobject list.** Edit entries, not the list definition.
- **Order note details** beginning `offer_declined_` or named `delivery_choice`. They are written by the website (see 4.5).

---

## 2. Update prices, sales and products

### 2.1 Pick one method for each change

| You want to... | Use |
|---|---|
| Change one or a few products | Shopify admin (2.2 to 2.4) |
| Change many prices, start or end a sale on a whole range, or add a new range | The product sheet and the import tool (2.6) |

**Do not mix the two on the same product.** The import tool makes the store match the sheet. If you edit a price in admin and later re-run an old sheet, the sheet's price replaces yours. After an admin edit, update the sheet too, or stop using the sheet for that product.

### 2.2 Change a price in admin

1. Open **Products** and click the product. `(verify on the dev store)`
2. In the variants list, click the size you want to change. `(verify on the dev store)`
3. Type the new **Price**.
4. Click **Save**.
5. Repeat for every size that changes.
6. Wait for the time in section 10.2, then open the product page on the website and add it to the cart. Check that the price matches.

[Screenshot: Product variant page with the Price and Compare-at price boxes]

The cart always shows the current Shopify price. Product and collection pages can show the old price for a short time (section 10.2).

### 2.3 Start a sale

The website shows a sale badge only when the **Compare-at price** is higher than the **Price**.

1. Open the product, then each size in turn. `(verify on the dev store)`
2. Put the regular price in **Compare-at price**.
3. Put the sale price in **Price**.
4. Click **Save**.
5. Check the product page and the collection page after the delay in section 10.2.

### 2.4 End a sale

1. Open the product, then each size in turn. `(verify on the dev store)`
2. Set **Price** back to the regular price.
3. Clear the **Compare-at price** box.
4. Click **Save**.

### 2.5 Add a new product in admin

The website sorts new products into collections, filters, the quiz and comparison **by their product facts**. A product with missing facts will not appear where you expect. Fill in all of them.

1. Open **Products > Add product**. `(verify on the dev store)`
2. Enter the title, description and images. Use text and images you have the rights to. Descriptions drafted for you need your approval before they are published.
3. Add an option named exactly **Size**. Add one variant per size, with a SKU and a price.
4. For each variant, fill in **Dimensions** (for example "60 x 80 in"). `(verify on the dev store)`
5. Fill in the product facts (below). They are in the **Metafields** area of the product page. `(verify on the dev store)`
6. Choose the **Brand** from the list of brands.
7. Fill in **Related foundations**, **Related protectors** and **Related bedding** if you want size-matched add-ons (section 4.3).
8. Make sure the product is available to the website's sales channel (the Hydrogen or Headless channel) and its status is Active. `(verify on the dev store)`
9. After the delay in section 10.2, find the product on its collection page and in the filters.

| Fact | Allowed values |
|---|---|
| Comfort level | Ultra Plush, Plush, Medium, Firm, Extra Firm |
| Mattress type | Memory Foam, Hybrid, Innerspring, Foam, Latex |
| Sleep positions (pick all that fit) | Back, Side, Stomach |
| Benefits (pick all that fit) | Cooling, Pressure Relief, Motion Separation, Back Support, Eco-Friendly |
| Product line | Free text (the line's name) |
| Height (inches) | A number |
| Delivery type | white-glove, parcel, both |
| Feature bullets | One short bullet per line |
| Specifications | A list of label and value pairs |
| Compare group | A name shared by similar products |

[Screenshot: Product page Metafields area with comfort level, type and delivery type filled in]

If a product does not show up in a filter, the most likely cause is a missing or misspelled fact, or a filter that was not set up in Shopify's **Search & Discovery** app `(verify on the dev store)`. The developer sets up the filters once, at launch.

### 2.6 Change many products with the sheet and the import tool

The tool reads your product sheet (a spreadsheet saved as CSV), compares it with the store and makes the store match. **It never writes anything unless you tell it to.** Exact commands and the sheet columns are in [scripts/catalog/README.md](../../scripts/catalog/README.md). Ask the person who set the tool up to run it with you the first time.

1. Edit the sheet. Keep each product's handle and SKUs unchanged.
2. Put any new images in the images folder, with the file names the sheet uses.
3. Run the tool as a **practice run** (this is the default). It reads the store and prints a plan.
4. Read the plan. Each product is one of: **create**, **update**, **unchanged** or **blocked**.
   - **Blocked** means something is wrong (for example a SKU already belongs to another product). The reason is printed. Fix the sheet and run the practice run again.
   - If the sheet has errors, the tool stops and imports nothing.
5. When the plan is what you expect, run it again with the **live** switch. For a first run, limit it to one or two products.
6. Open those products in admin and check them.
7. Keep the run record the tool prints. It lists what changed and the previous values, which is how you restore an old value by hand.

Good to know:

- **Sizes and images missing from the sheet are not deleted** unless you explicitly allow removals.
- A re-run is safe. Products that already match are left alone.
- If some products fail, the others still go through. The tool lists the failures. Fix and run again.
- The tool only touches stores on its allow-list. If it refuses, that is on purpose.
- An automatic "undo" is not described in the project documents. Ask the developer before you rely on one. `(verify with the developer)`

### 2.7 Take a product off the site

1. Open the product and change its status to **Draft** or **Archived**. `(verify on the dev store)`
2. Prefer this to deleting a product that has been sold before. `(verify on the dev store)`

---

## 3. Create and end promotions (gift with purchase and bundles)

### 3.1 How a promotion works

A promotion has two halves. Both must be set up, and both must be switched off when it ends.

| Half | Where | What it does |
|---|---|---|
| The price | **Discounts** in Shopify admin | Makes the gift free ($0) or takes the bundle saving off. **Only Shopify sets these prices.** The website never makes up a price. |
| The offer | The website's offer settings `PLANNED` | Decides what shoppers are shown: the gift picker or the "frequently bought together" bundle. |

The website adds the gift to the cart when the shopper picks a size. If the qualifying item leaves the cart, the website removes the gift too. Otherwise the shopper would be charged full price for it.

### 3.2 Check the 25-discount limit first

Shopify allows about **25 active automatic discounts at one time**, including those created by apps. This limit comes from secondary sources and is not yet proven on your store. `(verify on the dev store)`

1. Open **Discounts**. `(verify on the dev store)`
2. Filter to **Active** and **Automatic**. `(verify on the dev store)`
3. Count them. If you are near 25, tell the developer before you create more. Going past the limit needs a different approach and a change request.

### 3.3 Create a gift with purchase

You need, from your launch rules: the qualifying products or collection, the gift product with its sizes, and the dates.

1. Open **Discounts > Create discount > Automatic discount**, then choose the **Buy X get Y** type. `(verify on the dev store)`
2. **Title:** type the promotion name exactly as shoppers should see it. It appears on the $0 gift line in the cart and checkout.
3. **Customer buys:** choose the qualifying products or collection.
4. **Customer gets:** choose the gift product. Include **every size** of the gift. Set the discount to **free (100% off)**. `(verify on the dev store)`
5. **Quantity they get:** set the number of gifts per order (usually 1). **The website must allow exactly this many.** Any extra gift beyond this number would be charged full price, so the website never keeps more. Tell the developer the number so the offer matches.
6. Set start and end dates if the promotion is for a limited time.
7. Check how the discount combines with others. `(verify on the dev store)`
8. Save. Then ask the developer to add or enable the gift offer on the website `PLANNED`.
9. Do the **cart and checkout match check** (3.5).

[Screenshot: Automatic discount, Buy X get Y, gift product free]

### 3.4 Create a bundle ("frequently bought together")

1. Open **Discounts > Create discount > Automatic discount**. Use **Buy X get Y** (or an amount-off discount, as the launch rules say). `(verify on the dev store)`
2. **Title:** the bundle name shoppers should see on the discount line.
3. Choose the bundle items and the saving, as in your launch rules.
4. The saving should disappear when a bundle item is removed. Test that (3.5).
5. Save. Ask the developer to add or enable the bundle on the website `PLANNED`. The "Add all" button adds every item in the shopper's chosen size.
6. Do the **cart and checkout match check** (3.5).

### 3.5 Check that the cart equals checkout

Do this every time you create, change or end a promotion. **Do not place a real order and do not enter payment details.**

1. On the website, add a qualifying item to the cart. Pick the gift or add the bundle.
2. Write down, from the cart: each line's price, the discount lines and the subtotal.
3. Click **Proceed to checkout**. Follow the offer steps (accept or decline each).
4. On Shopify's checkout page, compare the same items: line prices, discount lines and subtotal. Shipping and tax appear only at checkout, so leave those out.
5. They must match exactly. The gift must show **$0.00** with the promotion name.
6. Remove the qualifying item from the cart. The gift and the saving must go with it.
7. Close the checkout page without paying.

If anything differs, see 3.7.

[Screenshot: Cart page and checkout page side by side with matching lines]

### 3.6 End a promotion

Do these steps **in this order**.

1. Ask the developer to switch off the offer on the website `PLANNED`, so shoppers are no longer shown it.
2. In **Discounts**, set an **end date** or deactivate the discount. Keep it rather than deleting it if you may run it again. `(verify on the dev store)`
3. Run the match check (3.5) with a fresh cart. The gift or bundle must no longer appear.

**Why this order.** If the discount ends while the website still offers the gift, a shopper could add a gift that is no longer free.

### 3.7 If the cart and checkout do not match

1. Deactivate that discount in **Discounts** at once.
2. Do not run the promotion again.
3. Tell the developer which promotion, what the cart showed and what checkout showed. Send screenshots with no customer details.

---

## 4. Manage add-on and service offers

Offers appear on the website before checkout. They arrive at checkout as ordinary order lines.

| Offer | Shopper sees | Order line |
|---|---|---|
| Comfort guarantee | A mattress protector in the mattress's size | The protector, at its price |
| Haul-away and recycling | A choice of how many old pieces to remove | "Recycle and disposal service" times the number of pieces |
| Matching add-ons | Foundations, protectors, pillows and bedding that fit the mattress's size | Ordinary products |

Offer rules are saved as data in **Content > Metaobjects > Offer rule**, so changing one needs no developer visit `PLANNED`. Each rule has a name, a type, what triggers it (a collection or a product), the products offered, a maximum quantity and an **Enabled** switch.

### 4.1 Haul-away: price and maximum pieces

**Price**

1. Open **Products** and find **Recycle and disposal service**. `(verify on the dev store)`
2. Change the **Price** of its one variant. Save.
3. Check the price on the website's haul-away step.

**Maximum pieces**

1. Open **Content > Metaobjects > Site settings** and click the entry. `(verify on the dev store)`
2. Change **Haul-away maximum pieces**. Save.
3. **Also change the same number in the Shopify Flow rule** (see 4.6). The two must always be equal.

   > `TO BE CONFIRMED`: the design documents also give the Offer rule a "maximum quantity" field. The developer will confirm which field is the real one before launch. Until then, keep both equal if both exist.

**Switch haul-away off.** Set the maximum to 0, or disable the haul-away Offer rule. The website then stops offering it and removes it from carts that have it. `PLANNED`

**Who is offered haul-away.** Only shoppers who chose **in-home delivery** in the website's delivery step and whose ZIP code is **inside the delivery zone**. A shopper who chose pickup, or whose ZIP is outside the zone, is not offered it.

### 4.2 Comfort-guarantee protectors

The shopper is offered a protector in **the same size as the mattress** they are buying.

1. Make sure there is one protector variant for each mattress size, with the size names exactly as in 2.5.
2. Open the **Offer rule** of type "comfort protector" `PLANNED` and check: which mattresses or collections trigger it, which protector products it offers, and that **Enabled** is on.
3. Add a qualifying mattress to a test cart. In the pre-checkout step, check the protector shown is the right size.

### 4.3 Matching add-ons (foundations, protectors, pillows, bedding)

The website offers the add-ons you list on each mattress, **matched to the mattress size**.

1. Open the mattress product. `(verify on the dev store)`
2. In **Related foundations**, **Related protectors** and **Related bedding**, pick the products to offer. `(verify on the dev store)`
3. Make sure each add-on has a variant with the **same size name** as the mattress (Queen with Queen). A spelling difference means no offer is shown.
4. Check on the website: change the mattress size and confirm the offered add-on changes with it.

An add-on with no variant for the chosen size is not offered. Unavailable variants are never offered.

### 4.4 Free-delivery message

The cart shows progress toward free delivery. The amount is **Free delivery threshold** in **Site settings**. Keep it equal to the free-over amount in the **Delivery zone** entry and in the Local delivery price rule (section 8).

### 4.5 See which offers a shopper declined

When a shopper declines an offer step, the order records it, so customer service can see it later.

1. Open the order in **Orders**.
2. Look in the order's **Additional details** or notes area. `(verify on the dev store)`
3. You may see these entries:

| Entry | Meaning |
|---|---|
| `offer_declined_comfort_guarantee` = yes | The shopper declined the protector offer |
| `offer_declined_haul_away` = yes | The shopper declined haul-away |
| `offer_declined_protection` = yes | The shopper declined accident protection |
| `delivery_choice` = in-home or pickup | What the shopper chose in the website's delivery step |

A value of "no" means the shopper accepted after first declining. Do not edit these entries.

[Screenshot: Order page showing the declined-offer entries]

### 4.6 The haul-away over-limit check (staff keep this in step)

**Why it exists.** The scope of work says Shopify enforces the haul-away maximum inside checkout. On your Shopify Basic plan that is not possible (it needs Shopify Plus). Instead the website enforces the maximum in layers **before** checkout. One gap remains: someone who builds a cart by calling Shopify's public interface directly could ask for more pieces than the maximum. They would pay for every piece, so the money risk is low, but the order should be corrected by staff. To catch these orders, an automatic check runs **after** the order is placed. **This replacement has not been acknowledged by you yet** (change request CR-08).

**How the check works** `UNVERIFIED`

- A Shopify Flow rule runs when an order is created. If the haul-away quantity is higher than the maximum, **or** the order has haul-away but the delivery method is pickup or parcel, it tags the order and sends an internal email.
- The project documents say Flow is free on Basic. Whether Flow can test the quantity on a line and send an internal email on your plan has **not been proven**. If it cannot, the developer will use a website check instead, or give you a report to run by hand. `PLANNED`
- The tag name and who receives the email are `TO BE CONFIRMED` (task P5B-05).

**What you see and do when an order is flagged**

1. You receive an internal email, or you see the flag tag on the order in **Orders**. `UNVERIFIED`
2. Open the order.
3. Find the line **Recycle and disposal service**. Read its quantity.
4. Compare it with the maximum in **Site settings**.
5. Check the delivery method on the order. In-home delivery is correct. Pickup or parcel with a haul-away line is a mismatch.
6. Contact the customer if needed and decide what to do under your own policy: `[Client policy: TO BE DEFINED, for example keep the order as paid, or reduce the quantity and refund the difference]`.
7. To change the quantity or refund, use Shopify's order edit and refund tools. `(verify on the dev store)`
8. Mark the order as handled the way you agree (remove the tag or add a note). `TO BE CONFIRMED`
9. If you see several flagged orders, tell the developer. It may mean someone is bypassing the site.

**Keeping the number in step (your job)**

| Where the maximum lives | Who changes it |
|---|---|
| **Site settings > Haul-away maximum pieces** | You |
| The number inside the Flow rule's condition | You, by hand, at the same time |

[Screenshot: Flow workflow with the haul-away quantity condition, UNVERIFIED]

To change the number in Flow:

1. Open the **Flow** app. `(verify on the dev store)`
2. Open the workflow for haul-away over-limit orders (name `TO BE CONFIRMED`). `UNVERIFIED`
3. Open the condition that tests the haul-away quantity and change the number. `UNVERIFIED`
4. Save and make sure the workflow is on. `UNVERIFIED`

A **reconciliation report** that compares the two numbers is `PLANNED`. Ask the developer to run it after any change. As an extra safety net you may install a quantity-limit app from the Shopify App Store at your own cost; that is optional (change request CR-13) and not yet checked on your plan.

---

## 5. Manage stores, hours and pickup locations

Each retail store is one **Store** entry (**Content > Metaobjects > Store**). `(verify on the dev store)`

### 5.1 Add or edit a store

1. Open **Content > Metaobjects > Store**. `(verify on the dev store)`
2. Click **Add entry**, or open the store to edit.
3. Fill in: name, a short URL name ("slug", lowercase with hyphens), address lines, city, state, postal code, phone and a photo.
4. Fill in **Latitude** and **Longitude**. The map needs them. If you change the address, change these too. `(verify on the dev store)`
5. Fill in **Opening hours**. The exact format is `PLANNED` and will be explained when the store locator is built; this guide will be updated with a worked example.
6. Switch **Pickup enabled** on or off.
7. Enter **Shopify location** exactly as the matching location is named in Settings (see 5.2).
8. Save, wait for the delay in section 10.2, then open the store's page on the website. Check the address, today's hours, the phone number and the directions link.

[Screenshot: A Store entry with all fields]

### 5.2 Set up pickup for a store

Pickup availability on a product page comes from **stock at that store's Shopify location**.

1. Open **Settings > Locations**. Create or open the location for the store. `(verify on the dev store)`
2. Make sure the location is set up for **local pickup** and has the "ready for pickup" email you want. `(verify on the dev store)`
3. Put the stock for each size at that location. `(verify on the dev store)`
4. In the Store entry, set **Pickup enabled** and the **Shopify location** name to match.
5. Check a product page: choose the store as "my store" and confirm "ready for pickup" or "not available" is correct for a size you know the stock of. `PLANNED`

**All items in one order must ship from one location** for local delivery (see section 8).

### 5.3 Close or hide a store

Open the Store entry and switch **Pickup enabled** off. To remove the store page, ask the developer how a store is hidden. `TO BE CONFIRMED`

---

## 6. Edit homepage sections, promo tiles, collection FAQs and menus

### 6.1 Homepage sections

Each block on the homepage is one **Homepage section** entry. `PLANNED`

| Field | What it does |
|---|---|
| Type | Which kind of block (sale banner, shop by size, brand tiles, category tiles, financing banner, store and chat call-outs, signup block). The allowed types are fixed when the homepage is built. |
| Heading, Body, Image | The content |
| Link | Where it goes. Use a path such as `/collections/queen-mattresses` or a full `https://` address. The site checks links, and a link that fails the check may not be shown. |
| Order | A number. Lower numbers appear higher on the page. |
| Enabled | Off hides the block without deleting it |

**To reorder:** change the **Order** numbers. Leave gaps (10, 20, 30) so you can slot a block between two others.
**To hide a block:** switch **Enabled** off.
**To add a block:** click **Add entry**, choose the type, fill the fields, set the Order and switch Enabled on.

After saving, wait for the delay in section 10.2 and look at the homepage on a phone-sized window as well as a desktop. Optional fields can be empty; the block should still look right.

[Screenshot: Homepage section entry]

### 6.2 Promo tiles in a collection

A **Promo tile** is a picture and heading placed inside a collection's product grid.

1. Open **Content > Metaobjects > Promo tile**. `(verify on the dev store)`
2. Click **Add entry** and choose the **Collection** it belongs to.
3. Set **Position in grid** (for example 5 puts it in the fifth position).
4. Add the **Image**, **Heading** and **Link**. Switch **Enabled** on.
5. Open the collection on the website and check the tile's place and that the grid looks right.

### 6.3 Collection FAQs

1. Open **Content > Metaobjects > FAQ** and click **Add entry**.
2. Type the **Question** and **Answer**.
3. In **Scope**, put the handle of the collection or product it belongs to. The exact values are agreed when the collection pages are built. `TO BE CONFIRMED`
4. Check the collection page: the FAQ opens and closes with the keyboard.

### 6.4 Promo bar and free-delivery amount

Open **Site settings**. Edit **Promo bar text** and **Promo bar link**. Keep the link a path on your site or a full `https://` address.

### 6.5 Brands

Open **Content > Metaobjects > Brand**. Edit the logo, about text and warranty terms. The change shows on the brand page **and** on every product page of that brand. The **slug** must stay equal to the entry's handle, because the import tool finds brands by it.

### 6.6 Menus

The main menu and mega menu come from Shopify's menus.

1. Open **Online Store > Navigation**. `(verify on the dev store)`
2. Open the main menu.
3. Add, rename, move or remove menu items. Drag items under another to make a sub-menu. `(verify on the dev store)`
4. Save.
5. After the delay in section 10.2, check the website's menu on desktop and on a phone. Click every new link. None should lead to a "not found" page.

[Screenshot: Navigation main menu being edited]

### 6.7 Content pages

The 15 content pages (Delivery and shipping, Financing, Comfort guarantee, Price guarantee, Warranty and returns, FAQ, About, Contact, Size guide, Comfort guide, Mattress types guide, Adjustable base guide, Privacy policy, Terms, Accessibility) are edited in **Online Store > Pages**. `(verify on the dev store)` Writing the text is your responsibility; the project only loads it.

---

## 7. Edit the sleep quiz

The quiz has **6 to 8 questions**. Each question has **2 to 8 answers**, and each answer carries **scoring rules** saying which products it favors. You manage this in **Content > Metaobjects**, under **Quiz question** and **Quiz option**. `PLANNED`

Approve any change with the people who own your product advice. The quiz is shopping guidance, not medical advice, and the results page says so.

### 7.1 Edit a question

1. Open **Quiz question** and click the question. `(verify on the dev store)`
2. Edit the **Question** (up to 200 characters) and the **Help text** (up to 300).
3. Change **Order** to move it. The lowest number comes first.
4. Switch **Allow several answers** on only if shoppers may pick more than one.
5. Save and take the quiz yourself (7.4).

### 7.2 Edit an answer and its scoring

Each answer is a **Quiz option**: a **Label** (up to 80 characters) and **Scoring rules**. A rule says what the answer does to the products:

| Rule | What it does | Limits |
|---|---|---|
| Boost | Products with that fact score higher | Fact: comfort level, mattress type, sleep position or benefit. Weight: a whole number from 1 to 10 |
| Penalty | Products with that fact score lower | Weight from -1 to -10. Not 0 |
| Exclude | Products with that fact are removed from the results | |
| Size | Limits results to a size | One of the seven sizes in 2.5 |
| Budget | Limits price | Whole dollars, a minimum and/or maximum. The maximum is above 0 and not below the minimum |

- Use only the values in the table in 2.5 (for example "Memory Foam", "Pressure Relief"). Capitals and hyphens are forgiven; other words are not.
- Up to 12 rules per answer.
- A fill-in template for the rules field will be added here when its final format is fixed (task P3A-02). Until then, ask the developer to enter or review scoring rules. `TO BE CONFIRMED`

### 7.3 What a bad mapping does

| Mistake | What happens | Do you see an error? |
|---|---|---|
| A rule with a misspelled or unknown value or weight | That one rule is **ignored**. The answer then scores less, or nothing. | **No.** Only the developer's logs show a warning. |
| A question with fewer than 2 valid answers | The whole question is **dropped** from the quiz. | No |
| More than 8 questions | Only the first 8 are used. | No |
| Fewer than 6 questions | The quiz still works but is shorter than the scope of work says. | No |
| Two questions or answers with the same internal ID | The second is dropped. | No |
| A rule that is valid but **wrong** (for example boosting "Extra Firm" for "I want soft") | The quiz recommends the wrong mattresses. | **No.** This is the most harmful mistake. |
| An Exclude rule on a fact most products have | Fewer than three results, or none. | No |
| Very high weights on one answer | That answer overpowers all the others. | No |

The quiz never crashes because of a bad edit; it just gives worse advice. **So always test after every edit.**

When you change questions or rules, shoppers' previously saved results are treated as out of date, so they are not shown as current. `PLANNED`

### 7.4 Test the quiz after an edit

1. Open the quiz on the website after the delay in section 10.2.
2. Answer as three different kinds of shopper (for example: side sleeper who sleeps hot and wants plush; back sleeper who wants firm; couple on a budget).
3. For each, check that the three results make sense and each says why it matched.
4. Check you get exactly three results (fewer only if the catalog has fewer matching mattresses). Out-of-stock and wrong-size mattresses are left out.
5. If a result looks wrong, undo your last edit and tell the developer.

---

## 8. The single delivery zone

For now there is **one** in-home delivery zone (an owner decision, change request CR-12). More zones are a change request. The ZIP list, fee and free-delivery amount come from you (CLR-009). Until you supply them, this section is `PLANNED`.

### 8.1 Why the list is kept in two places

| Place | What uses it |
|---|---|
| **Content > Metaobjects > Delivery zone > Postal codes** | The website: the ZIP check in the header, the delivery promise on product pages, the haul-away offer |
| **Settings > Delivery and shipping > Local delivery** | Shopify's checkout: it decides whether in-home delivery is offered and at what price |

The website cannot read Shopify's list, and checkout cannot read the website's. So **you update both, with the same codes, every time.**

If the two lists differ:

- A ZIP on the website list but not in Local delivery: the site promises in-home delivery, then checkout does not offer it.
- A ZIP in Local delivery but not on the website list: checkout offers it, but the site says it is not available and does not offer haul-away.

### 8.2 Edit the ZIP list

1. **Before you start,** copy the current list from both places into a safe note (the "last good copy"). You can restore it if something goes wrong.
2. Open **Content > Metaobjects > Delivery zone**. `(verify on the dev store)`
3. Edit **Postal codes**. Separate codes with commas, spaces or new lines. A `*` at the end is a wildcard, for example `100*`. **Maximum 3,000 characters.**
4. Save.
5. Open **Settings > Delivery and shipping**, then the **Local delivery** area for your location. `(verify on the dev store)`
6. Replace the postal codes with **exactly the same list**. Shopify's limit is also 3,000 characters. Whether Shopify accepts the same `*` wildcard form is not yet proven; if it does not, write the full codes in both places. `(verify on the dev store)`
7. Save.
8. Ask the developer to run the **parity check**, which compares the two lists. `PLANNED` (task P5B-02)
9. Test: on the website enter one ZIP inside the zone and one outside. Inside should be offered in-home delivery and haul-away. Outside should not. Then go to checkout with an inside ZIP and confirm Local delivery is offered, and with an outside ZIP that it is not. `(verify on the dev store)`

[Screenshot: Settings > Delivery and shipping > Local delivery]
[Screenshot: Delivery zone entry with the Postal codes field]

### 8.3 The 3,000-character limit

A list of five-digit codes separated by commas holds roughly 400 to 430 codes (the project documents give both numbers). Wildcards such as `100*` save space. If your list is longer:

- Group codes with wildcards where every code in the group is delivered to.
- Or ask about splitting into more zones. That is a change request.
- If your zone is really whole states, a normal shipping rate may replace Local delivery and remove this limit. The developer will advise.

### 8.4 Fee and free delivery

Shopify's Local delivery has a zone price, an optional minimum order and up to three extra price rules. That covers "free above an amount, flat fee below". Keep these equal:

| Value | Where |
|---|---|
| Free-over amount | **Delivery zone > Free over**, **Site settings > Free delivery threshold**, and the price rule in Local delivery |
| Fee wording shoppers read | **Delivery zone > Fee text** and **Promise** wording (client-approved) |

### 8.5 What shoppers will notice

- At checkout the option appears under Shopify's own name, **Local delivery**, not "white-glove".
- Apple Pay, Google Pay and PayPal express buttons may not appear for orders in the zone. Shop Pay still works. This is documented by Shopify and still to be checked on your store (change request CR-10). `(verify on the dev store)`
- Everything in a local-delivery order must come from **one location with stock**, and parcel items cannot be combined with local-delivery items in one order. What to do with mixed carts is an open question for you.

---

## 9. Extend accident protection: what you see and do

**Status: switched off.** The feature is built against a practice copy of Extend's documented system. It goes live only when you have an approved Extend merchant account, Extend approves the website's design, and Extend answers some technical questions in writing. Without those, no Extend offers appear and nothing else on the site is affected.

### 9.1 What shoppers and you will see once it is live

- Coverage options and prices on the product page, in the cart and in a pre-checkout step. Extend's logo (or "Powered by Extend") and a link to the coverage terms are on every offer.
- On an order, a coverage line named **Extend-Protection-Plan-** followed by a price (for example `-14.99`), linked to the item it covers. Details such as the plan name are stored with the line. It cannot be bought alone.
- Extend, not the store, sends the customer their coverage details and **handles claims**. Send claim questions to Extend.

### 9.2 What staff must do

- **Mark covered items as fulfilled in Shopify.** Extend issues the customer's contract only when the item goes from unfulfilled to fulfilled. If you forget, the customer has no contract.
- **Refund or cancel in Shopify as usual.** The website tells Extend automatically. (Once the order sync is live.)
- **Do not edit, delete or add to collections** any "Extend-Protection-Plan-..." product.
- **Do not sell protection through draft orders or point of sale.** Extend's price-point setup does not support that.
- **Tell the developer before installing Extend's own Shopify app.** Two systems reporting the same order could double-report it.

### 9.3 Flagged mismatches and the reconciliation report

The website checks every order that has coverage. If something does not add up, it **does not send the line to Extend** and flags it for staff instead. The developer runs the **reconciliation report** on a schedule `PLANNED` (task P5A-10) and shares it. It lists order IDs and short reasons only, with no customer details.

| Report says | In plain words | What to do |
|---|---|---|
| Missing sync | Shopify has an order with coverage that Extend does not have | Give the order ID to the developer, who can re-send it (re-sending is safe) |
| Orphan coverage | A coverage line has no matching covered item (or Extend has a line Shopify does not) | Open the order and give the order ID to the developer |
| Price mismatch | The price paid for coverage does not match the plan it names | Open the order and give the order ID to the developer |
| Quantity mismatch | Coverage quantity differs from the covered item's quantity | Give the order ID to the developer |
| Status mismatch | Shopify and Extend disagree on whether the order is active, cancelled or refunded | Give the order ID to the developer |
| Contract missing | The item is fulfilled in Shopify but Extend issued no contract | Give the order ID to the developer; the developer contacts Extend if it persists |
| Flagged coverage | The coverage line failed a check (for example an unknown plan or duplicate coverage) | Open the order and give the order ID to the developer |
| Invalid order / unexpected Extend order | Data problem on one side | Give the order ID to the developer |

What to tell or refund the customer in each case (for example refund the coverage line, or keep it) is your policy to set. `[Client policy: TO BE DEFINED]` Whether Extend lets us read its own records back for this comparison is not confirmed, so the report may compare against an export from Extend's Merchant Portal. `UNVERIFIED`

---

## 10. Troubleshooting

### 10.1 Where to look first

Work down this list. Most problems stop at step 1 or 2.

1. **Is it just waiting?** Check the delay in 10.2. Wait that long, then reload with a fresh browser window.
2. **Is it switched on and published?** Product status Active and available to the website's sales channel; entry **Enabled** on; discount active and within its dates.
3. **Is the data complete and spelled right?** Product facts (2.5), size names, ZIP lists, slugs.
4. **Did you change one half of a pair?** Pairs: Price and Compare-at; Site settings maximum and Flow rule; metaobject ZIP list and Local delivery; discount and website offer; free-over amounts.
5. **Still wrong?** Undo your last change, then call (see "Who to call").

| What you see | Look first | Likely cause |
|---|---|---|
| Edit not on the website | 10.2 | Not enough time has passed |
| Product missing from a collection or filter | Product facts (2.5); status; sales channel | Missing or misspelled fact |
| Price on a collection page differs from the cart | 10.2 | Collection pages are cached; the cart is always current |
| Gift not offered | Discount active and dates; qualifying product; website offer enabled | One half missing |
| Gift charged full price, or cart total differs from checkout | 3.7 | Discount and offer out of step |
| Haul-away not offered | Shopper chose in-home delivery; ZIP in zone; maximum above 0; offer Enabled | Eligibility rule |
| Site says in-home delivery is available but checkout does not offer it (or the opposite) | Section 8.1 | The two ZIP lists differ |
| Add-on not offered | Size names match; add-on has a variant in that size | Spelling or missing size |
| Quiz gives odd or too few results | 7.3 and 7.4 | A rule was dropped or is wrong |
| No Extend offers | Section 9 | Feature is off, or the product is not in an eligible category, or no coverage price matches, or Extend is unreachable (offers are hidden by design) |
| Store page wrong | Store entry fields (5.1) | Missing latitude, longitude or hours |
| Import stops with errors | The printed report (2.6) | Sheet problem; nothing was imported |
| Checkout will not open, or shoppers cannot pay | n/a | **Blocker:** call the developer now |

### 10.2 How long edits take to appear

The website keeps copies of some Shopify data for a short time so pages load quickly. **The numbers below are not decided yet.** They are proposals from the architecture notes and are `TO BE CONFIRMED` in task P3B-01. The final guide will state the real times.

| What you changed | Appears on the website after |
|---|---|
| Menus, content pages, brands, stores, FAQs, quiz, offer rules, homepage sections, promo tiles, site settings | about **N** minutes `TO BE CONFIRMED` |
| Product details, collections, **prices and sales** | about **N** minutes `TO BE CONFIRMED` (kept short enough that price changes appear promptly; to be agreed with you) |
| Stock and pickup availability | about **N** minutes, shorter than the above `TO BE CONFIRMED` |
| Search suggestions | about **N** minutes, short `TO BE CONFIRMED` |
| The cart, your account, orders, and ZIP-based delivery answers | Not kept: always current |
| Shopify checkout settings and the Local delivery list | Not controlled by the website. `(verify on the dev store)` |

Tip: when you edit several things, make all the edits, then do all your checks once after the delay.

---

## 11. After handover: what you are responsible for

The project covers the build and the handover. These are **not included** afterward (exclusion EXC-13):

- **Ongoing maintenance, hosting upkeep and new features.** New features and changes to delivered ones start with a written change request.
- **Framework upgrades.** The storefront uses Shopify's Hydrogen framework, which is released on a calendar-versioned schedule (about quarterly) and needs periodic upgrades and security fixes. Arrange for a developer or a maintenance agreement to apply them.
- **If you chose a server of your own (Option B):** operating-system updates, security patches, backups, scaling and the server bill are yours or your maintenance provider's. Under Shopify's Oxygen hosting (Option A), Shopify looks after the hosting.
- **Third-party fees** continue and are billed to you directly: Shopify, any apps (including Shopify Flow add-ons, quantity-limit and post-purchase apps, reviews and chat), Extend, Affirm, payment processing, and the Option B server.
- **Provider-dependent features** (Extend, Affirm, Shopify's post-purchase offers) go live only once those providers approve you. See the table near the top.
- **Content and rights.** You hold the rights to the images and text you supply. Keep your product sheet, ZIP list and a record of promotion rules up to date.
- **Keep the pairs in step** (10.1, step 4). The website cannot do this for you.

---

## References for the project team

REQ-HAND-003, REQ-CAT-009, REQ-PROMO-001 to REQ-PROMO-003, REQ-PRE-002, REQ-PRE-003, REQ-PRE-005, REQ-CAT-007, REQ-CAT-008, REQ-LOC-002, REQ-HOME-001, REQ-COL-003, REQ-COL-004, REQ-QZ-004, REQ-DEL-001, REQ-EXT-003, NFR-005, EXC-13; SD-01, SD-04, SD-07, SD-08; [SHOPIFY_DATA_MODEL](../architecture/SHOPIFY_DATA_MODEL.md), [BASIC_PLAN_WORKAROUNDS](../research/BASIC_PLAN_WORKAROUNDS.md), [SOW_DEVIATIONS](../requirements/SOW_DEVIATIONS.md), [EXTEND](../integrations/EXTEND.md), [HANDOVER](HANDOVER.md).

**Before this guide is final:** capture real screenshots from a development store; run every `(verify on the dev store)` step there; have a non-developer complete each task using only this guide; replace each `TO BE CONFIRMED`; record the client's acknowledgement of the haul-away, delivery-zone and post-purchase changes.
