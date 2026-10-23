# Admin guide: running the store from Shopify admin

**Draft 2, dated 2026-10-15** (draft 1 was 2026-10-12; sections 1, 4.3, 6.6 and 10 updated 2026-10-23 for the menu, the product-page add-ons box and the cache times; still no real screenshots and no non-developer test). For the client's store managers, merchandisers and customer service. Deliverable H-03 (REQ-HAND-003, NFR-005).

## Read this first

**Status of this draft.** The storefront is partly built, but **no development store is connected and nothing is live for shoppers**. Everything built so far was checked only against test data, simulated Shopify answers and a public demo store, never against your Shopify store. This guide was updated to match what the code does on 2026-10-15. It has **not** been tested by a non-developer, and it has no real screenshots yet. Treat every step as a draft until the final version is dated.

**Important correction to draft 1.** Several things draft 1 described as "edit it in Shopify admin" are **not connected to Shopify admin yet**. The website currently reads only these from Shopify admin: products and variants, the product facts (metafields), collections, brands, homepage sections, promo tiles, FAQs, menus, pages, and three fields of the Site settings entry (promo bar text, promo bar link, support phone). The **store locator, the sleep quiz and the compare page still use built-in sample data** (editing Store or Quiz entries in Shopify changes nothing yet), and the **offer rules (gift, bundle, comfort protector, add-ons, haul-away, free-delivery amount) and the delivery zone are held in a developer-managed setting**, not in Shopify admin. The other Site settings fields (haul-away maximum, financing copy, Extend mirror) are not read. Each section below says which case applies.

**Tags you will see**

| Tag                                      | Meaning                                                                                                                       |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `(verify on the dev store)`              | The step relies on a Shopify screen or behavior we have not yet seen on a development store. Names and menu paths may differ. |
| `BUILT, AWAITING DEV-STORE VERIFICATION` | The website side exists and passes automated tests on test data. Not yet seen working against a real Shopify store.           |
| `NOT CONNECTED YET`                      | The Shopify admin entry can be created, but the website does not read it yet.                                                 |
| `DEVELOPER-MANAGED`                      | Today a developer changes it (and redeploys); you cannot change it in Shopify admin.                                          |
| `UNVERIFIED`                             | A whole feature (for example a Shopify Flow rule) that we have not yet proven works as described.                             |
| `PLANNED`                                | The feature is designed but not built yet.                                                                                    |
| `TO BE CONFIRMED`                        | A number or rule that is not decided yet.                                                                                     |
| `[Screenshot: ...]`                      | A real screenshot from a development store (with made-up data) goes here.                                                     |

**Shopify menu names change from time to time.** If you cannot find a screen, use the search at the top of Shopify admin `(verify on the dev store)`.

**What this guide does not cover:** server and hosting tasks (see `docs/handover/RUNBOOKS.md`, for developers); payment, tax and shipping-rate settings other than the delivery zone; order fulfillment in general; email and SMS marketing (Klaviyo); analytics; writing page text; Extend claims (Extend handles them).

**Who to call** (filled in at handover, deliverable H-05)

| Situation                                                                                     | Contact                                        |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| The site or checkout is down, or shoppers cannot buy (a **Blocker** in the project's grading) | [Name, phone, email: TO BE FILLED AT HANDOVER] |
| Something does not work as this guide says (a **Major**)                                      | [Name, email: TO BE FILLED AT HANDOVER]        |
| Wording or a cosmetic problem (a **Minor**)                                                   | [Shared issue list: TO BE FILLED AT HANDOVER]  |
| Shopify account, billing or Shopify features                                                  | Shopify support                                |
| Extend claims or contract questions                                                           | Extend                                         |

## What works today and what is waiting

| Area                                                            | Status on 2026-10-15                                                                                                                                                                                                                                                                                                                                                                                                              | What it is waiting for                                                   |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Product import tool and definitions tool                        | Written and tested against a simulated Shopify. Not yet run against a Shopify store.                                                                                                                                                                                                                                                                                                                                              | A development store (none is connected yet)                              |
| Prices, sales, products, collections, filters                   | Standard Shopify. Product, collection, search and cart pages are built and read them. `BUILT, AWAITING DEV-STORE VERIFICATION`                                                                                                                                                                                                                                                                                                    | A development store; filters need Search & Discovery set up              |
| Homepage sections, promo tiles, brands, FAQs, menus, pages      | Read from Shopify admin; built. `BUILT, AWAITING DEV-STORE VERIFICATION`                                                                                                                                                                                                                                                                                                                                                          | A development store; your content                                        |
| Promo bar and support phone                                     | Read from the **Site settings** entry in Shopify admin; **hidden** while the fields are empty. `BUILT, AWAITING DEV-STORE VERIFICATION` (section 6.4)                                                                                                                                                                                                                                                                             | A development store; your wording and number (B-15)                      |
| Guarantee strip, Financing and Warranty links                   | **Hidden** until you supply the wording.                                                                                                                                                                                                                                                                                                                                                                                          | Your content (B-15)                                                      |
| Gift with purchase, bundles                                     | Cart pickers built; **the gift picker is off by default** until the gift discount is verified on a development store. `DEVELOPER-MANAGED` rules                                                                                                                                                                                                                                                                                   | A development store; your launch rules                                   |
| Add-on offers (protectors, matching add-ons), comfort guarantee | Cart steps and pickers built. `DEVELOPER-MANAGED` rules. Wording is placeholder text for your approval.                                                                                                                                                                                                                                                                                                                           | A development store; your approval of the wording                        |
| Haul-away and delivery choice                                   | Built; the maximum, price and ZIP list are `DEVELOPER-MANAGED`. Haul-away blocks checkout until the shopper has saved a ZIP.                                                                                                                                                                                                                                                                                                      | A development store; your ZIP list, fee, amounts (CR-10, CR-12)          |
| Haul-away over-limit check                                      | A check that runs after each paid order and a report a developer can run are **built** (replacing the Flow rule idea). Not yet run against a real order. This replaces the "enforced inside checkout" sentence in the scope of work.                                                                                                                                                                                              | Your written acknowledgement (change request CR-08); a development store |
| Store locator                                                   | Pages built on **sample stores**. `NOT CONNECTED YET`                                                                                                                                                                                                                                                                                                                                                                             | Store reader (P3A-07); your store list                                   |
| Sleep quiz, compare                                             | Pages built on **sample data**. `NOT CONNECTED YET`                                                                                                                                                                                                                                                                                                                                                                               | Reading quiz and products from Shopify; your approval of the questions   |
| Customer accounts                                               | Pages exist on Shopify's template: sign in and out, a list of the shopper's orders (20 per page, search by order name or confirmation number) and one order's details, editing first and last name, and adding, changing and deleting addresses. Error messages are fixed wording, and account pages are never cached. Not tested with a real sign-in, and the look is still the plain template. Not yet verified against a store | A development store with new customer accounts enabled (V-08); P6-07     |
| Extend accident protection                                      | Built against a **practice copy** of Extend's documented system. **Switched off.**                                                                                                                                                                                                                                                                                                                                                | An approved Extend account and Extend's written approval                 |
| Post-purchase and thank-you offers                              | **Not built by us.** An App Store app you would install and pay for.                                                                                                                                                                                                                                                                                                                                                              | Your decision (CR-09)                                                    |
| Financing messages, reviews, analytics, chat, signup            | **Not built** (financing hidden until a provider is active).                                                                                                                                                                                                                                                                                                                                                                      | Provider details (CR-14) and later phases                                |

---

## 1. Where things live in Shopify admin

Shopify is the one place your data lives. The website reads it; it keeps no copy of its own. Most changes need no developer.

| What you want to change                                                                               | Where to go in Shopify admin                                                      | Notes                                                 |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Products, sizes, prices, sale prices, product facts                                                   | **Products** `(verify on the dev store)`                                          | One product per mattress model; one variant per size  |
| Collections                                                                                           | **Products > Collections** `(verify on the dev store)`                            | Collections fill themselves from rules (see 2.5)      |
| Stores, homepage sections, promo tiles, FAQs, brands, quiz, offer rules, site settings, delivery zone | **Content > Metaobjects** `(verify on the dev store)`                             | Each is a list of entries (see the table below)       |
| Gift and bundle promotions                                                                            | **Discounts** `(verify on the dev store)`                                         | Automatic discounts only                              |
| Menus                                                                                                 | **Online Store > Navigation** `(verify on the dev store)`                         | Drives the main menu only once a developer switches it on (section 6.6) |
| Content pages (Delivery, Warranty, FAQ and so on)                                                     | **Online Store > Pages** `(verify on the dev store)`                              |                                                       |
| Store locations and pickup                                                                            | **Settings > Locations** `(verify on the dev store)`                              | Pickup availability comes from stock at each location |
| Delivery ZIP list and fee                                                                             | **Settings > Delivery and shipping > Local delivery** `(verify on the dev store)` | Also kept in a metaobject (see section 8)             |
| Flagged orders                                                                                        | Reported by the developer (logs and a report), not by Shopify Flow                | See 4.6                                               |
| What shoppers declined                                                                                | **Orders**, then the order page                                                   | See 4.5                                               |

[Screenshot: Shopify admin left menu with Products, Orders, Content, Discounts and Settings highlighted]

### The metaobject lists you will use

The developer creates these lists once with `node scripts/shopify/apply-definitions.mjs` (see [scripts/shopify/README.md](../../scripts/shopify/README.md)); the definitions have not yet been created on any store. "Read by the website" is the state on 2026-10-15.

| Name in admin                 | What each entry is                                                                                         | Read by the website today?                                                                                                                                 | Section  |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Brand                         | A brand: name, URL name ("slug"), logo, about text, warranty terms                                         | Yes. `BUILT, AWAITING DEV-STORE VERIFICATION`                                                                                                              | 6.5      |
| FAQ                           | One question and answer, and where it applies                                                              | Yes, when attached to a product or collection through the FAQs field (see 6.3). `BUILT, AWAITING DEV-STORE VERIFICATION`                                   | 6.3      |
| Store                         | One retail store: address, phone, hours, photo, pickup on or off                                           | No. The locator shows sample stores. `NOT CONNECTED YET`                                                                                                   | 5        |
| Homepage section              | One block on the homepage                                                                                  | Yes. `BUILT, AWAITING DEV-STORE VERIFICATION`                                                                                                              | 6.1      |
| Promo tile                    | One tile inside a collection's product grid                                                                | Yes. `BUILT, AWAITING DEV-STORE VERIFICATION`                                                                                                              | 6.2      |
| Quiz question and Quiz option | A quiz question and one answer with its scoring rules                                                      | No. The quiz uses a built-in default. `NOT CONNECTED YET`                                                                                                  | 7        |
| Offer rule                    | An add-on offer: haul-away, comfort-guarantee protector, matching add-ons                                  | No. Rules are `DEVELOPER-MANAGED` (see section 4)                                                                                                          | 4        |
| Site settings                 | One entry: promo bar text, promo bar link, support phone, haul-away maximum, financing copy, Extend mirror | Partly. Promo bar text, promo bar link and support phone: yes (`BUILT, AWAITING DEV-STORE VERIFICATION`). The other three fields: no (`NOT CONNECTED YET`) | 4.1, 6.4 |
| Delivery zone                 | One entry: the ZIP list, fee text, free-over amount, delivery promise wording                              | No. The zone is `DEVELOPER-MANAGED` (see section 8)                                                                                                        | 8        |

[Screenshot: Content > Metaobjects list showing the ten entry types]

### Please do not change these

- **Product handles and SKUs** after the first import. The import tool uses them to recognize products. Renaming one makes the tool treat it as a new product or stop with an error.
- **The "Size" option name and the size names** (Twin, Twin XL, Full, Queen, King, California King, Split California King). Add-ons, gifts and the quiz match on them.
- **Products named "Extend-Protection-Plan-..."** and the **"Recycle and disposal service"** product's structure (one variant). Change only its price (see 4.1). Never add the Extend products to collections.
- **The tags `extend-coverage` and `offer-only`** (see 2.8). Removing one makes a service or protection product appear in search engines and the sitemap.
- **Product, variant, collection and discount IDs used in the offer rules.** The developer's offer setting names variants by their Shopify ID. Deleting and re-creating a gift, protector or haul-away variant breaks its offer until the developer updates the ID. Edit the existing product instead.
- **Field names or the structure of a metaobject list.** Edit entries, not the list definition.
- **Order note details** beginning `offer_declined_` or named `delivery_choice`. They are written by the website (see 4.5).

---

## 2. Update prices, sales and products

### 2.1 Pick one method for each change

| You want to...                                                               | Use                                         |
| ---------------------------------------------------------------------------- | ------------------------------------------- |
| Change one or a few products                                                 | Shopify admin (2.2 to 2.4)                  |
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

| Fact                                | Allowed values                                                                                                                                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Comfort level                       | Ultra Plush, Plush, Medium, Firm, Extra Firm                                                                                                                                                                  |
| Mattress type                       | Memory Foam, Hybrid, Innerspring, Foam, Latex                                                                                                                                                                 |
| Sleep positions (pick all that fit) | Back, Side, Stomach                                                                                                                                                                                           |
| Benefits (pick all that fit)        | Cooling, Pressure Relief, Motion Separation, Back Support, Eco-Friendly                                                                                                                                       |
| Product line                        | Free text (the line's name)                                                                                                                                                                                   |
| Height (inches)                     | A number                                                                                                                                                                                                      |
| Delivery type                       | white-glove, parcel, both                                                                                                                                                                                     |
| Feature bullets                     | One short bullet per line                                                                                                                                                                                     |
| Specifications                      | A list of label and value pairs                                                                                                                                                                               |
| Compare group                       | A name shared by similar products                                                                                                                                                                             |
| Extend category                     | Only for products that may be offered accident protection. Without a value the protection panel never appears for that product. The allowed category names come from Extend (Q-005) and are `TO BE CONFIRMED` |

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

### 2.8 Service, gift and protection products: the `offer-only` and `extend-coverage` tags

Some products exist only so the cart can hold them as ordinary order lines: the Extend protection price points, the "Recycle and disposal service", gift variants and comfort-guarantee protectors. They must be published to the website's sales channel, which would also let search engines list them. Two tags prevent that. **Add the tag when you create such a product:**

| Product                                                                                                | Tag               |
| ------------------------------------------------------------------------------------------------------ | ----------------- |
| Extend protection price-point products ("Extend-Protection-Plan-...")                                  | `extend-coverage` |
| Haul-away service, gift products and variants, comfort-guarantee protectors, any other service product | `offer-only`      |

What the tag does (`BUILT, AWAITING DEV-STORE VERIFICATION`): the website leaves the product out of its sitemap and marks its page "noindex". A product that is also sold normally (for example a protector people may buy on its own) should **not** carry `offer-only`. If you forget the tag the product is still correct in the cart; it can only show up in search results. Shopify's own "hide from search engines" setting is the preferred second control; whether the Storefront sitemap honours it is checked on the development store. The tag search itself is also unverified there (V-05).

---

## 3. Create and end promotions (gift with purchase and bundles)

### 3.1 How a promotion works

A promotion has two halves. Both must be set up, and both must be switched off when it ends.

| Half      | Where                                            | What it does                                                                                                                                                                                                                                                                                                                                                                                      |
| --------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The price | **Discounts** in Shopify admin                   | Makes the gift free ($0) or takes the bundle saving off. **Only Shopify sets these prices.** The website never makes up a price.                                                                                                                                                                                                                                                                  |
| The offer | The website's offer settings `DEVELOPER-MANAGED` | Decides what shoppers are shown: the gift picker or the "frequently bought together" bundle. Today these rules are in a developer-managed setting (`OFFER_CONFIG_JSON`) that names the qualifying products, the gift variants for each size, the maximum number of gifts and, for a bundle, the discount title. You send the developer the rule; the developer changes the setting and redeploys. |

The website adds the gift to the cart when the shopper picks a size. If the qualifying item leaves the cart, the website removes the gift too. Otherwise the shopper would be charged full price for it. **The gift picker is switched off** (a developer setting, `PUBLIC_GIFT_PICKER_ENABLED`) until a development-store test proves Shopify prices the added gift at $0. If a gift ever reaches the cart at a price above $0, the cart pauses checkout with a message and the shopper must remove the gift. `BUILT, AWAITING DEV-STORE VERIFICATION`

**The discount title matters.** For a **bundle**, the website shows a saving only when the bundle rule's `discountTitle` matches the **title of the automatic discount** in Shopify (capitals and extra spaces are ignored). A code discount, or an automatic discount with another title, is never counted as the bundle's saving. Always tell the developer the exact title you typed in Discounts.

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
8. Save. Then ask the developer to add the gift rule (qualifying products, gift variant for each size, maximum quantity) and, once the dev-store test passes, to turn the gift picker on.
9. Do the **cart and checkout match check** (3.5).

[Screenshot: Automatic discount, Buy X get Y, gift product free]

### 3.4 Create a bundle ("frequently bought together")

1. Open **Discounts > Create discount > Automatic discount**. Use **Buy X get Y** (or an amount-off discount, as the launch rules say). `(verify on the dev store)`
2. **Title:** the bundle name shoppers should see on the discount line. **Write it down exactly:** the developer copies it into the bundle rule's `discountTitle` (see 3.1). Without a matching title the website shows no saving figure.
3. Choose the bundle items and the saving, as in your launch rules.
4. The saving should disappear when a bundle item is removed. Test that (3.5).
5. Save. Ask the developer to add the bundle rule (the main product, the companion products and sizes, the discount title). The "Add all" button adds every item in the shopper's chosen size. `BUILT, AWAITING DEV-STORE VERIFICATION`
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

1. Ask the developer to remove or switch off the offer rule on the website (`DEVELOPER-MANAGED`), so shoppers are no longer shown it.
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

| Offer                   | Shopper sees                                                              | Order line                                                |
| ----------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------- |
| Comfort guarantee       | A mattress protector in the mattress's size                               | The protector, at its price                               |
| Haul-away and recycling | A choice of how many old pieces to remove                                 | "Recycle and disposal service" times the number of pieces |
| Matching add-ons        | Foundations, protectors, pillows and bedding that fit the mattress's size | Ordinary products                                         |

**Where the rules live today.** The plan was to save offer rules in **Content > Metaobjects > Offer rule** so changing one needs no developer. That is **not built**: the website reads the rules from a developer-managed setting (`OFFER_CONFIG_JSON`), and the Offer rule entries and the offer-related Site settings field (the haul-away maximum) are not read (`NOT CONNECTED YET`). Only the promo bar and support phone fields of Site settings are read (section 6.4). So, today, **any change to a rule, the haul-away maximum, the free-delivery amount or the offered products is a request to the developer**, who edits the setting and redeploys; your own part is the Shopify products and prices. If the setting is missing or damaged in production, **checkout is paused for every shopper** with an explanation until it is fixed, so ask the developer to test every change. The rules refer to variants by Shopify ID, which is why products must not be deleted and re-created (section 1). `BUILT, AWAITING DEV-STORE VERIFICATION`

Offer wording (the text on the comfort-guarantee, delivery-choice, haul-away, protection and picker steps) is **placeholder text in the code**, awaiting your approval (CLR-010, CLR-011). You cannot edit it in Shopify admin; send the developer the approved wording.

### 4.1 Haul-away: price and maximum pieces

**Price**

1. Open **Products** and find **Recycle and disposal service**. `(verify on the dev store)`
2. Change the **Price** of its one variant. Save.
3. Check the price on the website's haul-away step.

**Maximum pieces**

1. Tell the developer the new maximum. The number the website enforces is `rules.haulAway.maxPieces` in the developer-managed setting (a whole number from 1 to 99). The Site settings field "Haul-away maximum pieces" and the Offer rule "Maximum quantity" field exist in Shopify admin but **the website does not read either today** (open question C5 in the runbooks). Do not rely on them.
2. The order check described in 4.6 judges orders against the same current number, so there is no second number to keep in step (the Shopify Flow rule of draft 1 is no longer part of the design).

**Switch haul-away off.** Ask the developer to remove the haul-away rule (or set `OFFERS_ENABLED=false`, which turns off every offer). The website then stops offering it and removes it from carts that have it. `BUILT, AWAITING DEV-STORE VERIFICATION`

**Who is offered haul-away.** Only shoppers who chose **in-home delivery** in the website's delivery step and whose ZIP code is **inside the delivery zone**. A shopper who chose pickup, or whose ZIP is outside the zone, is not offered it. A shopper who has not entered a ZIP is asked to before haul-away can be judged; without a saved ZIP, a cart that holds haul-away cannot go to checkout.

### 4.2 Comfort-guarantee protectors

The shopper is offered a protector in **the same size as the mattress** they are buying.

1. Make sure there is one protector variant for each mattress size, with the size names exactly as in 2.5.
2. Ask the developer which mattresses trigger the comfort-guarantee step and which protector variant is used for each size (`DEVELOPER-MANAGED`: the "comfort guarantee" part of the offer setting). Tag the protector products `offer-only` (section 2.8). The comfort-guarantee wording is placeholder text pending your approval (CLR-010).
3. Add a qualifying mattress to a test cart. In the pre-checkout step, check the protector shown is the right size.

### 4.3 Matching add-ons (foundations, protectors, pillows, bedding)

The website offers add-ons **matched to the mattress size**. **Today the offered add-ons come from the developer-managed setting** (a list of mattress, add-on product and variant by size). The product fields **Related foundations**, **Related protectors** and **Related bedding** exist and the importer fills them, but the cart does not read them yet. Keep them filled in anyway: they are the planned source (REQ-ADD-001).

**On the product page** (`BUILT, AWAITING DEV-STORE VERIFICATION`, P4-03). For a mattress that has foundations, adjustable bases or frames in the developer-managed setting, the product page shows a box under **Add to cart** listing the ones that fit the selected size, each with Shopify's price and an **Add** button. The button adds the mattress (if it is not in the cart yet) and that item together; the shopper then sees "Added" and a **View cart** button. Changing the size on the page changes the list. Protectors, pillows and bedding are offered in the cart, not here. The box shows nothing for a size with no matching item, and a sold-out item is never listed; if the list cannot be loaded the shopper sees a short message with a **Try again** button, and the rest of the page is not affected. A price you change in Shopify shows here within about a minute (section 10.2). Which items are offered is the developer's setting, so a new foundation is a request to the developer.

1. Open the mattress product. `(verify on the dev store)`
2. In **Related foundations**, **Related protectors** and **Related bedding**, pick the products to offer, and send the developer the same list for the offer setting. `(verify on the dev store)`
3. Make sure each add-on has a variant with the **same size name** as the mattress (Queen with Queen). A spelling difference means no offer is shown.
4. Check on the website: change the mattress size and confirm the offered add-on changes with it.

An add-on with no variant for the chosen size is not offered. Unavailable variants are never offered.

### 4.4 Free-delivery message

The cart shows progress toward free delivery. The amount is `freeDelivery.thresholdCents` in the developer-managed offer setting (`DEVELOPER-MANAGED`; the Site settings entry has no free-delivery field). Keep it equal to the free-over amount in the zone setting and in the Shopify Local delivery price rule (section 8); the website cannot check that for you.

### 4.5 See which offers a shopper declined

When a shopper declines an offer step, the order records it, so customer service can see it later.

1. Open the order in **Orders**.
2. Look in the order's **Additional details** or notes area. `(verify on the dev store)`
3. You may see these entries:

| Entry                                    | Meaning                                               |
| ---------------------------------------- | ----------------------------------------------------- |
| `offer_declined_comfort_guarantee` = yes | The shopper declined the protector offer              |
| `offer_declined_haul_away` = yes         | The shopper declined haul-away                        |
| `offer_declined_protection` = yes        | The shopper declined accident protection              |
| `delivery_choice` = in-home or pickup    | What the shopper chose in the website's delivery step |

A value of "no" means the shopper accepted after first declining. Do not edit these entries. Whether Shopify copies these cart notes onto the order (and where they show) has not been seen on a real order (V-20); until it is, the entries may not appear.

[Screenshot: Order page showing the declined-offer entries]

### 4.6 The haul-away over-limit check (staff keep this in step)

**Why it exists.** The scope of work says Shopify enforces the haul-away maximum inside checkout. On your Shopify Basic plan that is not possible (it needs Shopify Plus). Instead the website enforces the maximum in layers **before** checkout. One gap remains: someone who builds a cart by calling Shopify's public interface directly could ask for more pieces than the maximum. They would pay for every piece, so the money risk is low, but the order should be corrected by staff. To catch these orders, an automatic check runs **after** the order is placed. **This replacement has not been acknowledged by you yet** (change request CR-08).

**How the check works** `BUILT, AWAITING DEV-STORE VERIFICATION`

- The Shopify Flow rule that draft 1 described was **not built**; Flow is not needed. Instead, every time Shopify tells the website an order was paid or updated, the website re-reads that order and checks it against the current rules (haul-away quantity, delivery zone, gifts without a qualifying item, protectors, Extend protection lines). It writes one line to the developer's log per finding, with the order number and a code only. A developer can also run a report for a date range (`scripts/detective/report.mjs`, see the runbooks section 8).
- **Nothing is tagged on the order and no email is sent today.** The order is not changed. Staff learn of a finding from the developer (the log or the report), so agree with the developer how often the report is run and who tells you. The alert rule that would notify someone is specified but not wired to a tool (runbooks section 11, waiting on the hosting decision).
- It detects after the order; it does not prevent. It has never run on a real order, and some assumptions (for example whether Shopify keeps the delivery-choice note on the order) are unproven (V-20).

**What you see and do when an order is flagged**

1. The developer gives you an order number (and a code such as `haul-away-over-max`).
2. Open the order.
3. Find the line **Recycle and disposal service**. Read its quantity.
4. Ask the developer what maximum the website used (it is the current offer setting; see 4.1).
5. Check the delivery method on the order. In-home delivery is correct. Pickup or parcel with a haul-away line is a mismatch.
6. Contact the customer if needed and decide what to do under your own policy: `[Client policy: TO BE DEFINED, for example keep the order as paid, or reduce the quantity and refund the difference]`.
7. To change the quantity or refund, use Shopify's order edit and refund tools. `(verify on the dev store)`
8. Mark the order as handled the way you agree with the developer (for example a note on the order). `TO BE CONFIRMED`
9. If you see several flagged orders, tell the developer. It may mean someone is bypassing the site.

**Keeping numbers in step.** Because the check reads the same developer-managed setting as the cart, the haul-away maximum lives in one place. If you later add an optional quantity-limit app from the Shopify App Store (your own cost, change request CR-13, not checked on your plan), its number would be a second place to keep equal.

---

## 5. Manage stores, hours and pickup locations

Each retail store is one **Store** entry (**Content > Metaobjects > Store**). `(verify on the dev store)`

> **`NOT CONNECTED YET`.** The store locator pages (`/stores`, by state, city and store) are built, but today they show **made-up sample stores** with a visible "preview" notice and are kept out of search engines. The website does not read your Store entries until the store reader is built (task P3A-07). You can prepare the entries now; they will start to show only after that. Steps 5.1 to 5.3 describe the intended behaviour. Pickup availability on product pages (5.2) is also not built (P3B-10).

### 5.1 Add or edit a store

1. Open **Content > Metaobjects > Store**. `(verify on the dev store)`
2. Click **Add entry**, or open the store to edit.
3. Fill in: name, a short URL name ("slug", lowercase with hyphens), address lines, city, state, postal code, phone and a photo.
4. Fill in **Latitude** and **Longitude**. The map needs them. If you change the address, change these too. `(verify on the dev store)`
5. Fill in **Opening hours** (a JSON field). The website's reader accepts a weekly list with up to three opening intervals a day and understands overnight hours; the final accepted format and a worked example will be added here when the store reader is built. `TO BE CONFIRMED` A store with no valid hours shows "hours not available".
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

Each block on the homepage is one **Homepage section** entry. `BUILT, AWAITING DEV-STORE VERIFICATION` If there are no enabled entries, the website shows a built-in placeholder layout.

| Field                | What it does                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Type                 | One of eight fixed kinds: `hero`, `promo-banner`, `shop-by-size`, `featured`, `brands`, `categories`, `financing`, `signup`. `hero`, `promo-banner` and `financing` show your heading, body, image and link. `shop-by-size`, `featured`, `brands` and `categories` fill themselves from the catalog and use only the heading, order and enabled switch. `signup` shows nothing until the signup form is built. |
| Heading, Body, Image | The content                                                                                                                                                                                                                                                                                                                                                                                                    |
| Link, Link label     | Where it goes, and the button text. If the label is empty the heading itself is the link. Use a path such as `/collections/queen-mattresses` or a full `https://` address. The site checks links, and a link that fails the check may not be shown.                                                                                                                                                            |
| Order                | A number. Lower numbers appear higher on the page.                                                                                                                                                                                                                                                                                                                                                             |
| Enabled              | Off hides the block without deleting it                                                                                                                                                                                                                                                                                                                                                                        |

**To reorder:** change the **Order** numbers. Leave gaps (10, 20, 30) so you can slot a block between two others.
**To hide a block:** switch **Enabled** off.
**To add a block:** click **Add entry**, choose the type, fill the fields, set the Order and switch Enabled on.

After saving, wait for the delay in section 10.2 and look at the homepage on a phone-sized window as well as a desktop. Optional fields can be empty; the block should still look right.

[Screenshot: Homepage section entry]

### 6.2 Promo tiles in a collection

A **Promo tile** is a picture and heading placed inside a collection's product grid. `BUILT, AWAITING DEV-STORE VERIFICATION` Tiles show only in the collection's normal view (not when filters are applied) and never as a lone last tile; a tile whose position is beyond the products shown waits for "Load more"; a tile with no valid link is shown but not clickable. Up to 100 tiles are read.

1. Open **Content > Metaobjects > Promo tile**. `(verify on the dev store)`
2. Click **Add entry** and choose the **Collection** it belongs to.
3. Set **Position in grid** (for example 5 puts it in the fifth position).
4. Add the **Image**, **Heading** and **Link**. Switch **Enabled** on.
5. Open the collection on the website and check the tile's place and that the grid looks right.

### 6.3 Collection FAQs

1. Open **Content > Metaobjects > FAQ** and click **Add entry**.
2. Type the **Question** and **Answer**.
3. Attach the FAQ to a collection or product: on that collection or product, add it to the **FAQs** field (a list of FAQ entries; up to 20 are read). The **Scope** text on the FAQ entry is only a label; the website does not use it. `BUILT, AWAITING DEV-STORE VERIFICATION`
4. Check the page: the FAQ opens and closes with the keyboard.

> **For the developer:** the website reads the FAQs field (`custom.faqs`) on collections as well as products, and `scripts/shopify/definitions.json` now defines it for both (the collection definition is the one added for REQ-COL-004). On a store where the definitions were applied before that change, run `node scripts/shopify/apply-definitions.mjs --store <domain>` as a dry run first: the collection FAQs field shows as `CREATE`, and `--live` creates it. Until it exists, collection FAQs cannot be attached. Not yet run against a store (V-05).

### 6.4 Promo bar and support phone

`BUILT, AWAITING DEV-STORE VERIFICATION` (task P3B-13; the definition and the entry have not been tried on a development store). The **Site settings** entry holds the one-line promotion above the header and the support phone number. Keep **one** entry in the list: the website reads a single entry only.

| Field in the entry | What to type                                                                                                                                                                                                                                                                                               | What the website does                                                                                                                                                                                                                         |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Promo bar text     | Plain text, one line, **up to 140 characters**.                                                                                                                                                                                                                                                            | Shows it in a bar above the header. HTML tags and odd invisible characters are removed, and text beyond 140 characters is cut off without a warning. **Empty text hides the bar**, even if a link is set. Nothing is shown until you type it. |
| Promo bar link     | Optional. A page on your site such as `/collections/queen-mattresses`, or a full `https://` address. Site paths must start with `/collections`, `/products`, `/pages`, `/brands`, `/blogs`, `/stores`, `/quiz`, `/compare`, `/search` or `/policies` (or be `/` alone). No spaces, at most 500 characters. | The whole message becomes the link. A link that fails these rules is **silently dropped** and the text shows without a link. A link to `/cart`, `/account` or another path is dropped too. Addresses on other sites open as ordinary links.   |
| Support phone      | Optional. A US number with area code, for example `(312) 555-0100` (digits, spaces, brackets, dots and hyphens, with or without a leading `1` or `+1`).                                                                                                                                                    | Shows a phone link in the header, the footer and the mobile menu. A value that is not a valid US number is ignored, and then no phone link is shown from this field.                                                                          |

**Which phone wins.** If the developer has set `PUBLIC_SUPPORT_PHONE` to a valid US number, that number is shown and the **Support phone** field is not used. Otherwise the admin field is used. If neither is valid, no phone link is shown anywhere (B-15). An invalid `PUBLIC_SUPPORT_PHONE` is ignored, so it does not hide a valid number typed in admin. If you edit the field and nothing changes, ask the developer whether `PUBLIC_SUPPORT_PHONE` is set.

**To change the bar:** open **Content > Metaobjects > Site settings** `(verify on the dev store)`, edit **Promo bar text** and **Promo bar link**, save, wait for the delay in section 10.2, and look at the top of the website on a phone-sized window (the text should fit on one or two lines). **To hide the bar:** empty **Promo bar text**.

**Other fields in the same entry** (Haul-away maximum pieces, Financing copy, Extend enabled) are **not read** by the website today; see sections 4 and 8. The guarantee strip wording and the Financing and Warranty links stay hidden until you supply the wording (B-15).

> **For the developer (an existing store):** `apply-definitions.mjs` creates definitions that are missing and **adds fields that are missing** from an existing metaobject definition. If the **Site settings** definition already exists on a store from before the **Support phone** field was added to `definitions.json`, a dry run prints `ADD site_settings: field support_phone ...` and then `PENDING CHANGES:`, and exits with code 1 (so it cannot be mistaken for "in sync"); a `--live` run adds only that field with `metaobjectDefinitionUpdate` and changes nothing else on the definition. It never alters or deletes an existing field, and a real difference (type, access, validations) is still printed as `DIFF ...` and left for you to fix by hand in admin (see `scripts/shopify/README.md`). Run the dry run first, then `--live` for an allow-listed store, then a dry run again and confirm it exits with code 0. The manual route (**Content > Metaobjects > Site settings > (settings) > Add field**, name **Support phone**, key `support_phone`, type single line text `(verify on the dev store)`) still works. Until the field exists, the phone can still be set with `PUBLIC_SUPPORT_PHONE`.

### 6.5 Brands

Open **Content > Metaobjects > Brand**. Edit the logo, about text and warranty terms. The change shows on the brand page (`/brands/<slug>`) **and** on every product page of that brand. `BUILT, AWAITING DEV-STORE VERIFICATION` Until real brands exist the brand pages show sample brands with a preview notice and are kept out of search engines. Brand pages are not yet in the sitemap, and the product page does not link to its brand yet (P3B-06). The **slug** must stay equal to the entry's handle, because the import tool finds brands by it.

### 6.6 Menus

`BUILT, AWAITING DEV-STORE VERIFICATION` (REQ-NAV-002, task P3B-02). The header and the mega menu can be built from a menu you edit in Shopify, but **only after a developer switches it on**. Until then the website shows its own designed navigation and ignores your menus, so editing **Online Store > Navigation** changes nothing. The switch is a deployment setting, `PUBLIC_NAV_MENU_HANDLE`, which names the menu to use (for example `main-menu`). It is off by default because a new store's default main menu usually holds only Home and Catalog and would replace the designed navigation. **Ask the developer which menu name is switched on** (or to switch one on once your menu is ready); changing the setting needs a restart or redeploy.

**What the menu looks like on the website**

| In your Shopify menu                              | On the website                                                                                                                       |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| A top-level item with nothing under it            | A plain link in the header row                                                                                                       |
| A top-level item with items under it              | A header item that opens a panel (the mega menu); if the item has its own link, clicking its label also goes there                   |
| An item under a top-level item that has items of its own | A **column heading** in the panel, with those items listed beneath it                                                         |
| An item under a top-level item with nothing under it | A plain link in the panel (such links are listed together in one column without a heading)                                       |
| The third level                                   | The links under a column heading. The website reads three levels; anything deeper is not read                                        |

**To change the menu** (once the developer has switched it on)

1. Open **Online Store > Navigation** and open the menu the developer named. `(verify on the dev store)`
2. Add, rename, move or remove items. Drag an item under another to make a sub-menu, and an item under that for the third level. `(verify on the dev store)`
3. For each item choose a link: pick a collection, product, page, blog post or policy from the list rather than typing an address. Picking from the list is the most reliable, because the website rebuilds the link from the item's handle.
4. Save.
5. Wait for the delay in section 10.2 (**about an hour**), then check the website's menu on desktop and on a phone-sized window. Click every link. None should lead to a "not found" page.

**Rules and limits the website applies** (anything over a limit is left out, without a warning to you)

- **8** top-level items at most, **8** column headings per panel, **12** links per column. Keep labels short: they are cut at **60** characters. Plain text only.
- An item that has no usable link and nothing usable under it is left out. A repeated link in one column is shown once.
- A typed web address that is on your own store or website must lead to a public part of the website (collections, products, pages, brands, blogs, stores, the quiz, compare, search or policies, or the home page). Addresses to other sites must start with `https://` and are marked as external links. Other kinds of address (for example `http://`, or anything with spaces) get no link.
- "Catalog" items go to all products; "Home", "Search" and the customer account page go to the matching pages.
- The **Sleep quiz** link is added at the end by the website unless your menu already links to the quiz.
- If the menu is empty, has nothing usable, or cannot be read, the website shows its own designed navigation again. This is by design, so the header is never empty.

[Screenshot: Navigation main menu being edited]

### 6.7 Content pages

The 15 content pages (Delivery and shipping, Financing, Comfort guarantee, Price guarantee, Warranty and returns, FAQ, About, Contact, Size guide, Comfort guide, Mattress types guide, Adjustable base guide, Privacy policy, Terms, Accessibility) are edited in **Online Store > Pages**. `(verify on the dev store)` Writing the text is your responsibility; the project only loads it.

---

## 7. Edit the sleep quiz

The quiz has **6 to 8 questions**. Each question has **2 to 8 answers**, and each answer carries **scoring rules** saying which products it favors. You will manage this in **Content > Metaobjects**, under **Quiz question** and **Quiz option**. **`NOT CONNECTED YET`:** the quiz page is built and checks all the limits below, but today it uses a built-in default quiz and sample products; it does not read your entries (task P6-01). The default questions and scoring await your approval (CLR-012). Sections 7.1 to 7.4 describe how editing will work once connected; the limits and the "what a bad mapping does" behaviour are real (checked by the code's tests).

Approve any change with the people who own your product advice. The quiz is shopping guidance, not medical advice, and the results page says so.

### 7.1 Edit a question

1. Open **Quiz question** and click the question. `(verify on the dev store)`
2. Edit the **Question** (up to 200 characters) and the **Help text** (up to 300).
3. Change **Order** to move it. The lowest number comes first.
4. Switch **Allow several answers** on only if shoppers may pick more than one.
5. Save and take the quiz yourself (7.4).

### 7.2 Edit an answer and its scoring

Each answer is a **Quiz option**: a **Label** (up to 80 characters) and **Scoring rules**. A rule says what the answer does to the products:

| Rule    | What it does                                         | Limits                                                                                             |
| ------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Boost   | Products with that fact score higher                 | Fact: comfort level, mattress type, sleep position or benefit. Weight: a whole number from 1 to 10 |
| Penalty | Products with that fact score lower                  | Weight from -1 to -10. Not 0                                                                       |
| Exclude | Products with that fact are removed from the results |                                                                                                    |
| Size    | Limits results to a size                             | One of the seven sizes in 2.5                                                                      |
| Budget  | Limits price                                         | Whole dollars, a minimum and/or maximum. The maximum is above 0 and not below the minimum          |

- Use only the values in the table in 2.5 (for example "Memory Foam", "Pressure Relief"). Capitals and hyphens are forgiven; other words are not.
- Up to 12 rules per answer.
- A fill-in template for the rules field will be added here when its final format is fixed (task P3A-02). Until then, ask the developer to enter or review scoring rules. `TO BE CONFIRMED`

### 7.3 What a bad mapping does

| Mistake                                                                                  | What happens                                                           | Do you see an error?                              |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------- |
| A rule with a misspelled or unknown value or weight                                      | That one rule is **ignored**. The answer then scores less, or nothing. | **No.** Only the developer's logs show a warning. |
| A question with fewer than 2 valid answers                                               | The whole question is **dropped** from the quiz.                       | No                                                |
| More than 8 questions                                                                    | Only the first 8 are used.                                             | No                                                |
| Fewer than 6 questions                                                                   | The quiz still works but is shorter than the scope of work says.       | No                                                |
| Two questions or answers with the same internal ID                                       | The second is dropped.                                                 | No                                                |
| A rule that is valid but **wrong** (for example boosting "Extra Firm" for "I want soft") | The quiz recommends the wrong mattresses.                              | **No.** This is the most harmful mistake.         |
| An Exclude rule on a fact most products have                                             | Fewer than three results, or none.                                     | No                                                |
| Very high weights on one answer                                                          | That answer overpowers all the others.                                 | No                                                |

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

For now there is **one** in-home delivery zone (an owner decision, change request CR-12). More zones are a change request. The ZIP list, fee and free-delivery amount come from you (CLR-009). Until you supply them, no delivery promise is shown on product pages.

**What the website reads today.** The website's zone (name, ZIP list or `606*`-style prefixes, fee, free-over amount and the promise wording for in-home, parcel and pickup) comes from the developer-managed offer setting (`OFFER_CONFIG_JSON`, `zone` part), **not** from the **Delivery zone** metaobject, which the website does not read yet (`NOT CONNECTED YET`). The shopper's saved ZIP is kept in a signed cookie for 30 days. With no zone the product page and cart say nothing about delivery, by design. `BUILT, AWAITING DEV-STORE VERIFICATION`

So today a ZIP list change means: send the developer the new list; the developer updates the setting and redeploys; **you** update Shopify Local delivery. The steps in 8.2 describe keeping the metaobject as the planned single source; until it is read, keep it as your written record.

### 8.1 Why the list is kept in two places

| Place                                                    | What uses it                                                                                         |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Content > Metaobjects > Delivery zone > Postal codes** | The website: the ZIP check in the header, the delivery promise on product pages, the haul-away offer |
| **Settings > Delivery and shipping > Local delivery**    | Shopify's checkout: it decides whether in-home delivery is offered and at what price                 |

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
8. Ask the developer to run the **parity check**, which compares the ZIP list in the website's zone with Shopify's Local delivery list, understanding `100*`-style wildcards (`node scripts/shopify/check-delivery-parity.mjs --zone zone-export.json --local local-delivery-export.json`, exit code 0 means identical). It reads two exported JSON files, so you must give the developer an export or copy of each list. Built and tested on sample files only. `BUILT, AWAITING DEV-STORE VERIFICATION`
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

| Value                     | Where                                                                                                                |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Free-over amount          | **Delivery zone > Free over**, the developer-managed offer setting (section 4), and the price rule in Local delivery |
| Fee wording shoppers read | **Delivery zone > Fee text** and **Promise** wording (client-approved)                                               |

### 8.5 What shoppers will notice

- At checkout the option appears under Shopify's own name, **Local delivery**, not "white-glove".
- Apple Pay, Google Pay and PayPal express buttons may not appear for orders in the zone. Shop Pay still works. This is documented by Shopify and still to be checked on your store (change request CR-10). `(verify on the dev store)`
- Everything in a local-delivery order must come from **one location with stock**, and parcel items cannot be combined with local-delivery items in one order. What to do with mixed carts is an open question for you.

---

## 9. Extend accident protection: what you see and do

**Status: switched off** (`PUBLIC_EXTEND_ENABLED` is not `true`). The feature is built against a practice copy of Extend's documented system; none of it has run against Extend's real or demo system or your Shopify store. Built: the protection panel on product pages (only for products with an **Extend category** fact), the add-with-protection and add-protection cart actions, the protection step, the order sync route, and a reconciliation script. "Powered by Extend" is plain text until you supply Extend's logo. It goes live only when you have an approved Extend merchant account, Extend approves the website's design, and Extend answers some technical questions in writing. Without those, no Extend offers appear and nothing else on the site is affected.

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

The website checks every order that has coverage. If something does not add up, it **does not send the line to Extend** and flags it for staff instead. The developer runs the **reconciliation report** (`scripts/extend/reconcile.mjs`, built; a schedule is not set up) once Extend is live, and shares it. `BUILT, AWAITING DEV-STORE VERIFICATION` It lists order IDs and short reasons only, with no customer details.

| Report says                             | In plain words                                                                       | What to do                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Missing sync                            | Shopify has an order with coverage that Extend does not have                         | Give the order ID to the developer, who can re-send it (re-sending is safe)      |
| Orphan coverage                         | A coverage line has no matching covered item (or Extend has a line Shopify does not) | Open the order and give the order ID to the developer                            |
| Price mismatch                          | The price paid for coverage does not match the plan it names                         | Open the order and give the order ID to the developer                            |
| Quantity mismatch                       | Coverage quantity differs from the covered item's quantity                           | Give the order ID to the developer                                               |
| Status mismatch                         | Shopify and Extend disagree on whether the order is active, cancelled or refunded    | Give the order ID to the developer                                               |
| Contract missing                        | The item is fulfilled in Shopify but Extend issued no contract                       | Give the order ID to the developer; the developer contacts Extend if it persists |
| Flagged coverage                        | The coverage line failed a check (for example an unknown plan or duplicate coverage) | Open the order and give the order ID to the developer                            |
| Invalid order / unexpected Extend order | Data problem on one side                                                             | Give the order ID to the developer                                               |

What to tell or refund the customer in each case (for example refund the coverage line, or keep it) is your policy to set. `[Client policy: TO BE DEFINED]` Whether Extend lets us read its own records back for this comparison is not confirmed, so the report may compare against an export from Extend's Merchant Portal. `UNVERIFIED`

---

## 10. Troubleshooting

### 10.1 Where to look first

Work down this list. Most problems stop at step 1 or 2.

1. **Is it just waiting?** Check the delay in 10.2. Wait that long, then reload with a fresh browser window.
2. **Is it switched on and published?** Product status Active and available to the website's sales channel; entry **Enabled** on; discount active and within its dates.
3. **Is the data complete and spelled right?** Product facts (2.5), size names, ZIP lists, slugs.
4. **Did you change one half of a pair?** Pairs: Price and Compare-at; the website's ZIP list (developer setting) and Local delivery; a discount and its website offer rule (including the bundle discount title); free-over amounts (offer setting, zone setting, Local delivery rule).
5. **Still wrong?** Undo your last change, then call (see "Who to call").

| What you see                                                                             | Look first                                                                                                                                         | Likely cause                                                                                                                                        |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Edit not on the website                                                                  | 10.2                                                                                                                                               | Not enough time has passed                                                                                                                          |
| Product missing from a collection or filter                                              | Product facts (2.5); status; sales channel                                                                                                         | Missing or misspelled fact                                                                                                                          |
| Price on a collection page differs from the cart                                         | 10.2                                                                                                                                               | Collection pages are cached; the cart is always current                                                                                             |
| Gift not offered                                                                         | Discount active and dates; qualifying product; developer's gift rule exists; **gift picker switched on** (off by default)                          | One half missing                                                                                                                                    |
| Cart says checkout is paused                                                             | Read the message: a gift not priced at $0, offer settings unreadable, delivery ZIP needed for haul-away, or a coverage list that could not be read | Call the developer if it persists; "Try again" works for temporary read failures                                                                    |
| Bundle shows no saving                                                                   | The automatic discount's title equals the bundle rule's discount title                                                                             | Title mismatch                                                                                                                                      |
| A service or protection product appears in Google                                        | `offer-only` or `extend-coverage` tag (2.8)                                                                                                        | Tag missing                                                                                                                                         |
| Gift charged full price, or cart total differs from checkout                             | 3.7                                                                                                                                                | Discount and offer out of step                                                                                                                      |
| Haul-away not offered                                                                    | Shopper chose in-home delivery; ZIP saved and in zone; developer's haul-away rule exists                                                           | Eligibility rule                                                                                                                                    |
| Site says in-home delivery is available but checkout does not offer it (or the opposite) | Section 8.1                                                                                                                                        | The two ZIP lists differ                                                                                                                            |
| Add-on not offered                                                                       | Size names match; add-on has a variant in that size; the variant is in stock; the developer's setting lists it for that mattress                     | Spelling, missing size, sold out, or not in the setting                                                                                             |
| "Delivery check unavailable" in the header on the live site                              | Tell the developer at once                                                                                                                         | The server's delivery signing secret is missing or too short. Shoppers cannot save a ZIP and carts with haul-away cannot check out until it is fixed |
| Edited the menu but the header did not change                                            | 6.6 and 10.2                                                                                                                                       | The menu is not switched on (a developer setting), the wait of about an hour, or the menu name is not the one switched on                           |
| Quiz gives odd or too few results                                                        | 7.3 and 7.4                                                                                                                                        | A rule was dropped or is wrong                                                                                                                      |
| No Extend offers                                                                         | Section 9                                                                                                                                          | Feature is off, or the product is not in an eligible category, or no coverage price matches, or Extend is unreachable (offers are hidden by design) |
| Store page wrong                                                                         | Store entry fields (5.1)                                                                                                                           | Missing latitude, longitude or hours                                                                                                                |
| Import stops with errors                                                                 | The printed report (2.6)                                                                                                                           | Sheet problem; nothing was imported                                                                                                                 |
| Checkout will not open, or shoppers cannot pay                                           | n/a                                                                                                                                                | **Blocker:** call the developer now                                                                                                                 |

### 10.2 How long edits take to appear

The website keeps copies of some Shopify data for a short time so pages load quickly. The windows below are what the code sets (decision DEC-024); they have **not been measured** on a real store. The "long" window is Hydrogen's default; in the installed version (2026.4.7) the source says **1 hour fresh, then an older copy may be served for up to 23 more hours while a refresh runs**, so an edit normally shows within about an hour, and the first visit after that hour may still show the old version once. (Read from the code on 2026-10-23, not measured.)

| What you changed                                                                                               | Appears on the website after                                                                                               |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Prices, sale prices, stock and sold-out sizes** on product pages, collection pages, the home page and search | about 1 minute; a stale copy may be served for up to 5 more minutes while it refreshes, so allow **up to about 6 minutes** |
| Product titles, descriptions, images, product facts and FAQs on a product page                                 | "long" cache (Hydrogen's default: about an hour, see the paragraph above)                                                  |
| Menus (when switched on, 6.6), content pages, brands, homepage sections, promo tiles, the offer-only tag list  | "long" cache, same range                                                                                                   |
| The list of foundations, bases and frames on a product page (4.3)                                              | price and stock like prices (about 1 minute; your browser may also keep the list for 1 minute)                             |
| Shop policies (the policy pages, the policies list, and which policies the sitemap lists)                      | "long" cache, same range: all three reads use it                                                                           |
| Site settings: promo bar text, promo bar link, support phone (6.4)                                             | like prices: about 1 minute, up to about 6 minutes (read on every page; the promo text may quote a price or a date)        |
| Search suggestions                                                                                             | a few seconds (Hydrogen's short cache)                                                                                     |
| The cart, your account, orders, the saved delivery ZIP, and the offer checks on the cart                       | Not kept: always current                                                                                                   |
| Offer rules, the delivery zone, the haul-away maximum                                                          | Change only when the developer redeploys the setting                                                                       |
| Shopify checkout settings and the Local delivery list                                                          | Not controlled by the website. `(verify on the dev store)`                                                                 |

The cart always shows Shopify's current price. If a page shows an old price, the cart and checkout are still right.

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

**Not covered by this guide:** how customers use their account pages (built on the template, not verified on a store, V-08), guest order lookup (not built), reviews, analytics, signup and chat (not built), financing messages, the product sheet's `copy_approved` publishing rule beyond section 2.6 (see the catalog README), and the final wording of offer steps (pending your approval).

**Before this guide is final:** capture real screenshots from a development store; run every `(verify on the dev store)` step there; have a non-developer complete each task using only this guide; replace each `TO BE CONFIRMED`; record the client's acknowledgement of the haul-away, delivery-zone and post-purchase changes.
