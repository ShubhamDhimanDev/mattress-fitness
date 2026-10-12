# Scope of Work: Headless Shopify Storefront (source transcription)

> **Provenance.** Transcribed on 2026-10-11 from the attached PDF *"Scope of Work Headless Shopify Storefront - final.pdf"* (13 pages, dated Oct 11, 2026, author `@shubham`). The PDF itself was **not found on disk** in this workspace, so this file is a manual transcription of the attachment, kept in the PDF's own section numbering (§1–§13). Page markers use the PDF's "Page N of 13" footers.
>
> **Action:** place the original PDF at `docs/requirements/source/` and diff this transcription against it. If they disagree, **the PDF wins**; fix this file and record the change in [../../progress/DECISIONS.md](../../progress/DECISIONS.md).
>
> Everything below the line is the SOW text. Our analysis lives elsewhere: [REQUIREMENTS.md](REQUIREMENTS.md), [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md).

---

# Scope of Work: Headless Shopify Storefront

This document sets out what we will design, build and hand over: a headless Shopify storefront for the client's mattress and bedding catalog of up to 400 products, with accident protection, add-on offers and delivery services built into the shopping journey.

## 1. Project overview *(p.1)*

The client gets a fast, custom-designed online store that guides shoppers to the right mattress and raises order value through protection, add-ons and services, all managed from Shopify.

**Objectives**

- **Clear buying decisions:** sizes, prices, specifications, delivery promises and financing visible on every product, plus a sleep quiz that matches each shopper to the right mattress.
- **Higher order value:** accident protection, matching foundations and bedding, comfort-guarantee protectors, haul-away service and gift-with-purchase offers before checkout.
- **Online and in-store together:** store locator, store pickup and "try in store" for showroom visits.
- **Self-managed store:** the client's team edits products, prices, promotions and homepage content in Shopify admin, without developers.

**Reference site.** The shopping experience follows the patterns of mattresswarehouse.com for layout and features only. No text, images, logos or trademarks from that site are reused; the client's brand and manufacturer-supplied product assets are used throughout.

## 2. Solution architecture *(pp.1–2)*

Shopify remains the store's back end for products, prices, inventory, checkout, customers and orders; we build a custom storefront that presents it. There is no ERP or POS to connect.

The storefront holds no data of its own: it reads everything from Shopify, so whatever the client's team changes in Shopify admin appears on the site without a developer.

- **Storefront:** Shopify Hydrogen (React), TypeScript and Tailwind CSS, built for mobile first.
- **Checkout:** Shopify's secure hosted checkout, styled with the client's brand.
- **Content management:** Shopify admin, for products, promotions, offers, stores and homepage sections.
- **Code ownership:** the client owns the GitHub repository and all source code.

*Diagram (p.2), "Shopify runs the store; the custom storefront presents it":* Shoppers (browse, compare, add offers, buy) → **Custom storefront · Shopify Hydrogen** containing "Pages, cart and pre-checkout offers: Home, collections, product pages, compare, sleep quiz, cart, offers, store locator, account" (highlighted = what we build) and two hosting options, **Option A** hosted on Shopify Oxygen and **Option B** hosted on the client's own server (both run the same storefront). The storefront talks to **Shopify (the store's back end)** over the *Storefront API*: Catalog (products, sizes, prices; collections and filters; inventory per location), Content (homepage sections; stores, brands, FAQs; menus, pages, blog), Cart and checkout (secure hosted checkout; delivery, pickup, shipping; cards, wallets, Affirm), Customers and orders (customer accounts; order history, tracking; order emails). The storefront talks to **Connected services** via *scripts and APIs*: **Extend** (offers and order sync), **Reviews and chat** (client's chosen apps), **Klaviyo, GA4, Meta** (signups and tracking). **Shopify admin**, the client's team, manages Shopify: edits products, prices, promotions, stores and homepage.

## 3. Hosting options *(pp.3–4)*

Both options deliver the same storefront, features and Shopify back end; they differ only in where the site runs and who looks after the server. The client selects one option at sign-off.

**Development and go-live.** During development, the site runs on our staging server, where the client reviews progress. At go-live we move it to the client's own hosting and connect the client's domain: to Shopify Oxygen within the client's Shopify store under Option A, or to a server the client purchases under Option B.

| | Option A: Shopify-hosted | Option B: Self-hosted |
|---|---|---|
| Where the storefront runs | Shopify Oxygen, Shopify's global edge hosting | A server or cloud account the client purchases before go-live (Linux, Node.js) |
| Storefront code | Shopify Hydrogen | The same Hydrogen code, adapted to run on a Node.js server |
| Hosting cost | No separate hosting bill (Shopify) | Paid by the client to its server provider |
| Speed for shoppers | Pages served from edge locations close to each shopper | Pages served from the server's region; a CDN can be added |
| Previewing changes after go-live | Automatic preview link for every change | A staging site on the client's server |
| Connection to Shopify | Hydrogen sales channel | Shopify Headless channel (Shopify) |
| What we set up | Move from our staging server to Oxygen, deployment pipeline and environment settings | Move from our staging server, server hardening, Nginx, SSL certificate, process manager, page caching, deployment pipeline, staging site, uptime monitoring |
| Ongoing upkeep | Shopify maintains the hosting | The client, or a separate maintenance agreement, covers operating-system updates, security patches, backups and scaling |
| Extend order sync | Runs as a secure endpoint within the storefront | Runs as a service on the same server |

**Our recommendation is Option A.** It removes server upkeep and gives faster page loads at no hosting cost. Option B suits a client that must keep hosting in its own infrastructure; Shopify documents this setup, though some newer Hydrogen features may need extra adaptation when self-hosted (Shopify self-hosting guide).

## 4. Storefront deliverables *(pp.4–6)*

Every page a shopper needs, from first visit to order tracking, designed in the client's brand and built for mobile first.

| Area | Included |
|---|---|
| Header, menu and footer | Delivery zip-code entry, "my store" selector, search, account, cart; mega menu (mattresses by size, brand, comfort, type and price; foundations and adjustable bases; furniture; bedding; sale; clearance; guides); promotional bar; footer; mobile navigation |
| Homepage | Sale banners, shop by size, brand tiles, category tiles, financing banner, store and chat call-outs, email and SMS signup; every section editable in Shopify admin |
| Collection pages | Filters for size, brand, product type, comfort level, mattress type, benefits, sleep position, product line and price; sorting; load more; promotional tiles within the grid; sale and gift badges; "From $" pricing; star ratings; collection FAQs |
| Search | Predictive search with product suggestions; results page with the same filters |
| Product pages | Image gallery; size selector with dimensions and live price; savings and badges; delivery promise for the shopper's zip code; store pickup availability; "try in store" link; overview, specifications and features; brand, delivery and warranty sections; reviews; FAQs |
| Product add-ons | Size-matched foundations, adjustable bases and frames; "frequently bought together" bundle with Add all; accident protection offer |
| Product comparison | Side-by-side comparison of similar products by rating, price, comfort, type, height and benefits |
| Sleep quiz and product finder | Guided quiz that recommends the best-matched mattresses from the catalog; details below this table |
| Store locator | State, city and individual store pages with map, hours, phone, directions and "set as my store"; stores managed in Shopify admin |
| Customer account | Sign-in, order history and order details; guest order tracking by order number and email |
| Content pages | Page layouts plus loading of client-supplied text for: Delivery and shipping, Financing, Comfort guarantee, Price guarantee, Warranty and returns, FAQ, About, Contact, Size guide, Comfort guide, Mattress types guide, Adjustable base guide, Privacy policy, Terms, Accessibility; blog listing and article layouts |

### Sleep quiz and product finder

A short guided quiz recommends mattresses from the client's catalog. It is linked from the homepage, the mattress menu, collection pages and product pages.

- **Questions:** 6 to 8 one-tap questions with a progress bar, covering sleep position, preferred feel, sleeping hot, sharing the bed, areas of discomfort, preferred mattress type, size and budget.
- **Results:** the three best-matched mattresses, each with the reasons it matched (for example "Medium · Hybrid · Cooling"), its price in the chosen size and Add to cart; plus "See all matches", which opens the collection page with matching filters applied, and "Retake quiz".
- **Matching:** each answer scores products on the attributes already stored on every product (comfort level, mattress type, sleep position, benefits and price), so new products are included automatically.
- **Managed in Shopify admin:** question wording, answer options and how each answer maps to product attributes.
- **Saved results:** remembered on the shopper's device, and saved to the customer account when signed in.
- **Tracking:** quiz starts, completions and result clicks sent to Google Analytics.
- **Guidance only:** results are presented as shopping guidance, with a note that they are not medical advice.

## 5. Cart, pre-checkout offers and upsells *(pp.6–7)*

All offers run on the client's own pages before Shopify's checkout opens, so every add-on arrives at checkout as a normal order line. The client controls which products are offered with which, the gift and bundle rules, and the haul-away price and limit, in Shopify admin.

**Cart (slide-out drawer and full page)**

- Edit sizes and quantities, remove items.
- Gift-with-purchase offers with a size picker, shown when a qualifying product is in the cart.
- Matching protector, pillow and bedding offers.
- Free-delivery progress message.
- Store-card and Affirm monthly payment messages.

**Pre-checkout steps** — shown after "Proceed to checkout", each only when it applies, each with an accept and a decline choice:

1. **Comfort guarantee:** add a mattress protector in the mattress's size to qualify for the comfort guarantee.
2. **Haul-away and recycling:** choose how many old pieces to remove, up to the client's set maximum. Offered only for in-home delivery inside the delivery area.
3. **Accident protection:** Extend coverage for each eligible item, with price and a coverage summary (section 6).

A declined offer is recorded on the order, so customer service can see it later.

**How each offer appears at checkout**

| Offer | Order line at checkout |
|---|---|
| Comfort-guarantee protector | The protector, in the matching size, at its price |
| Haul-away | "Recycle and disposal service" × number of pieces |
| Accident protection | Extend coverage line for the covered item |
| Gift with purchase | The gift item at $0, labelled with the promotion name |
| Bundle savings | The bundle items with the saving shown as a discount |

Gift and bundle prices are applied by Shopify discounts, so the cart price always matches the checkout price. Removing the qualifying item removes its gift. The haul-away maximum is also enforced inside checkout by a Shopify Function.

**After purchase**

- A follow-up offer on the order confirmation (thank-you) page.
- A one-click offer shown between payment and the confirmation page, subject to Shopify enabling this feature for the store (Shopify).

## 6. Accident protection (Extend) *(pp.7–8)*

Shoppers can add Extend accident protection on the product page, in the cart and in the pre-checkout step, and every sale is reported to Extend automatically so the customer's coverage starts without manual work.

- **Live offers.** Coverage options and prices for each eligible product come from Extend's Offers API (Extend).
- **Cart line.** The chosen coverage is added as an Extend coverage item at the quoted price, linked to the item it covers. It cannot be bought on its own, and its quantity follows the covered item.
- **Order reporting.** Each order is reported to Extend's Orders API. Extend issues the customer's contract when the item is marked fulfilled, and refunds or cancellations update Extend automatically (Extend).
- **Customer service.** Extend sends the customer their coverage details and handles claims.
- **Branding.** Every offer shows Extend's branding and a link to the coverage terms, as Extend requires. Extend reviews the integration before it goes live.

The client provides an approved Extend merchant account, its store ID, and the list of product categories eligible for coverage.

## 7. Checkout, delivery and payments *(pp.8–9)*

Checkout runs on Shopify's secure hosted checkout, styled with the client's logo, colours and fonts, and set up with the client's delivery methods and payment options.

**Checkout.** Contact, address, delivery and payment steps; discount codes; email marketing opt-in; express buttons for wallets and PayPal. Taxes are calculated by Shopify's tax settings.

**Delivery methods**

| Method | Offered when | Set up with |
|---|---|---|
| White-glove in-home delivery | The shopper's zip code is inside the client's delivery area | The client's zip list and fee rules, such as free above a set order value and a flat fee below |
| Store pickup | The item is available at the shopper's chosen store | Each store as a pickup location, with a "ready for pickup" email |
| Parcel shipping | Boxed mattresses, bedding, pillows and other parcel items | Carrier or flat rates, as the client chooses |

**Payment options**, each subject to activation on the client's own account: credit and debit cards, Shop Pay, Apple Pay, Google Pay, PayPal and Affirm. If the client runs a store credit card programme, the site shows monthly payment messages and links to apply or prequalify.

**Customer emails.** Order confirmation, shipping, pickup-ready and refund emails styled in the client's brand.

## 8. Product catalog and content *(pp.9–10)*

We import up to 400 products, each model as one product with a variant per size, from a single product sheet the client completes. The client supplies the facts and images; we structure, write and load them.

| Item | Client provides | We deliver |
|---|---|---|
| Product data | Our sheet template, completed: model, brand, sizes, SKUs, prices, sale prices, specifications, delivery type | A validation report, then import of all products, sizes and specifications into Shopify |
| Images | Manufacturer images, named by product | Upload, ordering and alt text |
| Product copy | Manufacturer specifications and any brand copy | Drafted descriptions, overview bullets, SEO titles and meta descriptions, for client approval |
| Collections and filters | Approval of the category structure | Rule-based collections and filters, so new products sort themselves |
| Brands | Logos, about text, warranty terms | Brand sections on product pages and brand collection pages |
| Stores | Address, hours, phone and photo for each store | Store locator and individual store pages |
| Add-on services | Haul-away price and maximum pieces; comfort-guarantee rules | Service products and offer rules configured |
| Content pages | Final text for the pages listed in section 4 | Page layouts and loading of the text |
| Promotions | Gift-with-purchase and bundle rules for launch | Shopify discounts and offer placements configured |

After handover, the client's team updates prices, sales, products and homepage content in Shopify admin, or by editing the product sheet and re-running the import tool we hand over.

## 9. Not included *(p.10)*

The items below are outside this scope. Any of them can be quoted separately and added through change control (section 11).

- Custom content inside Shopify's checkout steps; offers run on the client's pages before checkout instead (section 5).
- A custom-built checkout replacing Shopify's.
- Automated email and SMS flows (abandoned cart, post-purchase, review requests); signup forms are included.
- Online booking of delivery time windows; the client's team schedules deliveries.
- Import of existing customer reviews.
- ERP, POS or warehouse system integration.
- A self-run warranty programme; Extend is the protection provider.
- An in-store sales or tablet app.
- Static design mockups before build; design is built directly in the client's brand and reviewed on the preview site.
- Photography, video, and copywriting beyond the product copy in section 8.
- Multiple languages or currencies.
- Third-party subscription and transaction fees (Shopify, apps, Extend, Affirm, payment processing, and server costs under Option B).
- Ongoing maintenance, hosting upkeep and new features after handover.

## 10. Client responsibilities *(pp.10–11)*

The project moves at the pace these items arrive. The client names one decision-maker who answers questions and feedback within 24 hours.

**Accounts and access**

- [ ] Shopify store with staff access for our team
- [ ] Choice of hosting option (section 3); for Option B, a server or cloud account purchased before go-live, with administrator access for our team
- [ ] Access to the domain registrar, Klaviyo, Google Analytics and Meta
- [ ] Chosen reviews app and live-chat provider

**Provider approvals**

- [ ] Extend merchant account approved, with store ID
- [ ] Shopify Payments, PayPal and Affirm activated
- [ ] Store credit card programme details, if the client has one

**Business rules**

- [ ] Delivery zip codes, fees and free-delivery threshold
- [ ] Haul-away price and maximum pieces; comfort-guarantee rules
- [ ] Gift-with-purchase and bundle rules
- [ ] Approval of the sleep quiz questions and recommendation rules

**Content**

- [ ] Brand kit: logo, colours, fonts, lifestyle photography
- [ ] Completed product sheet and manufacturer images for all products
- [ ] Store list with address, hours, phone and photo
- [ ] Final text for the content pages
- [ ] Approval of drafted product copy

## 11. Acceptance, handover and change control *(pp.11–12)*

The client reviews work continuously on a preview site and signs off against sections 4 to 8; the site goes live with zero open blockers.

**Reviews during the build**

- Staging-site link with a short change note at the end of each working day.
- A weekly demo.
- One consolidated round of feedback per page type, collected in a single shared issue list.

**Acceptance testing.** The client tests each deliverable on the supported browsers and devices. Issues are graded:

| Grade | Meaning | Before go-live |
|---|---|---|
| Blocker | Stops a shopper from finding, buying or paying | Must be fixed |
| Major | A listed deliverable does not work as described | Fixed, or deferred by written agreement |
| Minor | Cosmetic or wording | May be fixed after go-live |

Before go-live we place a test order for every delivery method, add-on and payment type, then cancel and refund it.

**Handover**

- Source code in a GitHub repository owned by the client.
- The product import tool and the completed product sheet.
- A written admin guide: products, promotions, offers, stores and homepage content.
- A training session for the client's team.
- Go-live support on launch day.

**Change control.** A new feature, or a change to a delivered one, starts with a written change request. We reply with its effect on effort and cost, and work starts only after the client approves in writing.

## 12. Quotation *(pp.12–13)*

Everything described in this document is delivered for a fixed price of **USD 1,000**, whichever hosting option the client selects. It includes hosting the site on our staging server during development and moving it to the client's hosting at go-live.

| Item | Amount (USD) |
|---|---|
| Design, development, product import and launch of the headless Shopify storefront, as described in this document | 1,000 |
| **Total** | **1,000** |

**Payment terms**

- 50% (USD 500) on signing this scope of work.
- 50% (USD 500) on go-live.

**Not included in the price**

- Third-party fees billed to the client directly: Shopify subscription, apps, Extend, Affirm, payment processing, and server costs under Option B.
- Items listed in section 9, change requests (section 11) and ongoing maintenance after handover, each quoted separately.

## 13. Assumptions and sign-off *(p.13)*

This scope rests on the assumptions below; if one changes, the scope is reviewed through change control.

- The catalog is up to 400 products; more are added by change request.
- Shopify is the system of record for products, prices, inventory, customers and orders.
- Extend, Affirm, Shopify Payments and Shopify's post-purchase offer feature are approved by those providers. Features that depend on them go live once approved.
- The client holds the rights to all images and text it supplies.
- The store sells in the United States, in English and US dollars.
- The price and payment terms are set out in section 12.

By signing, both parties agree to the scope described in this document.

| | Client | Service provider |
|---|---|---|
| Name | *(blank in the attachment)* | *(blank in the attachment)* |
| Title | | |
| Signature | | |
| Date | | |

> **Note:** the attachment's signature block is blank. Treat "signed-off" status as **unconfirmed** until a signed copy is on file (see Q-001 in [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md)).
